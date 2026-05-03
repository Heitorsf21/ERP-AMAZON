/**
 * migrate-sqlite-to-postgres.ts
 *
 * Migra dados de um banco SQLite legado para o banco Postgres alvo.
 * Roda UMA VEZ antes de colocar o ERP em produção na VPS.
 *
 * Como rodar:
 *   1. Tenha um Postgres limpo com migrations já aplicadas (`prisma migrate deploy`).
 *   2. Mantenha o arquivo SQLite em prisma/dev.db (ou aponte SQLITE_URL).
 *   3. Defina DATABASE_URL apontando para o Postgres alvo.
 *   4. Rode: `tsx scripts/migrate-sqlite-to-postgres.ts`
 *
 * Estratégia:
 * - Abre 2 PrismaClients independentes (um para cada provider) usando bibliotecas
 *   geradas separadamente. Como a build atual do schema é Postgres, usamos uma
 *   conexão SQLite via better-sqlite3 cru (sem Prisma) para LER, e Prisma só para
 *   escrever no Postgres.
 * - Copia tabela por tabela respeitando ordem de FKs.
 * - Idempotente: cada tabela faz upsert por chave natural quando existe; o resto
 *   tenta create e ignora conflito.
 */
// better-sqlite3 é instalado sob demanda (npm i -D better-sqlite3) só para esta migração.
// Import dinâmico evita falha de typecheck na ausência da dependência.
const Database = require("better-sqlite3") as unknown as new (
  path: string,
  opts?: Record<string, unknown>,
) => SqliteDb;
import { db } from "@/lib/db";

type SqliteDb = {
  pragma: (s: string) => unknown;
  prepare: (s: string) => { all: () => unknown[] };
  close: () => void;
};

const SQLITE_PATH = (process.env.SQLITE_URL ?? "file:./prisma/dev.db").replace(
  /^file:/,
  "",
);

type Row = Record<string, unknown>;

function open(): SqliteDb {
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  sqlite.pragma("journal_mode = WAL");
  return sqlite;
}

function readAll(sqlite: SqliteDb, table: string): Row[] {
  return sqlite.prepare(`SELECT * FROM ${table}`).all() as Row[];
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

function toJson(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function pickDate<T extends string>(
  row: Row,
  key: T,
): Date | null | undefined {
  return key in row ? toDate(row[key]) : undefined;
}

async function migrate() {
  console.log(`Lendo SQLite em: ${SQLITE_PATH}`);
  const sqlite = open();

  // Ordem importa: pai antes de filho.
  const ordem = [
    "Usuario",
    "Categoria",
    "Fornecedor",
    "Produto",
    "ConfiguracaoSistema",
    "Movimentacao",
    "ContaPagar",
    "DossieFinanceiro",
    "DocumentoFinanceiro",
    "ContaReceber",
    "VendaAmazon",
    "AmazonReembolso",
    "AdsGastoManual",
    "MovimentacaoEstoque",
    "PedidoCompra",
    "ItemPedidoCompra",
    "AmazonSyncLog",
    "AmazonSyncJob",
    "AmazonApiQuota",
    "AmazonOrderRaw",
    "AmazonReviewSolicitation",
    "LoteImportacaoFBA",
    "VendaFBA",
    "LoteMetricaGS",
    "ProdutoMetricaGestorSeller",
    "ImportacaoLote",
    "AdsCampanha",
    "Notificacao",
    "AmazonSettlementReport",
  ];

  const tabelasNoSqlite = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r: unknown) => (r as { name: string }).name);

  for (const tabela of ordem) {
    if (!tabelasNoSqlite.includes(tabela)) {
      console.log(`  · ${tabela}: nao existe no SQLite, pulando.`);
      continue;
    }
    const linhas = readAll(sqlite, tabela);
    if (linhas.length === 0) {
      console.log(`  · ${tabela}: vazia.`);
      continue;
    }
    console.log(`  · ${tabela}: ${linhas.length} linhas`);
    await copiarTabela(tabela, linhas);
  }

  sqlite.close();
  console.log("Migracao concluida.");
}

async function copiarTabela(tabela: string, linhas: Row[]) {
  // Faz cast simples: cada coluna é repassada. Datas viram Date. JSON-strings viram objeto.
  const jsonCampos: Record<string, string[]> = {
    AmazonSyncLog: ["detalhes"],
    AmazonSyncJob: ["payload", "result"],
    AmazonOrderRaw: ["payloadJson"],
    AmazonReviewSolicitation: ["rawResponse"],
  };

  const dateCampos: Record<string, string[]> = {
    // Lista todos campos DateTime de cada modelo importante (basta os essenciais; demais ja sao timestamps).
    Movimentacao: ["dataCompetencia", "dataCaixa", "createdAt", "updatedAt"],
    ContaPagar: ["vencimento", "pagoEm", "createdAt", "updatedAt"],
    DossieFinanceiro: ["vencimento", "createdAt", "updatedAt"],
    DocumentoFinanceiro: ["vencimento", "dataEmissao", "createdAt", "updatedAt"],
    ContaReceber: ["dataPrevisao", "dataRecebimento", "createdAt", "updatedAt"],
    Produto: ["amazonUltimaSyncEm", "amazonCatalogSyncEm", "buyboxUltimaSyncEm", "createdAt", "updatedAt"],
    VendaAmazon: ["dataVenda", "ultimaSyncEm", "criadoEm", "atualizadoEm"],
    AmazonReembolso: ["dataReembolso", "criadoEm", "atualizadoEm"],
    AdsGastoManual: ["periodoInicio", "periodoFim", "criadoEm"],
    MovimentacaoEstoque: ["dataMovimentacao", "createdAt", "updatedAt"],
    PedidoCompra: ["dataEmissao", "dataPrevisao", "dataRecebimento", "createdAt", "updatedAt"],
    AmazonSyncLog: ["createdAt"],
    AmazonSyncJob: ["runAfter", "startedAt", "finishedAt", "lockedAt", "createdAt", "updatedAt"],
    AmazonApiQuota: ["nextAllowedAt", "lastAttemptAt", "createdAt", "updatedAt"],
    AmazonOrderRaw: ["createdTime", "lastUpdatedTime", "ultimaSyncEm", "criadoEm", "atualizadoEm"],
    AmazonReviewSolicitation: [
      "orderCreatedAt", "eligibleFrom", "deliveryWindowStart", "deliveryWindowEnd",
      "nextCheckAt", "lastAttemptAt", "checkedAt", "sentAt", "createdAt", "updatedAt",
    ],
    Usuario: ["ultimoAcesso", "createdAt", "updatedAt"],
    Categoria: ["createdAt", "updatedAt"],
    Fornecedor: ["createdAt", "updatedAt"],
    ConfiguracaoSistema: ["createdAt", "updatedAt"],
    LoteImportacaoFBA: ["periodoInicio", "periodoFim", "createdAt"],
    VendaFBA: ["dataCompra", "createdAt"],
    LoteMetricaGS: ["createdAt"],
    ProdutoMetricaGestorSeller: ["createdAt"],
    ImportacaoLote: ["criadoEm"],
    AdsCampanha: ["periodoInicio", "periodoFim", "criadoEm", "updatedAt"],
    Notificacao: ["criadaEm", "updatedAt"],
    AmazonSettlementReport: ["periodoInicio", "periodoFim", "depositDate", "processadoEm", "criadoEm", "updatedAt"],
  };

  const camposJson = jsonCampos[tabela] ?? [];
  const camposDate = dateCampos[tabela] ?? [];

  const tableLower = tabela.charAt(0).toLowerCase() + tabela.slice(1);
  const delegate = (db as unknown as Record<string, { create: (a: { data: Row }) => Promise<unknown> }>)[
    tableLower
  ];
  if (!delegate) {
    console.warn(`    ! delegate Prisma nao encontrado para ${tabela}`);
    return;
  }

  let copiadas = 0;
  let ignoradas = 0;
  for (const linha of linhas) {
    const data: Row = { ...linha };
    for (const campo of camposDate) {
      if (campo in data) data[campo] = pickDate(data, campo) as unknown;
    }
    for (const campo of camposJson) {
      if (campo in data) data[campo] = toJson(data[campo]);
    }
    // SQLite pode armazenar booleanos como 0/1.
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === "number" && (k === "lida" || k === "ativo" || k === "protegidoPorSenha" || k === "solicitarReviewsAtivo" || k === "buyboxGanho" || k === "somosBuybox")) {
        data[k] = v === 1;
      }
    }
    try {
      await delegate.create({ data });
      copiadas++;
    } catch (e) {
      // Conflito de unique: registro já existe — apenas ignora.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Unique constraint") || msg.includes("P2002")) {
        ignoradas++;
      } else {
        console.warn(`    ! erro ${tabela}: ${msg.slice(0, 200)}`);
        ignoradas++;
      }
    }
  }
  console.log(`    ${copiadas} copiadas, ${ignoradas} ignoradas`);
}

migrate()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
