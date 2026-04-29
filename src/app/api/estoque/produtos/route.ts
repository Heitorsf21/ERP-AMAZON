import { handle, ok } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { estoqueService } from "@/modules/estoque/service";
import { TipoAuditLog } from "@/modules/shared/domain";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const produtos = await estoqueService.listarProdutos({
    busca: searchParams.get("busca") ?? undefined,
    ativo: searchParams.get("ativo") ?? undefined,
    statusReposicao: searchParams.get("statusReposicao") ?? undefined,
    incluirNaoMfs: searchParams.get("incluirNaoMfs") ?? undefined,
    temCusto: searchParams.get("temCusto") ?? undefined,
  });
  return ok(produtos);
});

export const POST = handle(async (req: Request) => {
  const session = await requireRole(UsuarioRole.ADMIN, UsuarioRole.OPERADOR);
  const body = await req.json();
  const produto = await estoqueService.criarProduto(body);
  await auditLog({
    session,
    req,
    acao: TipoAuditLog.PRODUTO_CRIADO,
    entidade: "Produto",
    entidadeId: produto.id,
    depois: produto,
  });
  return ok(produto, { status: 201 });
});
