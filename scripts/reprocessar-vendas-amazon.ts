/**
 * Reprocessa todas as VendaAmazon existentes que estao com precoUnitarioCentavos = 0
 * (ou liquidoMarketplaceCentavos = null), buscando os itens detalhados de cada
 * pedido pela Orders API (/orders/v0/orders/{id}/orderItems).
 *
 * Uso:
 *   npm run amazon:reprocessar-vendas
 *
 * NAO roda automaticamente. Operador deve rodar manualmente apos validar o fluxo.
 */
import { db } from "@/lib/db";
import { decryptConfigValue } from "@/lib/crypto";
import {
  getOrderItems,
  type SPAPICredentials,
  type SPOrderItemDetail,
} from "@/lib/amazon-sp-api";

function parseAmountCentavos(v: { Amount?: string } | undefined | null): number {
  if (!v?.Amount) return 0;
  const n = Number(v.Amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
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

type VendaProblema = {
  amazonOrderId: string;
  sku: string;
  motivo: string;
};

async function main() {
  const creds = await loadCredentials();
  if (!creds) {
    console.error("ERRO: credenciais Amazon nao configuradas.");
    process.exit(1);
  }

  // Lista pedidos unicos com vendas problematicas (preco zerado ou liquido nulo).
  const pedidosUnicos = await db.vendaAmazon.findMany({
    where: {
      OR: [
        { precoUnitarioCentavos: 0 },
        { liquidoMarketplaceCentavos: null },
      ],
    },
    select: { amazonOrderId: true },
    distinct: ["amazonOrderId"],
  });

  console.log(`Encontrados ${pedidosUnicos.length} pedidos para reprocessar.\n`);

  const problemas: VendaProblema[] = [];
  let totalAtualizadas = 0;
  let totalIgnoradas = 0;

  // Espera ate o pacing minimo do ORDERS_GET (0.5 rps + burst 30 = ~2s entre chamadas seguras).
  // Com sleep de 2.5s entre chamadas evitamos 429 e cooldowns.
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (const [idx, { amazonOrderId }] of pedidosUnicos.entries()) {
    const prefix = `[${idx + 1}/${pedidosUnicos.length}] ${amazonOrderId}`;
    let detalhes: SPOrderItemDetail[] | null = null;
    let tentativas = 0;
    while (detalhes === null && tentativas < 5) {
      tentativas++;
      try {
        detalhes = await getOrderItems(creds, amazonOrderId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Se for cooldown, extrai o timestamp e espera ate la
        const cooldownMatch = msg.match(/cooldown ate ([0-9TZ:.-]+)/);
        if (cooldownMatch?.[1]) {
          const ate = new Date(cooldownMatch[1]).getTime();
          const espera = Math.max(1000, ate - Date.now() + 500);
          console.log(`${prefix} -> aguardando cooldown ${Math.ceil(espera / 1000)}s...`);
          await sleep(espera);
          continue;
        }
        // Erro nao-cooldown: registra e desiste deste pedido
        console.log(`${prefix} -> ERRO: ${msg.slice(0, 120)}`);
        const vendas = await db.vendaAmazon.findMany({
          where: { amazonOrderId },
          select: { sku: true },
        });
        for (const v of vendas) {
          problemas.push({ amazonOrderId, sku: v.sku, motivo: msg.slice(0, 120) });
        }
        break;
      }
    }
    if (!detalhes) continue;

    if (detalhes.length === 0) {
      console.log(`${prefix} -> 0 itens retornados`);
      continue;
    }

    for (const item of detalhes) {
      const sku = item.SellerSKU;
      if (!sku) {
        problemas.push({
          amazonOrderId,
          sku: "(sem SKU)",
          motivo: "item sem SellerSKU",
        });
        continue;
      }

      const venda = await db.vendaAmazon.findUnique({
        where: { amazonOrderId_sku: { amazonOrderId, sku } },
      });
      if (!venda) {
        // Item retornado pela Amazon que nao existe na nossa tabela —
        // pode acontecer se o SKU mudou. Apenas ignoramos.
        totalIgnoradas++;
        continue;
      }

      const quantidade = Math.max(1, Number(item.QuantityOrdered || venda.quantidade || 1));
      const valorBrutoCentavos = parseAmountCentavos(item.ItemPrice);
      const fretesCentavos = parseAmountCentavos(item.ShippingPrice);
      const taxasCentavos =
        parseAmountCentavos(item.ItemTax) + parseAmountCentavos(item.ShippingTax);
      const precoUnitarioCentavos =
        quantidade > 0
          ? Math.round(valorBrutoCentavos / quantidade)
          : valorBrutoCentavos;
      const liquidoMarketplaceCentavos = valorBrutoCentavos - taxasCentavos;

      if (valorBrutoCentavos === 0) {
        problemas.push({
          amazonOrderId,
          sku,
          motivo: "ItemPrice.Amount ausente ou zero na resposta da Amazon",
        });
      }

      await db.vendaAmazon.update({
        where: { id: venda.id },
        data: {
          orderItemId: item.OrderItemId ?? venda.orderItemId,
          asin: item.ASIN ?? venda.asin,
          titulo: item.Title ?? venda.titulo,
          quantidade,
          precoUnitarioCentavos,
          valorBrutoCentavos,
          taxasCentavos,
          fretesCentavos,
          liquidoMarketplaceCentavos,
          ultimaSyncEm: new Date(),
        },
      });
      totalAtualizadas++;
    }

    console.log(
      `${prefix} -> ${detalhes.length} itens reprocessados (bruto p/ pedido: ${detalhes
        .map((d) => parseAmountCentavos(d.ItemPrice))
        .reduce((a, b) => a + b, 0)} centavos)`,
    );

    // Pacing entre pedidos para nao bater rate limit.
    await sleep(2500);
  }

  console.log("\n=== RESUMO ===");
  console.log(`Pedidos processados: ${pedidosUnicos.length}`);
  console.log(`Vendas atualizadas: ${totalAtualizadas}`);
  console.log(`Vendas ignoradas (nao existiam na tabela): ${totalIgnoradas}`);
  console.log(`Problemas: ${problemas.length}`);

  if (problemas.length > 0) {
    console.log("\n=== SKUs PROBLEMATICOS ===");
    for (const p of problemas) {
      console.log(`  ${p.amazonOrderId} / ${p.sku} -> ${p.motivo}`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
