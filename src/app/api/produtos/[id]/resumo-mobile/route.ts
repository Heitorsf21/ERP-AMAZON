import { handle, ok, erro } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolverImagemProduto } from "@/lib/amazon-images";
import { getConfigImpostoSimples } from "@/modules/configuracao/imposto-simples";
import { resolverCustoUnitario } from "@/modules/produtos/custo-historico";
import { calcularFeesLocal, loadFeeEstimatorConfig } from "@/modules/produtos/fee-estimator";
import { calcularCobertura } from "@/modules/produtos/cobertura";
import {
  calcularUnidadeEstimada,
  type ResumoMobileProduto,
} from "@/modules/produtos/resumo-mobile";
import { whereVendaAmazonContabilizavelEstrito } from "@/modules/vendas/filtros";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Params) => {
  await requireSession();
  const { id } = await params;
  // findFirst: Produto é TENANT — auto-escopado à empresa da sessão.
  const produto = await db.produto.findFirst({
    where: { id },
    select: {
      id: true,
      sku: true,
      asin: true,
      nome: true,
      ativo: true,
      imagemUrl: true,
      amazonImagemUrl: true,
      estoqueAtual: true,
      amazonEstoqueDisponivel: true,
      amazonEstoqueInbound: true,
      amazonEstoqueReservado: true,
      amazonPrecoListagemCentavos: true,
      amazonPrecoListagemSyncEm: true,
      amazonCategoriaFee: true,
      custoUnitario: true,
    },
  });
  if (!produto) return erro(404, "produto não encontrado");

  const hoje = new Date();
  const [vendas, custoVigente, vigencia, cfgFees, imposto] = await Promise.all([
    db.vendaAmazon.aggregate({
      where: whereVendaAmazonContabilizavelEstrito({
        sku: produto.sku,
        dataVenda: { gte: new Date(hoje.getTime() - 30 * 86_400_000) },
      }),
      _sum: { quantidade: true },
    }),
    resolverCustoUnitario(produto.id, hoje),
    db.produtoCustoHistorico.findFirst({
      where: { produtoId: produto.id, vigenciaInicio: { lte: hoje } },
      orderBy: { vigenciaInicio: "desc" },
      select: { vigenciaInicio: true },
    }),
    loadFeeEstimatorConfig(),
    getConfigImpostoSimples(),
  ]);

  const disponivel = produto.amazonEstoqueDisponivel ?? produto.estoqueAtual;
  const cobertura = calcularCobertura({
    estoque: disponivel,
    vendas30d: vendas._sum.quantidade ?? 0,
    hoje,
  });
  const custoCentavos = custoVigente ?? produto.custoUnitario ?? null;
  const impostoBps = imposto.ativo ? imposto.aliquotaBps : 0;
  const preco = produto.amazonPrecoListagemCentavos;
  const fees =
    preco && preco > 0
      ? calcularFeesLocal(preco, 1, cfgFees, { categoriaSlug: produto.amazonCategoriaFee })
      : null;

  const resposta: ResumoMobileProduto = {
    produto: {
      id: produto.id,
      sku: produto.sku,
      asin: produto.asin,
      nome: produto.nome,
      ativo: produto.ativo,
      imagem: produto.imagemUrl
        ? `/api/produtos/${produto.id}/imagem`
        : resolverImagemProduto(produto.amazonImagemUrl, produto.asin),
    },
    estoque: {
      disponivel,
      chegando: produto.amazonEstoqueInbound ?? 0,
      reservado: produto.amazonEstoqueReservado ?? 0,
      vendas30d: cobertura.vendas30d,
      coberturaDias: cobertura.dias,
      faixa: cobertura.faixa,
      rupturaEm: cobertura.rupturaEm,
    },
    preco: {
      centavos: preco,
      sincronizadoEm: produto.amazonPrecoListagemSyncEm?.toISOString() ?? null,
    },
    custo: {
      centavos: custoCentavos,
      vigenteDesde: vigencia?.vigenciaInicio.toISOString() ?? null,
    },
    impostoBps,
    unidade:
      preco && fees
        ? calcularUnidadeEstimada({
            precoCentavos: preco,
            custoCentavos,
            comissaoCentavos: fees.comissaoCentavos + fees.closingFeeCentavos,
            fbaCentavos: fees.fbaCentavos,
            impostoBps,
          })
        : null,
  };
  return ok(resposta);
});
