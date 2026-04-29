import { handle, ok, erro } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { estoqueService } from "@/modules/estoque/service";
import { TipoAuditLog } from "@/modules/shared/domain";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  const produto = await estoqueService.buscarProduto(id);
  if (!produto) return erro(404, "produto não encontrado");
  return ok(produto);
});

export const PATCH = handle(async (req: Request, { params }: Params) => {
  const session = await requireRole(UsuarioRole.ADMIN, UsuarioRole.OPERADOR);
  const { id } = await params;
  const antes = await estoqueService.buscarProduto(id);
  const body = await req.json();
  const produto = await estoqueService.atualizarProduto(id, body);
  await auditLog({
    session,
    req,
    acao: TipoAuditLog.PRODUTO_ATUALIZADO,
    entidade: "Produto",
    entidadeId: id,
    antes,
    depois: produto,
  });
  return ok(produto);
});

export const DELETE = handle(async (_req: Request, { params }: Params) => {
  const session = await requireRole(UsuarioRole.ADMIN, UsuarioRole.OPERADOR);
  const { id } = await params;
  const antes = await estoqueService.buscarProduto(id);
  await estoqueService.desativarProduto(id);
  await auditLog({
    session,
    req: _req,
    acao: TipoAuditLog.PRODUTO_DESATIVADO,
    entidade: "Produto",
    entidadeId: id,
    antes,
    depois: { ativo: false },
  });
  return ok({ ok: true });
});
