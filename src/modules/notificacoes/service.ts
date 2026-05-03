import { subDays, format, startOfDay } from "date-fns";
import { db } from "@/lib/db";
import { whereVendaAmazonContabilizavel } from "@/modules/vendas/filtros";

export type TipoNotificacao =
  | "ESTOQUE_CRITICO"
  | "BUYBOX_PERDIDO"
  | "REEMBOLSO_ALTO"
  | "REIMBURSEMENT_FBA_RECEBIDO"
  | "ACOS_ALTO"
  | "LIQUIDACAO_ATRASADA"
  | "CUSTO_AUSENTE";

export const notificacaoService = {
  async gerarNotificacoes(): Promise<{ criadas: number; verificadas: number }> {
    const hoje = format(new Date(), "yyyy-MM-dd");
    type NovaNotif = {
      tipo: string;
      titulo: string;
      descricao: string;
      linkRef?: string;
      dedupeKey: string;
    };
    const candidatas: NovaNotif[] = [];

    // 1. Estoque crítico (< 15 dias de vendas)
    const desde30d = subDays(new Date(), 30);
    const [produtos, vendas30d] = await Promise.all([
      db.produto.findMany({
        where: { ativo: true },
        select: { id: true, sku: true, nome: true, estoqueAtual: true },
      }),
      db.vendaAmazon.groupBy({
        by: ["sku"],
        where: whereVendaAmazonContabilizavel({
          dataVenda: { gte: desde30d },
        }),
        _sum: { quantidade: true },
      }),
    ]);

    const vendasPorSku = new Map(
      vendas30d.map((v) => [v.sku, v._sum.quantidade ?? 0]),
    );

    for (const p of produtos) {
      const vendido30d = vendasPorSku.get(p.sku) ?? 0;
      const unidadesPorDia = vendido30d / 30;
      if (unidadesPorDia <= 0) continue;
      const diasEstoque = Math.floor(p.estoqueAtual / unidadesPorDia);
      if (diasEstoque < 15) {
        candidatas.push({
          tipo: "ESTOQUE_CRITICO",
          titulo: `Estoque crítico: ${p.nome || p.sku}`,
          descricao: `${diasEstoque} dia${diasEstoque === 1 ? "" : "s"} restante${diasEstoque === 1 ? "" : "s"} de estoque (${unidadesPorDia.toFixed(1)} un/dia)`,
          linkRef: "/produtos",
          dedupeKey: `ESTOQUE_CRITICO:${p.sku}:${hoje}`,
        });
      }
    }

    // 2. Buybox perdida há > 7 dias
    const seteAtras = subDays(new Date(), 7);
    const buyboxPerdidos = await db.produto.findMany({
      where: {
        ativo: true,
        buyboxGanho: false,
        buyboxUltimaSyncEm: { lte: seteAtras },
      },
      select: { id: true, sku: true, nome: true, buyboxUltimaSyncEm: true },
    });

    for (const p of buyboxPerdidos) {
      candidatas.push({
        tipo: "BUYBOX_PERDIDO",
        titulo: `Buybox perdida: ${p.nome || p.sku}`,
        descricao: `O produto está sem o Buybox há mais de 7 dias consecutivos`,
        linkRef: "/produtos",
        dedupeKey: `BUYBOX_PERDIDO:${p.sku}:${hoje}`,
      });
    }

    // 3. Taxa de reembolso > 5% nos últimos 30 dias (por SKU)
    const reembolsos30d = await db.amazonReembolso.groupBy({
      by: ["sku"],
      where: { dataReembolso: { gte: desde30d } },
      _count: { id: true },
    });
    const vendasCountBySku = new Map(
      vendas30d.map((v) => [v.sku, v._sum.quantidade ?? 0]),
    );

    for (const r of reembolsos30d) {
      const totalVendas = vendasCountBySku.get(r.sku) ?? 0;
      if (totalVendas < 5) continue; // ignora SKUs com poucas vendas
      const taxa = (r._count.id / totalVendas) * 100;
      if (taxa > 5) {
        const produto = produtos.find((p) => p.sku === r.sku);
        candidatas.push({
          tipo: "REEMBOLSO_ALTO",
          titulo: `Reembolso elevado: ${produto?.nome || r.sku}`,
          descricao: `Taxa de ${taxa.toFixed(1)}% nos últimos 30 dias (${r._count.id} reembolsos / ${totalVendas} vendas)`,
          linkRef: "/vendas",
          dedupeKey: `REEMBOLSO_ALTO:${r.sku}:${hoje}`,
        });
      }
    }

    // 4. Settlement não reconciliado após 17 dias
    const dezesseteAtras = subDays(new Date(), 17);
    const atrasadas = await db.contaReceber.findMany({
      where: {
        status: "PENDENTE",
        origem: "AMAZON",
        dataPrevisao: { lt: dezesseteAtras },
      },
      select: { id: true, descricao: true, valor: true, dataPrevisao: true },
    });

    for (const c of atrasadas) {
      const dias = Math.floor(
        (Date.now() - (c.dataPrevisao?.getTime() ?? 0)) / 86400000,
      );
      candidatas.push({
        tipo: "LIQUIDACAO_ATRASADA",
        titulo: `Liquidação atrasada: ${c.descricao}`,
        descricao: `Prevista há ${dias} dias sem confirmação de recebimento`,
        linkRef: "/contas-a-receber",
        dedupeKey: `LIQUIDACAO_ATRASADA:${c.id}:${hoje}`,
      });
    }

    // 5. Produtos com vendas mas sem custo unitário
    const skusComVendas = [...vendasPorSku.keys()];
    const semCusto = await db.produto.findMany({
      where: {
        sku: { in: skusComVendas },
        custoUnitario: null,
        ativo: true,
      },
      select: { sku: true, nome: true },
      take: 5,
    });

    if (semCusto.length > 0) {
      const listaSkus = semCusto.map((p) => p.sku).join(", ");
      candidatas.push({
        tipo: "CUSTO_AUSENTE",
        titulo: `${semCusto.length} produto${semCusto.length > 1 ? "s" : ""} sem custo cadastrado`,
        descricao: `Margem e lucro não calculados para: ${listaSkus}`,
        linkRef: "/produtos",
        dedupeKey: `CUSTO_AUSENTE:${format(startOfDay(new Date()), "yyyy-MM-dd")}`,
      });
    }

    // 6. Campanha de Ads com ACoS > 30%
    const inicioSemana = subDays(new Date(), 7);
    const campanhasAltas = await db.adsCampanha.findMany({
      where: {
        periodoFim: { gte: inicioSemana },
        acosPercentual: { gt: 30 },
      },
      select: { nomeCampanha: true, acosPercentual: true },
      orderBy: { acosPercentual: "desc" },
      take: 3,
    });

    for (const c of campanhasAltas) {
      candidatas.push({
        tipo: "ACOS_ALTO",
        titulo: `ACoS elevado: ${c.nomeCampanha}`,
        descricao: `ACoS de ${c.acosPercentual?.toFixed(1)}% — acima do limite de 30%`,
        linkRef: "/publicidade",
        dedupeKey: `ACOS_ALTO:${c.nomeCampanha}:${hoje}`,
      });
    }

    // Inserir apenas as que não têm dedupeKey já registrada
    let criadas = 0;
    for (const n of candidatas) {
      const existe = await db.notificacao.findUnique({
        where: { dedupeKey: n.dedupeKey },
      });
      if (!existe) {
        await db.notificacao.create({ data: n });
        criadas++;
      }
    }

    return { criadas, verificadas: candidatas.length };
  },

  async listar(soNaoLidas?: boolean) {
    return db.notificacao.findMany({
      where: soNaoLidas ? { lida: false } : undefined,
      orderBy: [{ lida: "asc" }, { criadaEm: "desc" }],
      take: 200,
    });
  },

  async contarNaoLidas(): Promise<number> {
    return db.notificacao.count({ where: { lida: false } });
  },

  async marcarLida(id: string) {
    return db.notificacao.update({ where: { id }, data: { lida: true } });
  },

  async marcarTodasLidas() {
    return db.notificacao.updateMany({
      where: { lida: false },
      data: { lida: true },
    });
  },
};
