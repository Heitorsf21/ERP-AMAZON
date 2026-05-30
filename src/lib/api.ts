import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger } from "./logger";
import { requireRole, requireSession, withTenantContextFromSession } from "./auth";
import type { UsuarioRole as UsuarioRoleType } from "@/modules/shared/domain";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function erro(status: number, mensagem: string, detalhes?: unknown) {
  return NextResponse.json({ erro: mensagem, detalhes }, { status });
}

function sanitizeErrorMessage(message: string): string {
  return message.replace(
    /([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|SENHA|KEY|AUTHORIZATION)[A-Z0-9_]*=)[^\s&]+/gi,
    "$1[redacted]",
  );
}

// Wrapper usado nas route handlers: normaliza erros (Zod -> 400, Error -> 400,
// resto -> 500) e loga o suficiente para depurar.
export function handle<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response>,
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof Response) {
        return e;
      }
      if (e instanceof ZodError) {
        return erro(400, "dados inválidos", e.flatten());
      }
      if (e instanceof Error) {
        logger.warn({ err: sanitizeErrorMessage(e.message) }, "api error");
        return erro(400, "requisicao invalida");
      }
      logger.error({ err: e }, "erro inesperado");
      return erro(500, "erro inesperado");
    }
  };
}

/**
 * Defense-in-depth para route handlers. Chama requireSession() (ou
 * requireRole quando roles passados) ANTES do handler de negocio.
 *
 * Uso:
 *   export const GET = handleAuth(async (req) => { ... });
 *   export const POST = handleAuth([UsuarioRole.ADMIN], async (req) => { ... });
 *
 * Substitui o padrao `await requireSession(); ...` repetido em cada handler.
 */
export function handleAuth<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response>;
export function handleAuth<Args extends unknown[]>(
  roles: UsuarioRoleType[],
  fn: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response>;
export function handleAuth<Args extends unknown[]>(
  rolesOrFn: UsuarioRoleType[] | ((...args: Args) => Promise<Response>),
  maybeFn?: (...args: Args) => Promise<Response>,
) {
  const roles = Array.isArray(rolesOrFn) ? rolesOrFn : null;
  const fn = (Array.isArray(rolesOrFn) ? maybeFn : rolesOrFn) as (
    ...args: Args
  ) => Promise<Response>;

  return handle(async (...args: Args): Promise<Response> => {
    const session =
      roles && roles.length > 0
        ? await requireRole(...roles)
        : await requireSession();
    // Popula o AsyncLocalStorage de tenant para a extensao de isolamento (db.ts).
    // Em TENANT_ISOLATION=off e inocuo; em enforce escopa as queries da rota a
    // empresa da sessao. Cobre todas as rotas que usam handleAuth.
    return withTenantContextFromSession(session, () => fn(...args));
  });
}
