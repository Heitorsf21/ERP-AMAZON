import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { estoqueService } from "@/modules/estoque/service";

export const POST = handleAuth(
  [UsuarioRole.OPERADOR],
  async (req: Request) => {
    const body = await req.json();
    const resultado = await estoqueService.importarProdutos(body);
    return ok(resultado);
  },
);
