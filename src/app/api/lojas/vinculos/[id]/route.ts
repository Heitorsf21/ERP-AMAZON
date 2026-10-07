import { handle, ok, erro } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { originViolationResponse } from "@/lib/origin-check";
import { removerVinculo } from "@/modules/lojas/vinculos";
import { TipoAuditLog } from "@/modules/shared/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Desfaz um vínculo do qual a conta da sessão faz parte (qualquer lado). */
export const DELETE = handle(async (req: Request, { params }: Params) => {
  const origemBloqueada = originViolationResponse(req);
  if (origemBloqueada) return origemBloqueada;
  const session = await requireSession();
  const { id } = await params;
  const removido = await removerVinculo(session.uid, id);
  if (!removido) return erro(404, "VINCULO_NAO_ENCONTRADO");
  await auditLog({
    session,
    req,
    acao: TipoAuditLog.LOJA_DESVINCULADA,
    entidade: "VinculoLoja",
    entidadeId: id,
  });
  return ok({ ok: true });
});
