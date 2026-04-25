import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TableSize = {
  table: string;
  rows: bigint | null;
  totalBytes: bigint | null;
};

type SqliteTable = { name: string };

function isSqlite(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return url.startsWith("file:") || url.startsWith("sqlite:");
}

async function statsPostgres() {
  const sizeRows = await db.$queryRaw<Array<{ size: bigint }>>`
    SELECT pg_database_size(current_database())::bigint AS size;
  `;
  const dbSizeBytes = sizeRows[0]?.size ? Number(sizeRows[0].size) : null;

  const rows = await db.$queryRaw<TableSize[]>`
    SELECT
      relname            AS table,
      n_live_tup::bigint AS rows,
      pg_total_relation_size(relid)::bigint AS "totalBytes"
    FROM pg_stat_user_tables
    ORDER BY n_live_tup DESC NULLS LAST
    LIMIT 12;
  `;
  return {
    dbSizeBytes,
    tables: rows.map((r) => ({
      table: r.table,
      rows: Number(r.rows ?? 0),
      sizeBytes: Number(r.totalBytes ?? 0),
    })),
  };
}

async function statsSqlite() {
  // Tamanho do arquivo .db no disco
  let dbSizeBytes: number | null = null;
  const url = process.env.DATABASE_URL ?? "";
  const filePath = url.replace(/^file:/, "").replace(/^sqlite:/, "");
  if (filePath) {
    const abs = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), "prisma", filePath);
    try {
      const stat = await fs.stat(abs);
      dbSizeBytes = stat.size;
    } catch {
      // Tenta sem prefixo prisma/
      try {
        const stat = await fs.stat(path.resolve(process.cwd(), filePath));
        dbSizeBytes = stat.size;
      } catch {
        dbSizeBytes = null;
      }
    }
  }

  // Lista tabelas via sqlite_master, conta linhas e estima tamanho via dbstat
  // (dbstat pode não estar disponível em build padrão; cai pra COUNT só)
  const tabelas = await db.$queryRaw<SqliteTable[]>`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%'
    ORDER BY name;
  `;

  const tableStats = await Promise.all(
    tabelas.map(async (t) => {
      try {
        const rows = await db.$queryRawUnsafe<Array<{ c: bigint | number }>>(
          `SELECT COUNT(*) as c FROM "${t.name}"`,
        );
        const count = Number(rows[0]?.c ?? 0);
        return { table: t.name, rows: count, sizeBytes: 0 };
      } catch {
        return { table: t.name, rows: 0, sizeBytes: 0 };
      }
    }),
  );

  // Top 12 por linhas
  tableStats.sort((a, b) => b.rows - a.rows);
  return {
    dbSizeBytes,
    tables: tableStats.slice(0, 12),
  };
}

export async function GET() {
  let dbStats: { dbSizeBytes: number | null; tables: Array<{ table: string; rows: number; sizeBytes: number }> };

  try {
    if (isSqlite()) {
      dbStats = await statsSqlite();
    } else {
      dbStats = await statsPostgres();
    }
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      dbSizeBytes: null,
      tables: [],
      counts: {
        notificacoesTotais: 0,
        notificacoesNaoLidas: 0,
        settlementsProcessados: 0,
        contasReceberPendentes: 0,
        buyboxSnapshots: 0,
      },
    });
  }

  const [
    notificacoesTotais,
    notificacoesNaoLidas,
    settlementsCount,
    contasReceberPendentes,
    buyboxSnapshotsTotal,
  ] = await Promise.all([
    db.notificacao.count(),
    db.notificacao.count({ where: { lida: false } }),
    db.amazonSettlementReport.count({
      where: { processadoEm: { not: null } },
    }),
    db.contaReceber.count({ where: { status: "PENDENTE" } }),
    db.buyBoxSnapshot.count(),
  ]);

  return NextResponse.json({
    ok: true,
    dbSizeBytes: dbStats.dbSizeBytes,
    tables: dbStats.tables,
    counts: {
      notificacoesTotais,
      notificacoesNaoLidas,
      settlementsProcessados: settlementsCount,
      contasReceberPendentes,
      buyboxSnapshots: buyboxSnapshotsTotal,
    },
  });
}
