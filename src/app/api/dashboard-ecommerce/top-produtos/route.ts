import { handleAuth, ok } from "@/lib/api";
import { resolverPeriodoDeBusca } from "@/lib/periodo";
import { dashboardEcommerceService } from "@/modules/dashboard-ecommerce/service";
import { consolidarTopProdutos } from "@/modules/lojas/consolidado";
import { lojasDaVisaoTodas, naLoja, pedeVisaoTodas } from "@/modules/lojas/visao-todas";

export const dynamic = "force-dynamic";

export const GET = handleAuth(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const periodo = resolverPeriodoDeBusca(searchParams);
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? 15)));
  const todas = pedeVisaoTodas(searchParams) ? await lojasDaVisaoTodas() : null;

  if (!todas) {
    const { produtos } = await dashboardEcommerceService.obterTopProdutosComTotal(periodo, limit);
    return ok(produtos);
  }

  // O top N de cada loja basta: o top N global está dentro da união deles.
  const listas = await Promise.all(
    todas.lojas.map((loja) =>
      naLoja(loja.empresaId, async () => ({
        loja,
        ...(await dashboardEcommerceService.obterTopProdutosComTotal(periodo, limit)),
      })),
    ),
  );
  return ok(consolidarTopProdutos(listas, limit, todas.atualEmpresaId));
});
