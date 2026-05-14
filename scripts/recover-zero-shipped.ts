/**
 * Recovery dos pedidos VendaAmazon com statusPedido=Shipped E valorBrutoCentavos=0.
 *
 * Estrategia (somente SP-API; sem mediana, sem extrapolacao):
 *   (a) getOrderItems(amazonOrderId) -> se vier ItemPrice valido, UPDATE com
 *       precoOrigem="sp-api". Rate limit ORDERS_GET = 0.5 rps -> delay 2.5s.
 *   (b) listFinancialTransactions janela de 2 anos -> filtrar por
 *       relatedIdentifiers AmazonOrderId == pedido E somar breakdown
 *       "Principal"/"ProductCharges" do item que case com o SellerSKU.
 *
 * Modo:
 *   --dry-run (default) : nao escreve nada, so imprime relatorio.
 *   --apply             : aplica UPDATE no banco.
 *
 * Relatorio salvo em tmp/recover-zero-shipped-{ISO}.json com lista de
 * resolvidos e nao-resolvidos. Decisao sobre os nao-resolvidos fica para o
 * usuario.
 */
import { db } from "@/lib/db";
import {
  getOrderItems,
  listFinancialTransactions,
  type SPAPICredentials,
  type SPFinanceTransaction,
  type SPOrderItemDetail,
} from "@/lib/amazon-sp-api";
import { getAmazonConfig, isAmazonConfigured } from "@/modules/amazon/service";
import { subDays } from "date-fns";
import * as fs from "fs";
import * as path from "path";

type RecoveryArgs = {
  apply: boolean;
};

function parseArgs(): RecoveryArgs {
  const argv = process.argv.slice(2);
  return {
    apply: argv.includes("--apply"),
  };
}

type Resolvido = {
  amazonOrderId: string;
  sku: string;
  quantidade: number;
  fonte: "getOrderItems" | "financial-events";
  valorBrutoCentavos: number;
  taxasCentavos: number;
  fretesCentavos: number;
};

type NaoResolvido = {
  amazonOrderId: string;
  sku: string;
  quantidade: number;
  dataVenda: string;
  motivo: string;
};

async function main() {
  const args = parseArgs();
  console.log(`Modo: ${args.apply ? "APPLY (vai escrever no banco)" : "DRY-RUN"}\n`);

  const config = await getAmazonConfig();
  if (!isAmazonConfigured(config)) {
    console.error("Credenciais Amazon nao configuradas. Abortando.");
    process.exit(1);
  }
  const sp: SPAPICredentials = {
    clientId: config.amazon_client_id as string,
    clientSecret: config.amazon_client_secret as string,
    refreshToken: config.amazon_refresh_token as string,
    marketplaceId: config.amazon_marketplace_id as string,
  };

  const alvos = await db.vendaAmazon.findMany({
    where: {
      valorBrutoCentavos: 0,
      statusPedido: "Shipped",
    },
    orderBy: { dataVenda: "asc" },
    select: {
      id: true,
      amazonOrderId: true,
      sku: true,
      quantidade: true,
      dataVenda: true,
    },
  });
  console.log(`Pedidos a recuperar: ${alvos.length}\n`);
  if (alvos.length === 0) {
    console.log("Nada a fazer.");
    return;
  }

  const resolvidos: Resolvido[] = [];
  const naoResolvidos: NaoResolvido[] = [];

  // ── Estrategia (a): getOrderItems por pedido ─────────────────────────
  // Agrupa por amazonOrderId para evitar chamadas duplicadas quando ha
  // multiplos itens do mesmo pedido (raro mas possivel).
  const porOrderId = new Map<string, typeof alvos>();
  for (const v of alvos) {
    const arr = porOrderId.get(v.amazonOrderId) ?? [];
    arr.push(v);
    porOrderId.set(v.amazonOrderId, arr);
  }

  // Cache de orderItems por orderId para reusar em (b) se precisar.
  const itemsCache = new Map<string, SPOrderItemDetail[]>();
  const pendentes = new Set<string>(); // ids ainda nao resolvidos

  console.log("─── Etapa (a): getOrderItems ───");
  let idx = 0;
  for (const [orderId, vendas] of porOrderId) {
    idx++;
    process.stdout.write(`[${idx}/${porOrderId.size}] ${orderId} ... `);
    try {
      await sleep(2500); // ORDERS_GET = 0.5 rps
      const items = await getOrderItems(sp, orderId);
      itemsCache.set(orderId, items);
      let achouAlgum = false;
      for (const venda of vendas) {
        const matched = items.find((it) => it.SellerSKU === venda.sku);
        const valor = matched ? parseAmount(matched.ItemPrice) : 0;
        const taxa =
          matched
            ? parseAmount(matched.ItemTax) + parseAmount(matched.ShippingTax)
            : 0;
        const frete = matched ? parseAmount(matched.ShippingPrice) : 0;
        if (valor > 0) {
          resolvidos.push({
            amazonOrderId: orderId,
            sku: venda.sku,
            quantidade: venda.quantidade,
            fonte: "getOrderItems",
            valorBrutoCentavos: valor,
            taxasCentavos: taxa,
            fretesCentavos: frete,
          });
          if (args.apply) {
            await db.vendaAmazon.update({
              where: { id: venda.id },
              data: {
                valorBrutoCentavos: valor,
                taxasCentavos: taxa,
                fretesCentavos: frete,
                liquidoMarketplaceCentavos: valor - taxa,
                precoOrigem: "sp-api",
                ultimaSyncEm: new Date(),
              },
            });
          }
          achouAlgum = true;
        } else {
          pendentes.add(venda.id);
        }
      }
      console.log(achouAlgum ? "OK" : "vazio");
    } catch (err) {
      console.log(`ERRO: ${err instanceof Error ? err.message : err}`);
      for (const v of vendas) pendentes.add(v.id);
    }
  }

  // ── Estrategia (b): Financial Events ─────────────────────────────────
  if (pendentes.size > 0) {
    console.log(
      `\n─── Etapa (b): Financial Events (${pendentes.size} pendente(s)) ───`,
    );
    // Janela ampla: ~23 meses (limite da Finance Events API e 2 anos retroativos).
    const since = subDays(new Date(), 365 * 2 - 10);
    console.log(`Buscando transacoes desde ${since.toISOString().slice(0, 10)}...`);
    let transacoes: SPFinanceTransaction[];
    try {
      transacoes = await listFinancialTransactions(sp, since, undefined, 100, {
        maxPages: 50,
      });
      console.log(`${transacoes.length} transacoes lidas.`);
    } catch (err) {
      console.error(
        `Falha em listFinancialTransactions: ${err instanceof Error ? err.message : err}`,
      );
      transacoes = [];
    }

    // Mapa orderId -> Map<sku, {valor, taxa, frete}>
    const valorPorOrderSku = new Map<
      string,
      Map<string, { valor: number; taxa: number; frete: number }>
    >();
    for (const t of transacoes) {
      const orderId = findRelatedOrderId(t);
      if (!orderId) continue;
      // Soh nos interessa transacoes positivas (venda), nao reembolsos
      const tipo = (t.transactionType ?? "").toString().toLowerCase();
      if (tipo.includes("refund") || tipo.includes("reembolso")) continue;
      const items = readFinanceItems(t);
      for (const it of items) {
        const sku = readSku(it);
        if (!sku) continue;
        const valor = findBreakdown(it, ["Principal", "ProductCharges"]);
        const taxa = findBreakdown(it, ["AmazonFees", "Tax", "ShippingTax"]);
        const frete = findBreakdown(it, ["Shipping", "ShippingPrice"]);
        if (valor <= 0) continue;
        let porSku = valorPorOrderSku.get(orderId);
        if (!porSku) {
          porSku = new Map();
          valorPorOrderSku.set(orderId, porSku);
        }
        const atual = porSku.get(sku) ?? { valor: 0, taxa: 0, frete: 0 };
        atual.valor += valor;
        atual.taxa += taxa;
        atual.frete += frete;
        porSku.set(sku, atual);
      }
    }

    for (const venda of alvos) {
      if (!pendentes.has(venda.id)) continue;
      const porSku = valorPorOrderSku.get(venda.amazonOrderId);
      const match = porSku?.get(venda.sku);
      if (match && match.valor > 0) {
        resolvidos.push({
          amazonOrderId: venda.amazonOrderId,
          sku: venda.sku,
          quantidade: venda.quantidade,
          fonte: "financial-events",
          valorBrutoCentavos: match.valor,
          taxasCentavos: match.taxa,
          fretesCentavos: match.frete,
        });
        if (args.apply) {
          await db.vendaAmazon.update({
            where: { id: venda.id },
            data: {
              valorBrutoCentavos: match.valor,
              taxasCentavos: match.taxa,
              fretesCentavos: match.frete,
              liquidoMarketplaceCentavos: match.valor - match.taxa,
              precoOrigem: "sp-api",
              ultimaSyncEm: new Date(),
            },
          });
        }
        pendentes.delete(venda.id);
      }
    }
  }

  // ── Compila nao-resolvidos ──────────────────────────────────────────
  for (const venda of alvos) {
    if (!pendentes.has(venda.id)) continue;
    const items = itemsCache.get(venda.amazonOrderId);
    const motivo =
      items === undefined
        ? "getOrderItems falhou (erro/rate-limit) e Financial Events sem match"
        : items.length === 0
        ? "SP-API retornou orderItems vazio; Financial Events sem match"
        : "Item nao encontrado no payload da SP-API nem em Financial Events";
    naoResolvidos.push({
      amazonOrderId: venda.amazonOrderId,
      sku: venda.sku,
      quantidade: venda.quantidade,
      dataVenda: venda.dataVenda.toISOString().slice(0, 10),
      motivo,
    });
  }

  // ── Relatorio ───────────────────────────────────────────────────────
  console.log(`\n══════════════ RELATORIO ══════════════`);
  console.log(`Resolvidos via getOrderItems    : ${resolvidos.filter((r) => r.fonte === "getOrderItems").length}`);
  console.log(`Resolvidos via Financial Events : ${resolvidos.filter((r) => r.fonte === "financial-events").length}`);
  console.log(`Nao resolvidos                  : ${naoResolvidos.length}`);
  const receitaRecuperada = resolvidos.reduce((s, r) => s + r.valorBrutoCentavos, 0);
  console.log(`Receita recuperada              : R$ ${(receitaRecuperada / 100).toFixed(2)}`);

  if (naoResolvidos.length > 0) {
    console.log(`\n── NAO RESOLVIDOS ──`);
    for (const n of naoResolvidos) {
      console.log(`  ${n.amazonOrderId} | ${n.sku} | ${n.dataVenda} | qty=${n.quantidade} | ${n.motivo}`);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tmpDir = path.resolve("tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const fileName = path.join(tmpDir, `recover-zero-shipped-${stamp}.json`);
  fs.writeFileSync(
    fileName,
    JSON.stringify(
      {
        modo: args.apply ? "apply" : "dry-run",
        executadoEm: new Date().toISOString(),
        resolvidos,
        naoResolvidos,
        totais: {
          alvos: alvos.length,
          resolvidos: resolvidos.length,
          naoResolvidos: naoResolvidos.length,
          receitaRecuperadaCentavos: receitaRecuperada,
        },
      },
      null,
      2,
    ),
  );
  console.log(`\nRelatorio salvo em: ${fileName}`);

  if (!args.apply) {
    console.log(`\nDRY-RUN: nada foi escrito no banco. Re-rode com --apply para aplicar.`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseAmount(input: unknown): number {
  if (!input || typeof input !== "object") return 0;
  const obj = input as Record<string, unknown>;
  const raw = obj.Amount ?? obj.amount ?? obj.value ?? obj.Value;
  if (raw == null) return 0;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function findRelatedOrderId(t: SPFinanceTransaction): string | null {
  const arr = t.relatedIdentifiers;
  if (!Array.isArray(arr)) return null;
  for (const r of arr) {
    const name = r.relatedIdentifierName ?? "";
    if (name === "AmazonOrderId" && r.relatedIdentifierValue) {
      return r.relatedIdentifierValue;
    }
  }
  return null;
}

function readFinanceItems(t: SPFinanceTransaction): Array<Record<string, unknown>> {
  const ti = t.transactionItems;
  if (Array.isArray(ti)) return ti;
  return [];
}

function readSku(item: Record<string, unknown>): string | null {
  const direct = item.sellerSKU ?? item.SellerSKU ?? item.sku ?? item.SKU;
  if (typeof direct === "string" && direct) return direct;
  const ctx = item.contextsByItemType;
  if (Array.isArray(ctx)) {
    for (const c of ctx) {
      if (typeof c === "object" && c !== null) {
        const obj = c as Record<string, unknown>;
        const s = obj.sellerSku ?? obj.sku;
        if (typeof s === "string" && s) return s;
      }
    }
  }
  return null;
}

function findBreakdown(item: Record<string, unknown>, types: string[]): number {
  const breakdowns = item.breakdowns;
  if (!Array.isArray(breakdowns)) return 0;
  let total = 0;
  for (const b of breakdowns) {
    if (!b || typeof b !== "object") continue;
    const rec = b as Record<string, unknown>;
    const type = String(
      rec.breakdownType ?? rec.type ?? rec.chargeType ?? rec.feeType ?? rec.name ?? "",
    );
    if (types.includes(type)) {
      total += parseAmount(rec.breakdownAmount ?? rec.amount ?? rec.Amount);
    }
  }
  return total;
}

main()
  .catch((err) => {
    console.error("Erro fatal:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
