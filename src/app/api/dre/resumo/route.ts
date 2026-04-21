import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  // Padrão: mês atual
  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59);

  const deStr = searchParams.get("de");
  const ateStr = searchParams.get("ate");

  const de = deStr ? new Date(deStr + "T00:00:00") : inicioMes;
  const ate = ateStr ? new Date(ateStr + "T23:59:59") : fimMes;

  const [contasReceber, movEntradas, contasPagas] = await Promise.all([
    db.contaReceber.findMany({
      where: { status: "RECEBIDA", dataRecebimento: { gte: de, lte: ate } },
      select: { valor: true },
    }),
    db.movimentacao.findMany({
      where: { tipo: "ENTRADA", origem: "MANUAL", dataCaixa: { gte: de, lte: ate } },
      select: { valor: true, categoria: { select: { nome: true } } },
    }),
    db.contaPagar.findMany({
      where: { status: "PAGA", pagoEm: { gte: de, lte: ate } },
      include: { categoria: true },
    }),
  ]);

  // ── Receitas ─────────────────────────────────────────────────────────────
  const receitaAmazon = contasReceber.reduce((s, c) => s + c.valor, 0);
  const outrasReceitas = movEntradas.reduce((s, m) => s + m.valor, 0);
  const totalReceitas = receitaAmazon + outrasReceitas;

  // ── Despesas por categoria ───────────────────────────────────────────────
  const porCategoria: Record<string, number> = {};
  for (const cp of contasPagas) {
    const nome = cp.categoria?.nome ?? "Outros";
    porCategoria[nome] = (porCategoria[nome] ?? 0) + cp.valor;
  }

  // ── Deduções (reduzem a receita bruta) ──────────────────────────────────
  const taxasPlataforma = porCategoria["Taxas de plataformas/pagamentos"] ?? 0;
  const fretes = porCategoria["Fretes e entregas"] ?? 0;
  const totalDeducoes = taxasPlataforma + fretes;

  const receitaLiquida = totalReceitas - totalDeducoes;

  // ── CMV ──────────────────────────────────────────────────────────────────
  const custoMercadorias = porCategoria["Compra de mercadorias/produtos"] ?? 0;

  // ── Margem Bruta ─────────────────────────────────────────────────────────
  const margemBruta = receitaLiquida - custoMercadorias;
  const percentualMargemBruta =
    receitaLiquida > 0 ? (margemBruta / receitaLiquida) * 100 : 0;

  // ── Despesas operacionais (tudo exceto CMV e deduções) ───────────────────
  const excluirDoBelowLine = new Set([
    "Compra de mercadorias/produtos",
    "Taxas de plataformas/pagamentos",
    "Fretes e entregas",
  ]);

  const despesaMarketing = porCategoria["Marketing"] ?? 0;

  const despesasOperacionais = Object.entries(porCategoria)
    .filter(([cat]) => !excluirDoBelowLine.has(cat))
    .map(([categoria, valor]) => ({ categoria, valor }))
    .sort((a, b) => b.valor - a.valor);

  const totalDespesas = despesasOperacionais.reduce((s, d) => s + d.valor, 0);

  // ── Resultado ─────────────────────────────────────────────────────────────
  const resultadoOperacional = margemBruta - totalDespesas;

  // ROI: retorno sobre custo de mercadorias
  const roi = custoMercadorias > 0 ? (resultadoOperacional / custoMercadorias) * 100 : 0;

  // MPA (Margem pós-anúncio): margem bruta menos marketing
  const mpaValor = margemBruta - despesaMarketing;
  const mpaPercentual = totalReceitas > 0 ? (mpaValor / totalReceitas) * 100 : 0;

  return ok({
    periodo: {
      de: de.toISOString().split("T")[0],
      ate: ate.toISOString().split("T")[0],
    },
    receitaAmazon,
    outrasReceitas,
    totalReceitas,
    taxasPlataforma,
    fretes,
    totalDeducoes,
    receitaLiquida,
    custoMercadorias,
    margemBruta,
    percentualMargemBruta,
    despesaMarketing,
    despesasOperacionais,
    totalDespesas,
    resultadoOperacional,
    roi,
    mpaValor,
    mpaPercentual,
    resultadoFinal: resultadoOperacional,
    quantidadeLiquidacoes: contasReceber.length,
  });
}
