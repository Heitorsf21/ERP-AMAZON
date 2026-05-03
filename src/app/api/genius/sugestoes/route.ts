import { db } from "@/lib/db";
import { handle, ok } from "@/lib/api";
import { addDays } from "date-fns";

export const dynamic = "force-dynamic";

export type TipoSugestao =
  | "CUSTO_AUSENTE"
  | "RESTOCK"
  | "RETURNS_ALTO"
  | "ACOS_ALTO"
  | "REIMBURSEMENT_RECEBIDO"
  | "BUYBOX_PERDIDO";

export type Sugestao = {
  id: string;
  tipo: TipoSugestao;
  prioridade: number;
  produtoId: string | null;
  sku: string | null;
  nomeProduto: string | null;
  titulo: string;
  descricao: string;
  acaoSugerida: string;
  impactoCentavos: number | null;
};

export type GeniusResponse = {
  sugestoes: Sugestao[];
  totais: {
    total: number;
    urgente: number;
    semCustoCount: number;
    restockCount: number;
    reimbursementTotalCentavos: number;
    returnsTotalCentavos: number;
  };
};

export const GET = handle(async () => {
  const now = new Date();
  const trinta = addDays(now, -30);
  const sete = addDays(now, -7);

  const sugestoes: Sugestao[] = [];
  let _seq = 0;
  const id = (tipo: string) => `${tipo}-${++_seq}`;

  // ── 1. Custo ausente ─────────────────────────────────────────────────────
  const semCusto = await db.produto.findMany({
    where: { ativo: true, custoUnitario: null },
    select: { id: true, nome: true, sku: true },
    orderBy: { nome: "asc" },
  });
  for (const p of semCusto) {
    sugestoes.push({
      id: id("CUSTO_AUSENTE"),
      tipo: "CUSTO_AUSENTE",
      prioridade: 55,
      produtoId: p.id,
      sku: p.sku,
      nomeProduto: p.nome,
      titulo: "Custo unitário não cadastrado",
      descricao: "Sem custo, a margem e a DRE ficam imprecisas para este SKU.",
      acaoSugerida: "Cadastre o custo em /estoque → editar produto",
      impactoCentavos: null,
    });
  }

  // ── 2. Estoque abaixo do mínimo ──────────────────────────────────────────
  const todosProdutos = await db.produto.findMany({
    where: { ativo: true, NOT: { estoqueMinimo: 0 } },
    select: {
      id: true,
      nome: true,
      sku: true,
      estoqueAtual: true,
      estoqueMinimo: true,
      custoUnitario: true,
    },
  });
  for (const p of todosProdutos) {
    const atual = p.estoqueAtual ?? 0;
    const minimo = p.estoqueMinimo ?? 0;
    if (atual <= minimo) {
      const repor = Math.max(0, minimo * 2 - atual);
      const impacto = repor > 0 && p.custoUnitario ? repor * p.custoUnitario : null;
      sugestoes.push({
        id: id("RESTOCK"),
        tipo: "RESTOCK",
        prioridade: 85,
        produtoId: p.id,
        sku: p.sku,
        nomeProduto: p.nome,
        titulo: "Estoque abaixo do mínimo",
        descricao: `Atual: ${atual} un · Mínimo: ${minimo} un. Sugestão: repor ${repor} un.`,
        acaoSugerida: "Crie um pedido de compra em /compras",
        impactoCentavos: impacto,
      });
    }
  }

  // ── 3. Reimbursements FBA nos últimos 7d ─────────────────────────────────
  const reimbs = await db.amazonReimbursement.findMany({
    where: { approvalDate: { gte: sete } },
    orderBy: { amountTotalCentavos: "desc" },
    take: 15,
    select: {
      sku: true,
      reason: true,
      amountTotalCentavos: true,
      productName: true,
      produtoId: true,
    },
  });
  for (const r of reimbs) {
    const valor = r.amountTotalCentavos ?? 0;
    sugestoes.push({
      id: id("REIMBURSEMENT_RECEBIDO"),
      tipo: "REIMBURSEMENT_RECEBIDO",
      prioridade: 30,
      produtoId: r.produtoId,
      sku: r.sku,
      nomeProduto: r.productName,
      titulo: "Ressarcimento FBA recebido",
      descricao: `Motivo: ${humanizeReason(r.reason ?? "")} · Valor: R$ ${(valor / 100).toFixed(2)}.`,
      acaoSugerida: "Verifique se o valor está correto; abra caso na Amazon se divergir",
      impactoCentavos: valor,
    });
  }

  // ── 4. Returns altos — SKUs com ≥ 2 devoluções nos últimos 30d ───────────
  const returnsBySku = await db.amazonReturn.groupBy({
    by: ["sku"],
    where: { returnDate: { gte: trinta } },
    _count: { id: true },
    _sum: { valorEstimadoCentavos: true },
    orderBy: { _count: { id: "desc" } },
    take: 10,
  });
  for (const r of returnsBySku) {
    if ((r._count.id ?? 0) < 2) continue;
    const produto = r.sku
      ? await db.produto.findFirst({
          where: { sku: r.sku },
          select: { id: true, nome: true },
        })
      : null;
    const perda = r._sum.valorEstimadoCentavos ?? 0;
    sugestoes.push({
      id: id("RETURNS_ALTO"),
      tipo: "RETURNS_ALTO",
      prioridade: 70,
      produtoId: produto?.id ?? null,
      sku: r.sku,
      nomeProduto: produto?.nome ?? null,
      titulo: `${r._count.id} devoluções em 30 dias`,
      descricao: `Perda estimada: R$ ${(perda / 100).toFixed(2)}. Revise título, fotos e qualidade.`,
      acaoSugerida: "Analise os comentários em /vendas e melhore a listagem",
      impactoCentavos: perda,
    });
  }

  // ── 5. BuyBox perdido (últimos 7d) ────────────────────────────────────────
  const bbPerdidos = await db.buyBoxSnapshot.findMany({
    where: { somosBuybox: false, capturadoEm: { gte: sete } },
    distinct: ["sku"],
    orderBy: { capturadoEm: "desc" },
    take: 10,
    select: { sku: true, asin: true, precoBuybox: true, precoNosso: true, produtoId: true },
  });
  for (const bb of bbPerdidos) {
    const produto = bb.produtoId
      ? await db.produto.findUnique({
          where: { id: bb.produtoId },
          select: { nome: true },
        })
      : null;
    const diff =
      bb.precoNosso != null && bb.precoBuybox != null
        ? bb.precoNosso - bb.precoBuybox
        : null;
    sugestoes.push({
      id: id("BUYBOX_PERDIDO"),
      tipo: "BUYBOX_PERDIDO",
      prioridade: 80,
      produtoId: bb.produtoId,
      sku: bb.sku,
      nomeProduto: produto?.nome ?? null,
      titulo: "BuyBox perdido",
      descricao:
        diff != null && diff > 0
          ? `Seu preço está R$ ${(diff / 100).toFixed(2)} acima do BuyBox (R$ ${((bb.precoBuybox ?? 0) / 100).toFixed(2)}).`
          : `Você não está ganhando o BuyBox para ${bb.sku}.`,
      acaoSugerida: "Ajuste o preço no Seller Central para recuperar o BuyBox",
      impactoCentavos: null,
    });
  }

  // ── 6. ACOS alto (últimos 7d, só se houver dados de Ads) ─────────────────
  const adsCount = await db.amazonAdsMetricaDiaria.count();
  if (adsCount > 0) {
    const grupos = await db.amazonAdsMetricaDiaria.groupBy({
      by: ["sku"],
      where: {
        data: { gte: sete },
        sku: { not: null },
        gastoCentavos: { gt: 5_000 },
      },
      _sum: { gastoCentavos: true, vendasCentavos: true },
      orderBy: { _sum: { gastoCentavos: "desc" } },
      take: 10,
    });
    for (const g of grupos) {
      const gasto = g._sum.gastoCentavos ?? 0;
      const vendas = g._sum.vendasCentavos ?? 0;
      if (vendas <= 0) continue;
      const acos = gasto / vendas;
      if (acos < 0.3) continue;
      const produto = g.sku
        ? await db.produto.findFirst({
            where: { sku: g.sku },
            select: { id: true, nome: true },
          })
        : null;
      sugestoes.push({
        id: id("ACOS_ALTO"),
        tipo: "ACOS_ALTO",
        prioridade: 75,
        produtoId: produto?.id ?? null,
        sku: g.sku,
        nomeProduto: produto?.nome ?? null,
        titulo: `ACOS ${(acos * 100).toFixed(0)}% nos últimos 7 dias`,
        descricao: `Gasto: R$ ${(gasto / 100).toFixed(2)} · Vendas atribuídas: R$ ${(vendas / 100).toFixed(2)}.`,
        acaoSugerida: "Revise lances, palavras-chave negativas e orçamento no Seller Central",
        impactoCentavos: gasto,
      });
    }
  }

  sugestoes.sort((a, b) => b.prioridade - a.prioridade || (a.sku ?? "").localeCompare(b.sku ?? ""));

  const totais = {
    total: sugestoes.length,
    urgente: sugestoes.filter((s) => s.prioridade >= 75).length,
    semCustoCount: sugestoes.filter((s) => s.tipo === "CUSTO_AUSENTE").length,
    restockCount: sugestoes.filter((s) => s.tipo === "RESTOCK").length,
    reimbursementTotalCentavos: sugestoes
      .filter((s) => s.tipo === "REIMBURSEMENT_RECEBIDO")
      .reduce((acc, s) => acc + (s.impactoCentavos ?? 0), 0),
    returnsTotalCentavos: sugestoes
      .filter((s) => s.tipo === "RETURNS_ALTO")
      .reduce((acc, s) => acc + (s.impactoCentavos ?? 0), 0),
  };

  return ok<GeniusResponse>({ sugestoes, totais });
});

function humanizeReason(reason: string): string {
  const map: Record<string, string> = {
    Lost_Inbound: "Perdido na entrada",
    Lost_Warehouse: "Perdido no armazém",
    Damaged_Inbound: "Danificado na entrada",
    Damaged_Warehouse: "Danificado no armazém",
    Customer_Return: "Devolução de cliente",
    Fee_Correction: "Correção de taxa",
  };
  return map[reason] ?? reason;
}
