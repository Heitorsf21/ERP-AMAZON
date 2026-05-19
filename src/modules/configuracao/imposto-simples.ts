import { db } from "@/lib/db";

const KEY_ALIQUOTA = "imposto_simples_aliquota_bps";
const KEY_ATIVO = "imposto_simples_ativo";
const DEFAULT_ALIQUOTA_BPS = 600;
const CACHE_TTL_MS = 60_000;

export type ConfigImpostoSimples = {
  aliquotaBps: number;
  ativo: boolean;
};

let cache: (ConfigImpostoSimples & { expiresAt: number }) | null = null;

function parseAtivo(valor: string | null | undefined): boolean {
  if (valor == null) return true;
  const normalizado = valor.trim().toLowerCase();
  if (normalizado === "false" || normalizado === "0" || normalizado === "off") {
    return false;
  }
  return true;
}

function parseAliquota(valor: string | null | undefined): number {
  if (!valor) return DEFAULT_ALIQUOTA_BPS;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_ALIQUOTA_BPS;
  return Math.round(n);
}

export async function getConfigImpostoSimples(): Promise<ConfigImpostoSimples> {
  if (cache && cache.expiresAt > Date.now()) {
    return { aliquotaBps: cache.aliquotaBps, ativo: cache.ativo };
  }

  const registros = await db.configuracaoSistema.findMany({
    where: { chave: { in: [KEY_ALIQUOTA, KEY_ATIVO] } },
    select: { chave: true, valor: true },
  });
  const mapa = new Map(registros.map((r) => [r.chave, r.valor]));
  const config: ConfigImpostoSimples = {
    aliquotaBps: parseAliquota(mapa.get(KEY_ALIQUOTA)),
    ativo: parseAtivo(mapa.get(KEY_ATIVO)),
  };

  cache = { ...config, expiresAt: Date.now() + CACHE_TTL_MS };
  return config;
}

export async function saveConfigImpostoSimples(input: {
  aliquotaBps?: number;
  ativo?: boolean;
}): Promise<ConfigImpostoSimples> {
  const writes: Promise<unknown>[] = [];

  if (input.aliquotaBps != null) {
    const valor = String(parseAliquota(String(input.aliquotaBps)));
    writes.push(
      db.configuracaoSistema.upsert({
        where: { chave: KEY_ALIQUOTA },
        create: { chave: KEY_ALIQUOTA, valor },
        update: { valor },
      }),
    );
  }

  if (input.ativo != null) {
    const valor = input.ativo ? "true" : "false";
    writes.push(
      db.configuracaoSistema.upsert({
        where: { chave: KEY_ATIVO },
        create: { chave: KEY_ATIVO, valor },
        update: { valor },
      }),
    );
  }

  await Promise.all(writes);
  invalidateConfigImpostoSimplesCache();
  return getConfigImpostoSimples();
}

export function invalidateConfigImpostoSimplesCache(): void {
  cache = null;
}

export const IMPOSTO_SIMPLES_DEFAULTS = {
  aliquotaBps: DEFAULT_ALIQUOTA_BPS,
  ativo: true,
} as const;
