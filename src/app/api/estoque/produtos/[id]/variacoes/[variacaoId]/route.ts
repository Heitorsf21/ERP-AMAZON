import { handle, ok, erro } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { TipoAuditLog } from "@/modules/shared/domain";

type Params = { params: Promise<{ id: string; variacaoId: string }> };

export const dynamic = "force-dynamic";

export const DELETE = handle(async (req: Request, { params }: Params) => {
  const session = await requireRole(UsuarioRole.ADMIN, UsuarioRole.OPERADOR);
  const { id, variacaoId } = await params;

  const variacao = await db.produtoVariacao.findFirst({
    where: { id: variacaoId, produtoPaiId: id },
  });
  if (!variacao) return erro(404, "variacao nao encontrada");

  await db.produtoVariacao.delete({ where: { id: variacaoId } });
  await auditLog({
    session,
    req,
    acao: TipoAuditLog.PRODUTO_VARIACAO_REMOVIDA,
    entidade: "ProdutoVariacao",
    entidadeId: variacaoId,
    antes: variacao,
  });

  return ok({ ok: true });
});
