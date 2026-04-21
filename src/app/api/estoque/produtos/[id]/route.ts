import { handle, ok, erro } from "@/lib/api";
import { estoqueService } from "@/modules/estoque/service";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  const produto = await estoqueService.buscarProduto(id);
  if (!produto) return erro(404, "produto não encontrado");
  return ok(produto);
});

export const PATCH = handle(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const body = await req.json();
  const produto = await estoqueService.atualizarProduto(id, body);
  return ok(produto);
});

export const DELETE = handle(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  await estoqueService.desativarProduto(id);
  return ok({ ok: true });
});
