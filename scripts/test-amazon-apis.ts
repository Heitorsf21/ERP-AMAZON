/**
 * Teste de conectividade com TODAS as APIs Amazon SP-API que o ERP usa.
 *
 * Roda cada endpoint isoladamente, com janelas mínimas, e dá um relatório
 * verde/vermelho. Não escreve nada no banco — só checa se a Amazon responde.
 *
 * Uso:
 *   npm run amazon:test
 */
import { db } from "@/lib/db";
import { decryptConfigValue } from "@/lib/crypto";
import {
  getCatalogItem,
  getInventorySummaries,
  getLWAToken,
  getMarketplaceParticipations,
  getOrders,
  getProductOffers,
  getReportDocument,
  getSettlementReports,
  getSolicitationActionsForOrder,
  listFinancialTransactions,
  type SPAPICredentials,
} from "@/lib/amazon-sp-api";
import { subDays } from "date-fns";

type Result = {
  api: string;
  ok: boolean;
  detail: string;
  ms: number;
};

const results: Result[] = [];

async function check(api: string, fn: () => Promise<string>): Promise<void> {
  const start = Date.now();
  try {
    const detail = await fn();
    results.push({ api, ok: true, detail, ms: Date.now() - start });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    results.push({
      api,
      ok: false,
      detail: detail.slice(0, 240),
      ms: Date.now() - start,
    });
  }
}

async function loadCredentials(): Promise<SPAPICredentials | null> {
  const rows = await db.configuracaoSistema.findMany({
    where: { chave: { startsWith: "amazon_" } },
    select: { chave: true, valor: true },
  });
  const cfg: Record<string, string> = {};
  for (const r of rows) cfg[r.chave] = decryptConfigValue(r.valor) ?? "";

  cfg.amazon_client_id ||= process.env.AMAZON_LWA_CLIENT_ID ?? "";
  cfg.amazon_client_secret ||= process.env.AMAZON_LWA_CLIENT_SECRET ?? "";
  cfg.amazon_refresh_token ||= process.env.AMAZON_LWA_REFRESH_TOKEN ?? "";
  cfg.amazon_marketplace_id ||=
    process.env.AMAZON_MARKETPLACE_ID ?? "A2Q3Y263D00KWC";
  cfg.amazon_endpoint ||=
    process.env.AMAZON_SP_API_ENDPOINT ??
    "https://sellingpartnerapi-na.amazon.com";

  if (
    !cfg.amazon_client_id ||
    !cfg.amazon_client_secret ||
    !cfg.amazon_refresh_token ||
    !cfg.amazon_marketplace_id
  ) {
    return null;
  }
  return {
    clientId: cfg.amazon_client_id,
    clientSecret: cfg.amazon_client_secret,
    refreshToken: cfg.amazon_refresh_token,
    marketplaceId: cfg.amazon_marketplace_id,
    endpoint: cfg.amazon_endpoint || undefined,
  };
}

function fmtRow(r: Result): string {
  const icon = r.ok ? "✓" : "✗";
  const color = r.ok ? "\x1b[32m" : "\x1b[31m";
  const reset = "\x1b[0m";
  return `${color}${icon}${reset} ${r.api.padEnd(36)} ${String(r.ms).padStart(5)}ms  ${r.detail}`;
}

async function main() {
  console.log("Carregando credenciais...");
  const creds = await loadCredentials();
  if (!creds) {
    console.error(
      "ERRO: credenciais Amazon nao configuradas. Configure em /amazon ou no .env.",
    );
    process.exit(1);
  }
  console.log(
    `OK — clientId=${creds.clientId.slice(0, 12)}... marketplace=${creds.marketplaceId} endpoint=${creds.endpoint}\n`,
  );

  // 1. LWA OAuth — fundamental, todos os outros precisam disso.
  console.log("Testando LWA + cada endpoint SP-API...\n");
  let accessToken: string | null = null;
  await check("LWA OAuth (refresh_token)", async () => {
    accessToken = await getLWAToken(creds);
    return `access_token recebido (len=${accessToken.length})`;
  });

  if (!accessToken) {
    console.log("\n" + results.map(fmtRow).join("\n"));
    console.error(
      "\nLWA falhou — sem access_token, nenhum endpoint vai funcionar.",
    );
    process.exit(1);
  }

  // 2. Sellers API (sanity check, lista marketplaces ativos do vendedor)
  await check("Sellers — marketplaceParticipations", async () => {
    const r = (await getMarketplaceParticipations(creds)) as {
      payload?: Array<{ marketplace?: { name?: string } }>;
    };
    const list = r?.payload ?? [];
    return `${list.length} marketplaces ativos`;
  });

  // 3. Orders API — janela das ultimas 24h, 1 pagina
  let firstAsin: string | null = null;
  let firstOrderId: string | null = null;
  await check("Orders API — getOrders (24h)", async () => {
    const orders = await getOrders(creds, subDays(new Date(), 1), 10, {
      maxPages: 1,
      accessToken: accessToken!,
    });
    if (orders.length > 0) {
      firstOrderId = orders[0]!.orderId;
      const item = orders[0]!.orderItems?.[0];
      if (item?.product?.asin) firstAsin = item.product.asin;
    }
    return `${orders.length} pedidos retornados`;
  });

  // 4. Finances API
  await check("Finances API — listTransactions (24h)", async () => {
    const txs = await listFinancialTransactions(
      creds,
      subDays(new Date(), 1),
      undefined,
      50,
      { maxPages: 1, accessToken: accessToken! },
    );
    return `${txs.length} transacoes`;
  });

  // 5. FBA Inventory
  await check("FBA Inventory — getInventorySummaries", async () => {
    const inv = await getInventorySummaries(creds, {
      maxPages: 1,
      accessToken: accessToken!,
    });
    if (inv.length > 0 && !firstAsin) firstAsin = inv[0]!.asin;
    return `${inv.length} SKUs FBA`;
  });

  // 6. Reports API — lista settlement reports
  let firstSettlementDocId: string | null = null;
  await check("Reports API — getSettlementReports", async () => {
    const reports = await getSettlementReports(creds, 1);
    if (reports[0]?.reportDocumentId) {
      firstSettlementDocId = reports[0].reportDocumentId;
    }
    return `${reports.length} settlement reports`;
  });

  // 7. Reports API — getReportDocument (so se houver report)
  if (firstSettlementDocId) {
    await check("Reports API — getReportDocument", async () => {
      const doc = await getReportDocument(creds, firstSettlementDocId!);
      return doc?.url ? `URL recebida (compress=${doc.compressionAlgorithm ?? "none"})` : "sem URL";
    });
  } else {
    results.push({
      api: "Reports API — getReportDocument",
      ok: true,
      detail: "(pulado — nenhum settlement disponivel para teste)",
      ms: 0,
    });
  }

  // 8. Catalog Items API — só se temos algum ASIN
  if (firstAsin) {
    await check("Catalog Items — getCatalogItem", async () => {
      const item = await getCatalogItem(creds, firstAsin!);
      return item ? `ASIN ${firstAsin} -> "${item.summaries?.[0]?.itemName?.slice(0, 40) ?? "(sem titulo)"}"` : "(item null)";
    });

    // 9. Product Pricing API
    await check("Product Pricing — getProductOffers", async () => {
      const offers = await getProductOffers(creds, firstAsin!);
      return offers ? `${offers.offers?.length ?? 0} ofertas` : "(null)";
    });
  } else {
    results.push({
      api: "Catalog Items — getCatalogItem",
      ok: true,
      detail: "(pulado — nenhum ASIN encontrado)",
      ms: 0,
    });
    results.push({
      api: "Product Pricing — getProductOffers",
      ok: true,
      detail: "(pulado — nenhum ASIN encontrado)",
      ms: 0,
    });
  }

  // 10. Solicitations — só se temos algum orderId
  if (firstOrderId) {
    await check("Solicitations — getSolicitationActions", async () => {
      const r = await getSolicitationActionsForOrder(creds, firstOrderId!);
      return `canRequestReview=${r.canRequestReview}`;
    });
  } else {
    results.push({
      api: "Solicitations — getSolicitationActions",
      ok: true,
      detail: "(pulado — nenhum order id disponivel)",
      ms: 0,
    });
  }

  console.log("=== RESULTADO ===\n");
  console.log(results.map(fmtRow).join("\n"));

  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${ok} OK / ${fail} falhas / ${results.length} total`);

  process.exit(fail > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
