import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export type AcaoPlataforma =
  | "EMPRESA_CRIADA" | "ADMIN_CONVIDADO" | "CONVITE_REENVIADO"
  | "EMPRESA_DESATIVADA" | "EMPRESA_REATIVADA" | "LOGIN_PLATAFORMA";

export async function auditPlataforma(input: {
  plataformaUsuarioId?: string | null;
  acao: AcaoPlataforma;
  empresaIdAlvo?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  try {
    await db.auditPlataforma.create({
      data: {
        plataformaUsuarioId: input.plataformaUsuarioId ?? null,
        acao: input.acao,
        empresaIdAlvo: input.empresaIdAlvo ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
        ip: input.ip ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, acao: input.acao }, "[plataforma] falha ao gravar auditoria");
  }
}
