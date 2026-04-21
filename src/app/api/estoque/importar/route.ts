import { handle, ok } from "@/lib/api";
import { estoqueService } from "@/modules/estoque/service";

export const POST = handle(async (req: Request) => {
  const body = await req.json();
  const resultado = await estoqueService.importarProdutos(body);
  return ok(resultado);
});
