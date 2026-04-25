import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type TableSize = {
  table: string;
  rows: bigint | null;
  totalBytes: bigint | null;
};

export async function GET() {
  // Tamanho total e top tabelas (Postgres-only).
  let dbSizeBytes: bigint | null = null;
  let tableStats: Array<{ table: string; rows: number; sizeBytes: number }> = [];

  try {
    const sizeRows = await db.$queryRaw<Array<{ size: bigint }>>`
      SELECT pg_database_size(current_database())::bigint AS size;
    `;
    dbSizeBytes = sizeRows[0]?.size ?? null;

    const rows = await db.$queryRaw<TableSize[]>`
      SELECT
        relname            AS table,
        n_live_tup::bigint AS rows,
        pg_total_relation_size(relid)::bigint AS "totalBytes"
      FROM pg_stat_user_tables
      ORDER BY n_live_tup DESC NULLS LAST
      LIMIT 12;
    `;
    tableStats = rows.map((r) => ({
      table: r.table,
      rows: Number(r.rows ?? 0),
      sizeBytes: Number(r.totalBytes ?? 0),
    }));
  } catch (e) {
    // Fallback (provider não-Postgres ou sem permissão de pg_stat_user_tables).
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      dbSizeBytes: null,
      tables: [],
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
    dbSizeBytes: dbSizeBytes ? Number(dbSizeBytes) : null,
    tables: tableStats,
    counts: {
      notificacoesTotais,
      notificacoesNaoLidas,
      settlementsProcessados: settlementsCount,
      contasReceberPendentes,
      buyboxSnapshots: buyboxSnapshotsTotal,
    },
  });
}
