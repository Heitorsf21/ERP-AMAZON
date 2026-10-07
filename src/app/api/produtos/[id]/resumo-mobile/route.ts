import { handleAuth, ok, erro } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolverImagemProduto } from "@/lib/amazon-images";
import { getConfigImpostoSimples } from "@/modules/configuracao/imposto-simples";
import { calcularFeesLocal, loadFeeEstimatorConfig } from "@/modules/produtos/fee-estimator";
import { calcularCobertura } from "@/modules/produtos/cobertura";
import {
  calcularUnidadeEstimada,
  custoAtualDoResumo,
  type ResumoMobileProduto,
} from "@/modules/produtos/resumo-mobile";
import { whereVendaAmazonContabilizavelEstrito } from "@/modules/vendas/filtros";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// handleAuth (e não handle + requireSession): amarra o contexto de tenant via
// runWithTenant para TODO o handler. Sem isso, getConfigImpostoSimples (config
// GLOBAL com chave por empresa) leria a alíquota da empresa primária. Papel
// igual ao das demais rotas de produto (custo e margem: ADMIN/OPERADOR).
export const GET = handleAuth([UsuarioRole.OPERADOR], async (_req: Request, { params }: Params) => {
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
  const [vendas, vigencias, cfgFees, imposto] = await Promise.all([
    db.vendaAmazon.aggregate({
      where: whereVendaAmazonContabilizavelEstrito({
        sku: produto.sku,
        dataVenda: { gte: new Date(hoje.getTime() - 30 * 86_400_000) },
      }),
      _sum: { quantidade: true },
    }),
    // Mesmo filtro de resolverCustoUnitario: a vigência que cobre HOJE define
    // tanto o valor quanto o "Vigente desde" (uma única fonte para os dois).
    db.produtoCustoHistorico.findMany({
      where: {
        produtoId: produto.id,
        vigenciaInicio: { lte: hoje },
        OR: [{ vigenciaFim: null }, { vigenciaFim: { gt: hoje } }],
      },
      orderBy: { vigenciaInicio: "desc" },
      take: 1,
      select: { custoCentavos: true, vigenciaInicio: true, vigenciaFim: true },
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
  const custo = custoAtualDoResumo(vigencias, produto.custoUnitario ?? null, hoje);
  const custoCentavos = custo.centavos;
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
    custo,
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
