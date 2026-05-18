import * as fs from "fs";
import * as path from "path";
import ExcelJS from "exceljs";
import { fromZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { TIMEZONE } from "@/lib/date";
import { materializarReembolsosAmazon } from "@/modules/amazon/finance-materializer";
import { normalizeFinanceTransaction } from "@/modules/amazon/finance-normalizer";
import {
  STATUS_PEDIDO_CANCELADO,
  isVendaAmazonRemovalOrder,
} from "@/modules/vendas/filtros";

type CheckName =
  | "refunds"
  | "gestor-seller"
  | "removals"
  | "pending-zero"
  | "finance-denormalized"
  | "api-conflicts"
  | "order-id"
  | "all";

type Args = {
  check: CheckName;
  apply: boolean;
  file?: string;
  orderId?: string;
};

type GestorSellerRow = {
  orderId: string;
  sku: string;
  status: string;
  dataCompra: Date;
  precoTotalCentavos: number;
  quantidade: number;
  freteRecebidoCentavos: number;
  recebidoMarketplaceCentavos: number;
};

const CHECKS: CheckName[] = [
  "refunds",
  "gestor-seller",
  "removals",
  "pending-zero",
  "finance-denormalized",
  "api-conflicts",
];

async function main() {
  const args = parseArgs();
  assertDatabaseConfigured();
  console.log(`Modo: ${args.apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Check: ${args.check}\n`);

  const checks = args.check === "all" ? CHECKS : [args.check];
  for (const check of checks) {
    if (check === "refunds") await checkRefunds(args.apply);
    if (check === "gestor-seller") await checkGestorSeller(args.file, args.apply);
    if (check === "removals") await checkRemovals();
    if (check === "pending-zero") await checkPendingZero();
    if (check === "finance-denormalized") await checkFinanceDenormalized();
    if (check === "api-conflicts") await checkApiConflicts();
    if (check === "order-id") await checkOrderId(args.orderId);
  }

  await db.$disconnect();
}

function assertDatabaseConfigured() {
  if (process.env.DATABASE_URL) return;
  throw new Error("DATABASE_URL nao esta configurado neste ambiente.");
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const check = readArg(argv, "--check") ?? "all";
  if (!isCheckName(check)) {
    throw new Error(`--check invalido: ${check}`);
  }
  return {
    check,
    apply: argv.includes("--apply"),
    file: readArg(argv, "--file"),
    orderId: readArg(argv, "--order-id"),
  };
}

function readArg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function isCheckName(value: string): value is CheckName {
  return [...CHECKS, "order-id", "all"].includes(value as CheckName);
}

async function checkRefunds(apply: boolean) {
  section("Refunds financeiros -> AmazonReembolso/VendaAmazon");
  const rows = await db.amazonFinanceTransaction.findMany({
    where: { transactionType: "Refund" },
    orderBy: { postedDate: "desc" },
  });
  const result = await materializarReembolsosAmazon(rows, { dryRun: !apply });

  printObject({
    transacoesRefundBrutas: rows.length,
    refundsNormalizadosUnicos: result.refundsNormalizados,
    reembolsosCriar: result.criados,
    reembolsosAtualizar: result.atualizados,
    vendasMarcarReembolsado: result.vendasMarcadasReembolso,
    pendentesValidacaoManual: result.pendentesValidacao,
    ignorados: result.ignorados,
  });

  const relevantes = result.acoes
    .filter((acao) => acao.tipo !== "ATUALIZAR_REEMBOLSO")
    .slice(0, 80)
    .map((acao) => ({
      tipo: acao.tipo,
      orderId: acao.refund.amazonOrderId,
      sku: acao.refund.sku,
      refund: formatMoney(acao.refund.valorReembolsadoCentavos),
      venda: formatMoney(acao.venda?.valorBrutoCentavos ?? 0),
      statusPedido: acao.venda?.statusPedido,
      statusFinanceiro: acao.venda?.statusFinanceiro,
      motivo: acao.motivo,
    }));
  console.table(relevantes);
}

async function checkGestorSeller(fileArg?: string, apply = false) {
  section("Gestor Seller x ERP");
  const file = fileArg ?? latestGestorSellerFile();
  if (!file) {
    console.log("Nenhuma planilha reports_sales (*.xlsx) encontrada.");
    return;
  }

  const rows = await readGestorSellerRows(file);
  const minDate = minDateOf(rows.map((row) => row.dataCompra));
  const maxDate = maxDateOf(rows.map((row) => row.dataCompra));
  const start = fromZonedTime(startOfLocalDay(minDate), TIMEZONE);
  const end = fromZonedTime(startOfNextLocalDay(maxDate), TIMEZONE);

  const vendas = await db.vendaAmazon.findMany({
    where: { dataVenda: { gte: start, lt: end } },
    select: {
      amazonOrderId: true,
      sku: true,
      dataVenda: true,
      asin: true,
      titulo: true,
      quantidade: true,
      valorBrutoCentavos: true,
      fretesCentavos: true,
      statusPedido: true,
      statusFinanceiro: true,
      marketplace: true,
    },
  });
  const vendaPorChave = new Map(
    vendas.map((venda) => [`${venda.amazonOrderId}\u0000${venda.sku}`, venda]),
  );
  const reembolsosPeriodo = await db.amazonReembolso.findMany({
    where: { dataReembolso: { gte: start, lt: end } },
    select: { amazonOrderId: true, sku: true },
  });
  const chavesReembolsadasPeriodo = new Set(
    reembolsosPeriodo.map(
      (reembolso) => `${reembolso.amazonOrderId}\u0000${reembolso.sku}`,
    ),
  );

  const gsResumo = summarizeGs(rows);
  const overridesGestor: Array<{
    row: GestorSellerRow;
    venda: (typeof vendas)[number];
  }> = [];
  const divergencias = rows
    .map((row) => {
      const venda = vendaPorChave.get(`${row.orderId}\u0000${row.sku}`);
      const reembolsadoNoPeriodo = chavesReembolsadasPeriodo.has(
        `${row.orderId}\u0000${row.sku}`,
      );
      const erpStatus = venda
        ? statusGestorSellerDoErp(
            venda,
            reembolsadoNoPeriodo,
          )
        : "AUSENTE";
      const erpValor = venda?.valorBrutoCentavos ?? 0;
      const valorDiferente =
        Math.abs(erpValor - row.precoTotalCentavos) > 1 &&
        row.status !== "Cancelado";
      const statusDiferente = row.status !== erpStatus;
      if (!statusDiferente && !valorDiferente) return null;
      if (
        apply &&
        venda &&
        row.status === "Reembolsado" &&
        erpStatus === "Enviado" &&
        !reembolsadoNoPeriodo
      ) {
        overridesGestor.push({ row, venda });
      }
      return {
        orderId: row.orderId,
        sku: row.sku,
        gestorStatus: row.status,
        erpStatus,
        gestorValor: formatMoney(row.precoTotalCentavos),
        erpValor: formatMoney(erpValor),
        erpStatusPedido: venda?.statusPedido,
        erpStatusFinanceiro: venda?.statusFinanceiro,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  console.log(`Arquivo: ${file}`);
  console.log(
    `Periodo: ${formatDateLocal(minDate)} ate ${formatDateLocal(maxDate)}`,
  );
  console.table(gsResumo);
  console.log(`Divergencias order-by-order: ${divergencias.length}`);
  console.table(divergencias.slice(0, 120));

  if (overridesGestor.length > 0) {
    console.log(
      `Criando overrides Gestor Seller para ${overridesGestor.length} reembolso(s) sem evento no periodo.`,
    );
    for (const { row, venda } of overridesGestor) {
      const referenciaExterna = `gestor-seller:${formatDateLocal(minDate)}:${formatDateLocal(maxDate)}:${row.orderId}:${row.sku}`;
      await db.amazonReembolso.upsert({
        where: { referenciaExterna },
        create: {
          amazonOrderId: row.orderId,
          orderItemId: null,
          sku: row.sku,
          asin: venda.asin,
          titulo: venda.titulo,
          quantidade: row.quantidade,
          valorReembolsadoCentavos: row.precoTotalCentavos,
          taxasReembolsadasCentavos: 0,
          dataReembolso: venda.dataVenda,
          liquidacaoId: null,
          marketplace: venda.marketplace,
          referenciaExterna,
          statusFinanceiro: "GESTOR_SELLER",
          motivoCategoria: "GESTOR_SELLER_VALIDATION",
          produtoId: null,
        },
        update: {
          quantidade: row.quantidade,
          valorReembolsadoCentavos: row.precoTotalCentavos,
          dataReembolso: venda.dataVenda,
          marketplace: venda.marketplace,
          motivoCategoria: "GESTOR_SELLER_VALIDATION",
          statusFinanceiro: "GESTOR_SELLER",
        },
      });
    }
  }

  if (apply) {
    await salvarSnapshotGestorSeller(rows, minDate, maxDate);
  }
}

async function salvarSnapshotGestorSeller(
  rows: GestorSellerRow[],
  minDate: Date,
  maxDate: Date,
) {
  const enviado = somarRowsGestor(rows, "Enviado");
  const reembolsado = somarRowsGestor(rows, "Reembolsado");
  const chave = snapshotGestorSellerKey(minDate, maxDate);
  await db.configuracaoSistema.upsert({
    where: { chave },
    create: {
      chave,
      valor: JSON.stringify({
        periodoInicio: formatDateLocal(minDate),
        periodoFim: formatDateLocal(maxDate),
        faturamentoCentavos: enviado.valor,
        freteCentavos: enviado.frete,
        faturamentoReembolsadoCentavos: reembolsado.valor,
        faturamentoComReembolsadosCentavos: enviado.valor + reembolsado.valor,
        liquidoMarketplaceCentavos: enviado.recebido,
        fonte: "reports_sales",
        atualizadoEm: new Date().toISOString(),
      }),
    },
    update: {
      valor: JSON.stringify({
        periodoInicio: formatDateLocal(minDate),
        periodoFim: formatDateLocal(maxDate),
        faturamentoCentavos: enviado.valor,
        freteCentavos: enviado.frete,
        faturamentoReembolsadoCentavos: reembolsado.valor,
        faturamentoComReembolsadosCentavos: enviado.valor + reembolsado.valor,
        liquidoMarketplaceCentavos: enviado.recebido,
        fonte: "reports_sales",
        atualizadoEm: new Date().toISOString(),
      }),
    },
  });
}

function somarRowsGestor(rows: GestorSellerRow[], status: string) {
  return rows
    .filter((row) => row.status === status)
    .reduce(
      (acc, row) => ({
        valor: acc.valor + row.precoTotalCentavos,
        frete: acc.frete + row.freteRecebidoCentavos,
        recebido: acc.recebido + row.recebidoMarketplaceCentavos,
      }),
      { valor: 0, frete: 0, recebido: 0 },
    );
}

function snapshotGestorSellerKey(minDate: Date, maxDate: Date) {
  return `gestor_seller_snapshot:${formatDateLocal(minDate)}:${formatDateLocal(maxDate)}`;
}

async function checkRemovals() {
  section("Removal Orders / Non-Amazon com valor");
  const rows = await db.vendaAmazon.findMany({
    where: {
      OR: [
        { amazonOrderId: { startsWith: "S01-" } },
        { marketplace: { in: ["Non-Amazon", "NON_AMAZON", "Non Amazon"] } },
      ],
      valorBrutoCentavos: { gt: 0 },
    },
    orderBy: { dataVenda: "asc" },
    select: {
      amazonOrderId: true,
      sku: true,
      dataVenda: true,
      quantidade: true,
      valorBrutoCentavos: true,
      marketplace: true,
      fulfillmentChannel: true,
    },
  });
  printObject({
    linhas: rows.length,
    valorTotal: formatMoney(
      rows.reduce((sum, row) => sum + (row.valorBrutoCentavos ?? 0), 0),
    ),
  });
  console.table(
    rows.slice(0, 80).map((row) => ({
      orderId: row.amazonOrderId,
      sku: row.sku,
      dataVenda: row.dataVenda.toISOString(),
      qtd: row.quantidade,
      valor: formatMoney(row.valorBrutoCentavos),
      marketplace: row.marketplace,
      fulfillment: row.fulfillmentChannel,
    })),
  );
}

async function checkPendingZero() {
  section("Pending/UNKNOWN com valor zerado");
  const rows = await db.vendaAmazon.findMany({
    where: {
      statusPedido: { in: ["Pending", "PENDING", "UNKNOWN"] },
      OR: [{ valorBrutoCentavos: null }, { valorBrutoCentavos: { lte: 0 } }],
    },
    orderBy: { dataVenda: "desc" },
    take: 100,
    select: {
      amazonOrderId: true,
      sku: true,
      dataVenda: true,
      statusPedido: true,
      valorBrutoCentavos: true,
    },
  });
  printObject({ pendingsZerados: rows.length });
  console.table(rows);
}

async function checkFinanceDenormalized() {
  section("AmazonFinanceTransaction sem campos derivados");
  const rows = await db.amazonFinanceTransaction.findMany({
    where: { transactionType: "Refund" },
    orderBy: { postedDate: "desc" },
  });
  const problemas = rows
    .map((row) => {
      const normalized = normalizeFinanceTransaction(row);
      return {
        transactionId: row.transactionId,
        orderIdBanco: row.amazonOrderId,
        skuBanco: row.sku,
        orderIdPayload: normalized?.amazonOrderId,
        skuPayload: normalized?.items.find((item) => item.sku)?.sku,
      };
    })
    .filter((row) => !row.orderIdBanco || !row.skuBanco);

  printObject({
    refundsBrutos: rows.length,
    refundsSemOrderOuSkuNoBanco: problemas.length,
  });
  console.table(problemas.slice(0, 80));
}

async function checkApiConflicts() {
  section("Jobs Amazon conflitantes / falhas recentes");
  const [falhas, running] = await Promise.all([
    db.amazonSyncJob.groupBy({
      by: ["tipo", "status"],
      where: {
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        status: { in: ["FAILED", "RUNNING"] },
      },
      _count: { _all: true },
    }),
    db.amazonSyncJob.findMany({
      where: {
        status: "RUNNING",
        startedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
      },
      select: { id: true, tipo: true, startedAt: true, lockedBy: true },
    }),
  ]);
  console.table(
    falhas.map((row) => ({
      tipo: row.tipo,
      status: row.status,
      qtd: row._count._all,
    })),
  );
  console.table(running);
}

async function checkOrderId(orderId?: string) {
  section(`Dossie pedido ${orderId ?? "(sem --order-id)"}`);
  if (!orderId) return;
  const [vendas, reembolsos, rawFinance] = await Promise.all([
    db.vendaAmazon.findMany({ where: { amazonOrderId: orderId } }),
    db.amazonReembolso.findMany({ where: { amazonOrderId: orderId } }),
    db.amazonFinanceTransaction.findMany({ where: { amazonOrderId: orderId } }),
  ]);
  console.table(vendas);
  console.table(reembolsos);
  console.table(
    rawFinance.map((row) => {
      const normalized = normalizeFinanceTransaction(row);
      return {
        transactionId: row.transactionId,
        type: row.transactionType,
        status: row.transactionStatus,
        postedDate: row.postedDate?.toISOString(),
        normalizedOrderId: normalized?.amazonOrderId,
        normalizedSku: normalized?.items.find((item) => item.sku)?.sku,
      };
    }),
  );
}

async function readGestorSellerRows(file: string): Promise<GestorSellerRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error(`Planilha sem abas: ${file}`);

  const rows: GestorSellerRow[] = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const orderId = stringCell(row.getCell(1).value);
    if (!orderId) return;
    rows.push({
      orderId,
      status: stringCell(row.getCell(3).value) || "(vazio)",
      dataCompra: parseGestorDate(stringCell(row.getCell(4).value)),
      sku: stringCell(row.getCell(7).value),
      quantidade: numberCell(row.getCell(10).value),
      precoTotalCentavos: centavosCell(row.getCell(12).value),
      freteRecebidoCentavos: centavosCell(row.getCell(15).value),
      recebidoMarketplaceCentavos: centavosCell(row.getCell(23).value),
    });
  });
  return rows;
}

function summarizeGs(rows: GestorSellerRow[]) {
  const map = new Map<
    string,
    { status: string; vendas: number; unidades: number; valor: number; frete: number; recebido: number }
  >();
  for (const row of rows) {
    const item =
      map.get(row.status) ??
      {
        status: row.status,
        vendas: 0,
        unidades: 0,
        valor: 0,
        frete: 0,
        recebido: 0,
      };
    item.vendas += 1;
    item.unidades += row.quantidade;
    item.valor += row.precoTotalCentavos;
    item.frete += row.freteRecebidoCentavos;
    item.recebido += row.recebidoMarketplaceCentavos;
    map.set(row.status, item);
  }
  return [...map.values()].map((row) => ({
    status: row.status,
    vendas: row.vendas,
    unidades: row.unidades,
    valor: formatMoney(row.valor),
    frete: formatMoney(row.frete),
    recebidoMarketplace: formatMoney(row.recebido),
  }));
}

function statusGestorSellerDoErp(venda: {
  amazonOrderId: string;
  marketplace: string | null;
  statusPedido: string;
  statusFinanceiro: string;
}, reembolsadoNoPeriodo: boolean): string {
  if (isVendaAmazonRemovalOrder(venda)) return "Removal";
  if (STATUS_PEDIDO_CANCELADO.includes(venda.statusPedido as never))
    return "Cancelado";
  if (reembolsadoNoPeriodo) return "Reembolsado";
  return "Enviado";
}

function latestGestorSellerFile(): string | undefined {
  return fs
    .readdirSync(process.cwd())
    .filter((name) => /^reports_sales .*\.xlsx$/i.test(name))
    .map((name) => ({
      name,
      time: fs.statSync(path.join(process.cwd(), name)).mtimeMs,
    }))
    .sort((a, b) => b.time - a.time)[0]?.name;
}

function parseGestorDate(value: string): Date {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/,
  );
  if (!match) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
    throw new Error(`Data invalida na planilha Gestor Seller: ${value}`);
  }
  const [, y, m, d, hh = "00", mm = "00", ss = "00"] = match;
  return new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    Number(ss),
  );
}

function startOfLocalDay(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}T00:00:00`;
}

function startOfNextLocalDay(date: Date): string {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return startOfLocalDay(next);
}

function minDateOf(values: Date[]): Date {
  return values.reduce((min, value) => (value < min ? value : min), values[0]!);
}

function maxDateOf(values: Date[]): Date {
  return values.reduce((max, value) => (value > max ? value : max), values[0]!);
}

function stringCell(value: ExcelJS.CellValue): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (value instanceof Date) return formatDateLocal(value);
  if (value && typeof value === "object" && "result" in value) {
    return stringCell(value.result as ExcelJS.CellValue);
  }
  return "";
}

function numberCell(value: ExcelJS.CellValue): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = parseDecimal(stringCell(value));
  return parsed ?? 0;
}

function centavosCell(value: ExcelJS.CellValue): number {
  return Math.round(numberCell(value) * 100);
}

function parseDecimal(value: string): number | null {
  const normalized =
    value.includes(",") && !value.includes(".")
      ? value.replace(".", "").replace(",", ".")
      : value.replace(/,/g, "");
  const parsed = Number(normalized.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(centavos: number | null | undefined): string {
  return ((centavos ?? 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatDateLocal(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function section(title: string) {
  console.log(`\n${"=".repeat(80)}\n${title}\n${"=".repeat(80)}`);
}

function printObject(value: Record<string, unknown>) {
  console.log(JSON.stringify(value, null, 2));
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (
    !process.env.DATABASE_URL ||
    message.includes("Environment variable not found: DATABASE_URL")
  ) {
    console.error(
      [
        "Erro: DATABASE_URL nao esta configurado neste ambiente.",
        "O auditor e read-only por padrao, mas precisa acessar o banco do ERP para comparar com as planilhas do Gestor Seller.",
        'Execute novamente em um ambiente com DATABASE_URL, por exemplo na VPS: npm run amazon:reliability:audit -- --check all --file "reports_sales (3).xlsx"',
      ].join("\n"),
    );
  } else {
    console.error(error);
  }
  await db.$disconnect();
  process.exit(1);
});
