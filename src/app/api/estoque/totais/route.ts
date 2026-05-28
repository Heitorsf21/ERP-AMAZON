import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { estoqueService } from "@/modules/estoque/service";

export const dynamic = "force-dynamic";

export const GET = handleAuth([UsuarioRole.OPERADOR], async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const totais = await estoqueService.totais({
    busca: searchParams.get("busca") ?? undefined,
    ativo: searchParams.get("ativo") ?? undefined,
    statusReposicao: searchParams.get("statusReposicao") ?? undefined,
    incluirNaoMfs: searchParams.get("incluirNaoMfs") ?? undefined,
    estoque: searchParams.get("estoque") ?? undefined,
    semCusto: searchParams.get("semCusto") ?? undefined,
    semSyncAmazon: searchParams.get("semSyncAmazon") ?? undefined,
    temCusto: searchParams.get("temCusto") ?? undefined,
  });
  return ok(totais);
});
