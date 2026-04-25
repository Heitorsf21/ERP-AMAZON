import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/session";

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
];

// Prefixos públicos (pasta pública servida pelo Next).
const PUBLIC_PREFIXES = ["/_next/", "/favicon", "/public/"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySession(token);

  if (session) return NextResponse.next();

  // API: devolve 401 JSON em vez de redirect.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ erro: "NAO_AUTENTICADO" }, { status: 401 });
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  if (pathname !== "/" && pathname !== "/login") {
    loginUrl.searchParams.set("next", pathname + search);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Intercepta tudo menos arquivos estáticos comuns.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
