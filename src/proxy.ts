import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/session";
import { UsuarioRole } from "@/modules/shared/domain";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
const RATE_LIMIT_MAX = 300;
const AUTH_RATE_LIMIT_MAX = 10;
const XLSX_IMPORT_BODY_MAX_BYTES = 12 * 1024 * 1024;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

// Rotas públicas (não exigem sessão).
const PUBLIC_PATHS = [
  "/login",
  "/esqueci-senha",
  "/redefinir-senha",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/2fa/verificar",
  "/api/auth/recuperar-senha",
  "/api/auth/redefinir-senha",
  // Health check público para watchdog/load balancer/Nginx checar saúde do app
  // sem precisar manter sessão. Não vaza nada sensível (só status agregado).
  "/api/health",
  "/api/amazon/cron-orders",
  "/api/amazon/cron-inventory",
  "/api/amazon/cron-finances",
  "/api/amazon/reviews/cron-daily",
  "/api/amazon/worker",
];

// Prefixos públicos (pasta pública servida pelo Next).
const PUBLIC_PREFIXES = ["/_next/", "/favicon", "/public/"];

const AUTH_RATE_LIMIT_PATHS = new Set([
  "/api/auth/2fa/verificar",
  "/api/auth/recuperar-senha",
  "/api/auth/redefinir-senha",
]);

const BODY_SIZE_LIMITS = new Map<string, number>([
  ["/api/vendas/importar", XLSX_IMPORT_BODY_MAX_BYTES],
]);

const ADMIN_PATH_PREFIXES = [
  "/amazon",
  "/sistema",
  "/configuracoes",
  "/api/amazon",
  "/api/sistema",
  "/api/email",
  "/api/configuracoes",
];

const OPERATOR_PATH_PREFIXES = [
  "/dashboard-ecommerce",
  "/produtos",
  "/vendas",
  "/compras",
  "/avaliacoes",
  "/publicidade",
  "/api/estoque",
  "/api/produtos",
  "/api/dashboard-ecommerce",
  "/api/amazon/sync-catalog",
  "/api/amazon/sync-buybox",
];

const FINANCE_PATH_PREFIXES = [
  "/financeiro",
  "/caixa",
  "/contas-a-pagar",
  "/contas-a-receber",
  "/notas-fiscais",
  "/destinacao",
  "/dre",
  "/dashboard-ecommerce",
  "/api/caixa",
  "/api/contas-a-pagar",
  "/api/contas-a-receber",
  "/api/documentos-financeiros",
  "/api/dre",
  "/api/dashboard-ecommerce",
  "/api/produtos/resumo-tabela",
  "/api/estoque/produtos",
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

// Em producao, CSP deve bloquear por padrao. Em dev fica em Report-Only para
// nao atrapalhar HMR. `script-src-attr 'none'` corta XSS via handlers inline
// sem quebrar os scripts inline que o Next injeta para hidratacao.
function cspDirectives(): string {
  const scriptSrc =
    process.env.NODE_ENV === "production"
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

  return [
    "default-src 'self'",
    scriptSrc,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https://m.media-amazon.com https://images-na.ssl-images-amazon.com",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}

function cspHeaderName(): string {
  if (process.env.CSP_REPORT_ONLY === "true") {
    return "Content-Security-Policy-Report-Only";
  }

  if (process.env.NODE_ENV === "production" || process.env.CSP_ENFORCE === "true") {
    return "Content-Security-Policy";
  }

  return "Content-Security-Policy-Report-Only";
}

function withSecurityHeaders(res: NextResponse): NextResponse {
  const headers = res.headers;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("X-DNS-Prefetch-Control", "off");
  headers.set(cspHeaderName(), cspDirectives());

  if (process.env.NODE_ENV === "production") {
    headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }

  return res;
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isRateLimited(req: NextRequest, pathname: string): boolean {
  const ip = getClientIp(req);
  const max = AUTH_RATE_LIMIT_PATHS.has(pathname)
    ? AUTH_RATE_LIMIT_MAX
    : RATE_LIMIT_MAX;
  const key = `${pathname}:${ip}`;
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  bucket.count += 1;
  return bucket.count > max;
}

function isSameOriginMutation(req: NextRequest): boolean {
  if (!MUTATING_METHODS.has(req.method)) return true;

  const origin = req.headers.get("origin");
  if (!origin) return true;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  // Usar header Host diretamente (mais confiável que req.nextUrl.host no Edge
  // runtime atrás do Nginx). Nginx já seta Host=$host corretamente.
  const requestHost = req.headers.get("host") ?? req.nextUrl.host;
  return originUrl.host === requestHost;
}

function exceedsBodySizeLimit(req: NextRequest, pathname: string): boolean {
  const limit = BODY_SIZE_LIMITS.get(pathname);
  if (!limit) return false;

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  return Number.isFinite(contentLength) && contentLength > limit;
}

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function canAccessPath(role: string, pathname: string, method: string): boolean {
  if (role === UsuarioRole.ADMIN) return true;
  if (MUTATING_METHODS.has(method) && role === UsuarioRole.LEITURA) return false;

  const adminOnly = matchesPrefix(pathname, ADMIN_PATH_PREFIXES);
  if (adminOnly && !matchesPrefix(pathname, OPERATOR_PATH_PREFIXES)) return false;

  if (role === UsuarioRole.OPERADOR) {
    return matchesPrefix(pathname, OPERATOR_PATH_PREFIXES) || !matchesPrefix(pathname, ADMIN_PATH_PREFIXES);
  }

  if (role === UsuarioRole.FINANCEIRO) {
    return matchesPrefix(pathname, FINANCE_PATH_PREFIXES) || !matchesPrefix(pathname, ADMIN_PATH_PREFIXES);
  }

  if (role === UsuarioRole.LEITURA) {
    return !MUTATING_METHODS.has(method) && !matchesPrefix(pathname, ADMIN_PATH_PREFIXES);
  }

  return !matchesPrefix(pathname, ADMIN_PATH_PREFIXES);
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (pathname.startsWith("/api/") && isRateLimited(req, pathname)) {
    return withSecurityHeaders(
      NextResponse.json({ erro: "MUITAS_REQUISICOES" }, { status: 429 }),
    );
  }

  if (exceedsBodySizeLimit(req, pathname)) {
    return withSecurityHeaders(
      NextResponse.json({ erro: "ARQUIVO_MUITO_GRANDE" }, { status: 413 }),
    );
  }

  // Camada de PLATAFORMA (superadmin) + fluxo público de definir senha: têm auth
  // PRÓPRIA (cookie erp_plat_session via requireSuperAdmin/getPlataformaSession;
  // /definir-senha valida o token de convite). O proxy de TENANT (cookie
  // erp_session) NÃO se aplica aqui — senão /plataforma/login e /api/plataforma
  // seriam redirecionados/bloqueados pelo login do tenant. Mantemos os security
  // headers e a defesa CSRF same-origin nas mutações.
  if (
    pathname === "/plataforma" ||
    pathname.startsWith("/plataforma/") ||
    pathname === "/definir-senha" ||
    pathname.startsWith("/definir-senha/") ||
    pathname.startsWith("/api/plataforma/") ||
    pathname === "/api/definir-senha"
  ) {
    if (!isSameOriginMutation(req)) {
      return withSecurityHeaders(
        NextResponse.json({ erro: "ORIGEM_INVALIDA" }, { status: 403 }),
      );
    }
    return withSecurityHeaders(NextResponse.next());
  }

  if (isPublic(pathname)) return withSecurityHeaders(NextResponse.next());

  if (!isSameOriginMutation(req)) {
    return withSecurityHeaders(
      NextResponse.json({ erro: "ORIGEM_INVALIDA" }, { status: 403 }),
    );
  }

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySession(token);

  if (session) {
    if (!canAccessPath(session.role, pathname, req.method)) {
      if (pathname.startsWith("/api/")) {
        return withSecurityHeaders(
          NextResponse.json({ erro: "NAO_AUTORIZADO" }, { status: 403 }),
        );
      }
      const homeUrl = req.nextUrl.clone();
      homeUrl.pathname = "/home";
      homeUrl.search = "";
      return withSecurityHeaders(NextResponse.redirect(homeUrl));
    }

    return withSecurityHeaders(NextResponse.next());
  }

  // API: devolve 401 JSON em vez de redirect.
  if (pathname.startsWith("/api/")) {
    return withSecurityHeaders(
      NextResponse.json({ erro: "NAO_AUTENTICADO" }, { status: 401 }),
    );
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  if (pathname !== "/" && pathname !== "/login") {
    loginUrl.searchParams.set("next", pathname + search);
  }
  return withSecurityHeaders(NextResponse.redirect(loginUrl));
}

export const config = {
  matcher: [
    // Intercepta tudo menos arquivos estáticos comuns.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
