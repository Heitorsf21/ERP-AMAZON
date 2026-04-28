import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger } from "./logger";

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
