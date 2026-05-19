/**
 * Diagnóstico Gestor Seller — read-only.
 *
 * Inventário de tudo que o ERP herdou do fluxo `audit-amazon-reliability --apply`:
 *   1) Snapshots em ConfiguracaoSistema com chave `gestor_seller_snapshot:*`
 *   2) Overrides em AmazonReembolso (statusFinanceiro=GESTOR_SELLER,
 *      motivoCategoria=GESTOR_SELLER_VALIDATION, ou referenciaExterna LIKE 'gestor-seller:%')
 *
 * Para cada override, cruza com AmazonFinanceTransaction e classifica:
 *   🟢 NOTIFICADO_REFUND   — já tem evento Refund equivalente; seguro deletar
 *   🟢 NOTIFICADO_SAFETCLAIM — tem SAFETClaim; será regenerado após o fix do normalizer
 *   🟢 NOTIFICADO_ADJUSTMENT — tem Adjustment com ProductCharges < 0; idem
 *   🟡 SEM_NOTIFICACAO     — sem evento equivalente na API; investigar caso a caso
 *   🔴 FORA_DA_JANELA      — venda anterior a hoje-23m (limite da Finance Events API)
 *
 * NÃO escreve nada no banco. Use `--json` para saída estruturada.
 *
 * Exemplos:
 *   npx tsx scripts/diagnostico-gestor-seller.ts
 *   npx tsx scripts/diagnostico-gestor-seller.ts --json > diag.json
 *   npx tsx scripts/diagnostico-gestor-seller.ts --balde SEM_NOTIFICACAO
 */
import { db } from "@/lib/db";
import { normalizeFinanceTransaction } from "@/modules/amazon/finance-normalizer";

type Args = {
  json: boolean;
  balde?: BaldeClass;
  limit: number;
};

type BaldeClass =
  | "NOTIFICADO_REFUND"
  | "NOTIFICADO_SAFETCLAIM"
  | "NOTIFICADO_ADJUSTMENT"
  | "SEM_NOTIFICACAO"
  | "FORA_DA_JANELA";

type OverrideRow = {
  id: string;
  amazonOrderId: string;
  sku: string;
  valorReembolsadoCentavos: number;
  dataReembolso: Date;
  referenciaExterna: string;
  statusFinanceiro: string | null;
  motivoCategoria: string | null;
};

type FinanceTxLite = {
  transactionId: string;
  transactionType: string | null;
  transactionStatus: string | null;
  postedDate: Date | null;
  amazonOrderId: string | null;
  sku: string | null;
  payload: unknown;
};

type Classificacao = {
  override: OverrideRow;
  balde: BaldeClass;
  evidencia?: {
    transactionId: string;
    transactionType: string | null;
    productChargesCentavos?: number;
  };
};

const JANELA_API_DIAS = 23 * 30; // ~23 meses, limite Finance Events API

async function main() {
  const args = parseArgs();
  assertDatabaseConfigured();

  const snapshots = await listarSnapshots();
  const overrides = await listarOverrides();
  const classificacoes = await classificarOverrides(overrides);

  if (args.json) {
    console.log(JSON.stringify({ snapshots, overrides: classificacoes }, null, 2));
    await db.$disconnect();
    return;
  }

  printSnapshots(snapshots);
  printResumo(classificacoes);

  if (args.balde) {
    printBaldeDetalhe(classificacoes, args.balde, args.limit);
  } else {
    // imprime amostra de cada balde
    for (const balde of [
      "SEM_NOTIFICACAO",
      "NOTIFICADO_SAFETCLAIM",
      "NOTIFICADO_ADJUSTMENT",
      "FORA_DA_JANELA",
    ] as const) {
      printBaldeDetalhe(classificacoes, balde, 10);
    }
  }

  printRecomendacao(classificacoes);
  await db.$disconnect();
}

function assertDatabaseConfigured() {
  if (process.env.DATABASE_URL) return;
  throw new Error("DATABASE_URL nao esta configurado neste ambiente.");
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const baldeArg = readArg(argv, "--balde");
  const limitArg = readArg(argv, "--limit");
  return {
    json: argv.includes("--json"),
    balde: baldeArg ? (baldeArg as BaldeClass) : undefined,
    limit: limitArg ? Number(limitArg) || 50 : 50,
  };
}

function readArg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function listarSnapshots() {
  const rows = await db.configuracaoSistema.findMany({
    where: { chave: { startsWith: "gestor_seller_snapshot:" } },
    orderBy: { chave: "asc" },
  });
  return rows.map((row) => {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(row.valor) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    return {
      chave: row.chave,
      janela: row.chave.replace("gestor_seller_snapshot:", ""),
      atualizadoEm:
        (parsed?.atualizadoEm as string | undefined) ??
        row.updatedAt?.toISOString(),
      faturamentoCentavos:
        (parsed?.faturamentoCentavos as number | undefined) ?? null,
      liquidoMarketplaceCentavos:
        (parsed?.liquidoMarketplaceCentavos as number | undefined) ?? null,
      faturamentoReembolsadoCentavos:
        (parsed?.faturamentoReembolsadoCentavos as number | undefined) ?? null,
    };
  });
}

async function listarOverrides(): Promise<OverrideRow[]> {
  return db.amazonReembolso.findMany({
    where: {
      OR: [
        { statusFinanceiro: "GESTOR_SELLER" },
        { motivoCategoria: "GESTOR_SELLER_VALIDATION" },
        { referenciaExterna: { startsWith: "gestor-seller:" } },
      ],
    },
    orderBy: { dataReembolso: "asc" },
    select: {
      id: true,
      amazonOrderId: true,
      sku: true,
      valorReembolsadoCentavos: true,
      dataReembolso: true,
      referenciaExterna: true,
      statusFinanceiro: true,
      motivoCategoria: true,
    },
  });
}

async function classificarOverrides(
  overrides: OverrideRow[],
): Promise<Classificacao[]> {
  if (overrides.length === 0) return [];

  // Pré-carrega todas as finance transactions desses orderIds em 1 query.
  const orderIds = [...new Set(overrides.map((o) => o.amazonOrderId))];
  const txs = await db.amazonFinanceTransaction.findMany({
    where: { amazonOrderId: { in: orderIds } },
    select: {
      transactionId: true,
      transactionType: true,
      transactionStatus: true,
      postedDate: true,
      amazonOrderId: true,
      sku: true,
      payload: true,
    },
  });
  const txsPorOrder = new Map<string, FinanceTxLite[]>();
  for (const tx of txs) {
    if (!tx.amazonOrderId) continue;
    const arr = txsPorOrder.get(tx.amazonOrderId) ?? [];
    arr.push(tx);
    txsPorOrder.set(tx.amazonOrderId, arr);
  }

  const cutoffAntigo = new Date(
    Date.now() - JANELA_API_DIAS * 24 * 60 * 60 * 1000,
  );

  return overrides.map((override) => classificar(override, txsPorOrder, cutoffAntigo));
}

function classificar(
  override: OverrideRow,
  txsPorOrder: Map<string, FinanceTxLite[]>,
  cutoffAntigo: Date,
): Classificacao {
  const candidatos = txsPorOrder.get(override.amazonOrderId) ?? [];

  // Considera só tx do mesmo SKU (quando informado) ou genéricas
  const relevantes = candidatos.filter(
    (tx) => !tx.sku || tx.sku === override.sku,
  );

  // 🟢 Refund explícito
  const refund = relevantes.find((tx) =>
    isRefundLike(tx.transactionType, tx.transactionStatus),
  );
  if (refund) {
    return {
      override,
      balde: "NOTIFICADO_REFUND",
      evidencia: {
        transactionId: refund.transactionId,
        transactionType: refund.transactionType,
      },
    };
  }

  // 🟢 SAFETClaim
  const safet = relevantes.find((tx) => isSafetClaim(tx.transactionType));
  if (safet) {
    return {
      override,
      balde: "NOTIFICADO_SAFETCLAIM",
      evidencia: {
        transactionId: safet.transactionId,
        transactionType: safet.transactionType,
      },
    };
  }

  // 🟢 Adjustment com ProductCharges negativo
  for (const tx of relevantes) {
    if (!isAdjustment(tx.transactionType)) continue;
    const productCharges = inspecionarProductCharges(tx.payload, override.sku);
    if (productCharges != null && productCharges < 0) {
      return {
        override,
        balde: "NOTIFICADO_ADJUSTMENT",
        evidencia: {
          transactionId: tx.transactionId,
          transactionType: tx.transactionType,
          productChargesCentavos: productCharges,
        },
      };
    }
  }

  // 🔴 Fora da janela 23 meses
  if (override.dataReembolso < cutoffAntigo) {
    return { override, balde: "FORA_DA_JANELA" };
  }

  // 🟡 Sem notificação na janela — caso a investigar
  return { override, balde: "SEM_NOTIFICACAO" };
}

function isRefundLike(
  transactionType: string | null | undefined,
  transactionStatus: string | null | undefined,
): boolean {
  const t = `${transactionType ?? ""} ${transactionStatus ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  return t.includes("refund") || t.includes("reembolso");
}

function isSafetClaim(transactionType: string | null | undefined): boolean {
  const t = (transactionType ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return t.includes("safet");
}

function isAdjustment(transactionType: string | null | undefined): boolean {
  const t = (transactionType ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return t === "adjustment" || t === "orderadjustment";
}

function inspecionarProductCharges(
  payload: unknown,
  skuAlvo: string,
): number | null {
  try {
    const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
    const normalized = normalizeFinanceTransaction(parsed);
    if (!normalized) return null;
    const item =
      normalized.items.find((i) => i.sku === skuAlvo) ?? normalized.items[0];
    if (!item) return null;
    return item.productChargesCentavos;
  } catch {
    return null;
  }
}

function printSnapshots(snapshots: Awaited<ReturnType<typeof listarSnapshots>>) {
  section("Snapshots ativos (ConfiguracaoSistema)");
  if (snapshots.length === 0) {
    console.log("  (nenhum)\n");
    return;
  }
  console.log(`  Total: ${snapshots.length}\n`);
  console.table(
    snapshots.map((s) => ({
      janela: s.janela,
      atualizadoEm: s.atualizadoEm?.slice(0, 19) ?? "",
      faturamento: formatMoney(s.faturamentoCentavos),
      liquidoMarketplace: formatMoney(s.liquidoMarketplaceCentavos),
      faturamentoReembolsado: formatMoney(s.faturamentoReembolsadoCentavos),
    })),
  );
}

function printResumo(classificacoes: Classificacao[]) {
  section("Overrides Gestor Seller (AmazonReembolso) — resumo");
  if (classificacoes.length === 0) {
    console.log("  (nenhum override encontrado)\n");
    return;
  }
  const totais = new Map<BaldeClass, { qtd: number; valor: number }>();
  for (const c of classificacoes) {
    const item = totais.get(c.balde) ?? { qtd: 0, valor: 0 };
    item.qtd += 1;
    item.valor += c.override.valorReembolsadoCentavos;
    totais.set(c.balde, item);
  }
  console.log(`  Total: ${classificacoes.length} overrides\n`);
  console.table(
    [
      "NOTIFICADO_REFUND",
      "NOTIFICADO_SAFETCLAIM",
      "NOTIFICADO_ADJUSTMENT",
      "SEM_NOTIFICACAO",
      "FORA_DA_JANELA",
    ].map((balde) => {
      const t = totais.get(balde as BaldeClass) ?? { qtd: 0, valor: 0 };
      return {
        balde,
        icone: iconePorBalde(balde as BaldeClass),
        qtd: t.qtd,
        valor: formatMoney(t.valor),
      };
    }),
  );
}

function printBaldeDetalhe(
  classificacoes: Classificacao[],
  balde: BaldeClass,
  limit: number,
) {
  const lista = classificacoes.filter((c) => c.balde === balde);
  if (lista.length === 0) return;
  section(
    `${iconePorBalde(balde)} ${balde} (${lista.length} total, mostrando até ${limit})`,
  );
  console.table(
    lista.slice(0, limit).map((c) => ({
      orderId: c.override.amazonOrderId,
      sku: c.override.sku,
      data: c.override.dataReembolso.toISOString().slice(0, 10),
      valor: formatMoney(c.override.valorReembolsadoCentavos),
      evidencia:
        c.evidencia?.transactionType ?? c.evidencia?.transactionId ?? "",
      productCharges:
        c.evidencia?.productChargesCentavos != null
          ? formatMoney(c.evidencia.productChargesCentavos)
          : "",
    })),
  );
}

function printRecomendacao(classificacoes: Classificacao[]) {
  section("Recomendação");
  const totais = new Map<BaldeClass, number>();
  for (const c of classificacoes) {
    totais.set(c.balde, (totais.get(c.balde) ?? 0) + 1);
  }
  const recRefund = totais.get("NOTIFICADO_REFUND") ?? 0;
  const recSafet = totais.get("NOTIFICADO_SAFETCLAIM") ?? 0;
  const recAdj = totais.get("NOTIFICADO_ADJUSTMENT") ?? 0;
  const sem = totais.get("SEM_NOTIFICACAO") ?? 0;
  const fora = totais.get("FORA_DA_JANELA") ?? 0;

  console.log(`
  🟢 Reproduzíveis pela SP-API: ${recRefund + recSafet + recAdj}
     → seguro deletar; o pipeline regenera após:
        - Refund (${recRefund}): já com filtro atual
        - SAFETClaim (${recSafet}): após fix em isRefundTransaction
        - Adjustment com ProductCharges<0 (${recAdj}): após fix em isRefundTransaction

  🟡 Sem notificação na janela: ${sem}
     → INVESTIGAR antes de qualquer ação. Sugestões:
        a) Rodar 'amazon:reliability:audit --check order-id <ORDER_ID>' em cada um
        b) Forçar FINANCES_BACKFILL na janela das datas para garantir cobertura
        c) Se confirmado que API realmente nunca notificou, renomear motivoCategoria
           para REFUND_API_NUNCA_NOTIFICOU e manter.

  🔴 Fora da janela 23 meses: ${fora}
     → órfãos genuínos. Sem alternativa via API. Renomear motivoCategoria
       para REFUND_ORFAO_PRE_API e manter.
`);
}

function iconePorBalde(balde: BaldeClass): string {
  switch (balde) {
    case "NOTIFICADO_REFUND":
    case "NOTIFICADO_SAFETCLAIM":
    case "NOTIFICADO_ADJUSTMENT":
      return "🟢";
    case "SEM_NOTIFICACAO":
      return "🟡";
    case "FORA_DA_JANELA":
      return "🔴";
  }
}

function formatMoney(centavos: number | null | undefined): string {
  if (centavos == null) return "—";
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function section(title: string) {
  console.log(`\n${"=".repeat(80)}\n${title}\n${"=".repeat(80)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
