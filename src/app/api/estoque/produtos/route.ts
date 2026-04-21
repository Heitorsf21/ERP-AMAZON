import { handle, ok } from "@/lib/api";
import { estoqueService } from "@/modules/estoque/service";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const produtos = await estoqueService.listarProdutos({
    busca: searchParams.get("busca") ?? undefined,
    ativo: searchParams.get("ativo") ?? undefined,
    statusReposicao: searchParams.get("statusReposicao") ?? undefined,
  });
  return ok(produtos);
});

export const POST = handle(async (req: Request) => {
  const body = await req.json();
  const produto = await estoqueService.criarProduto(body);
  return ok(produto, { status: 201 });
});
