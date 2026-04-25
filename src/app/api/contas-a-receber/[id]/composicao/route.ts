import { handle, ok, erro } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Params) => {
  const { id } = await params;

  const conta = await db.contaReceber.findUnique({ where: { id } });
  if (!conta) throw new Error("conta a receber não encontrada");
  if (!conta.liquidacaoId) return erro(422, "conta sem liquidacaoId");

  const liquidacaoId = conta.liquidacaoId;

  const [vendas, reembolsos] = await Promise.all([
    db.vendaAmazon.findMany({
      where: {
        liquidacaoId,
        statusPedido: { notIn: ["Canceled"] },
      },
      select: {
        valorBrutoCentavos: true,
        taxasCentavos: true,
        fretesCentavos: true,
        liquidoMarketplaceCentavos: true,
        quantidade: true,
      },
    }),
    db.amazonReembolso.findMany({
      where: { liquidacaoId },
      select: {
        valorReembolsadoCentavos: true,
        taxasReembolsadasCentavos: true,
        quantidade: true,
      },
    }),
  ]);

  const receitaBruta = vendas.reduce((s, v) => s + (v.valorBrutoCentavos ?? 0), 0);
  const taxasMarketplace = vendas.reduce((s, v) => s + v.taxasCentavos, 0);
  const fretesFBA = vendas.reduce((s, v) => s + v.fretesCentavos, 0);
  const reembolsosTotal = reembolsos.reduce((s, r) => s + r.valorReembolsadoCentavos, 0);
  const taxasReembolso = reembolsos.reduce((s, r) => s + r.taxasReembolsadasCentavos, 0);

  // líquido calculado = receita bruta - taxas - fretes - reembolsos + taxas devolvidas nos reembolsos
  const liquidoCalculado =
    receitaBruta - taxasMarketplace - fretesFBA - reembolsosTotal + taxasReembolso;

  return ok({
    liquidacaoId,
    totalPedidos: vendas.length,
    totalReembolsos: reembolsos.length,
    receitaBrutaCentavos: receitaBruta,
    taxasMarketplaceCentavos: taxasMarketplace,
    fretesFBACentavos: fretesFBA,
    reembolsosCentavos: reembolsosTotal,
    taxasReembolsoCentavos: taxasReembolso,
    liquidoCalculadoCentavos: liquidoCalculado,
    valorRegistradoCentavos: conta.valor,
    divergenciaCentavos: conta.valor - liquidoCalculado,
  });
});
