import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/session";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
const RATE_LIMIT_MAX = 300;
const AUTH_RATE_LIMIT_MAX = 10;
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
  "/api/auth/login",
  "/api/auth/2fa/verificar",
  "/api/auth/recuperar-senha",
  "/api/auth/redefinir-senha",
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

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
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

  return (
    originUrl.protocol === req.nextUrl.protocol &&
    originUrl.host === req.nextUrl.host
  );
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (pathname.startsWith("/api/") && isRateLimited(req, pathname)) {
    return withSecurityHeaders(
      NextResponse.json({ erro: "MUITAS_REQUISICOES" }, { status: 429 }),
    );
  }

  if (!isSameOriginMutation(req)) {
    return withSecurityHeaders(
      NextResponse.json({ erro: "ORIGEM_INVALIDA" }, { status: 403 }),
    );
  }

  if (isPublic(pathname)) return withSecurityHeaders(NextResponse.next());

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySession(token);

  if (session) {
    const adminOnly = ADMIN_PATH_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );
    if (adminOnly && session.role !== "ADMIN") {
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
