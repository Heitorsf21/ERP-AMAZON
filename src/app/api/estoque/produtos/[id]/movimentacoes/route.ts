import { handle, ok } from "@/lib/api";
import { estoqueService } from "@/modules/estoque/service";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  const movimentacoes = await estoqueService.listarMovimentacoes(id);
  return ok(movimentacoes);
});

export const POST = handle(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const body = await req.json();
  const mov = await estoqueService.registrarMovimentacao({
    ...body,
    produtoId: id,
  });
  return ok(mov, { status: 201 });
});
