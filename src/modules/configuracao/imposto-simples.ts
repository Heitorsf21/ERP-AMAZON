import { db } from "@/lib/db";
import { configKeyParaEmpresa, getEmpresaId } from "@/lib/tenant-context";

const KEY_ALIQUOTA = "imposto_simples_aliquota_bps";
const KEY_ATIVO = "imposto_simples_ativo";
const DEFAULT_ALIQUOTA_BPS = 600;
const CACHE_TTL_MS = 60_000;

export type ConfigImpostoSimples = {
  aliquotaBps: number;
  ativo: boolean;
};

// Config POR EMPRESA (alíquota do Simples é por CNPJ — depende do faturamento
// de cada empresa). Chave escopada via configKeyParaEmpresa: a primária mantém
// a chave nua (retrocompat mundofs); demais usam `chave::empresaId`. O cache é
// um Map por empresa — um cache único vazaria a alíquota de um tenant para os
// cálculos de lucro/DRE do outro por até 60s no mesmo processo.
const cachePorEmpresa = new Map<
  string,
  ConfigImpostoSimples & { expiresAt: number }
>();

function cacheKey(): string {
  return getEmpresaId() ?? "__sem_contexto__";
}

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
  const key = cacheKey();
  const hit = cachePorEmpresa.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return { aliquotaBps: hit.aliquotaBps, ativo: hit.ativo };
  }

  const kAliquota = configKeyParaEmpresa(KEY_ALIQUOTA);
  const kAtivo = configKeyParaEmpresa(KEY_ATIVO);
  const registros = await db.configuracaoSistema.findMany({
    where: { chave: { in: [kAliquota, kAtivo] } },
    select: { chave: true, valor: true },
  });
  const mapa = new Map(registros.map((r) => [r.chave, r.valor]));
  const config: ConfigImpostoSimples = {
    aliquotaBps: parseAliquota(mapa.get(kAliquota)),
    ativo: parseAtivo(mapa.get(kAtivo)),
  };

  cachePorEmpresa.set(key, { ...config, expiresAt: Date.now() + CACHE_TTL_MS });
  return config;
}

export async function saveConfigImpostoSimples(input: {
  aliquotaBps?: number;
  ativo?: boolean;
}): Promise<ConfigImpostoSimples> {
  const writes: Promise<unknown>[] = [];
  const kAliquota = configKeyParaEmpresa(KEY_ALIQUOTA);
  const kAtivo = configKeyParaEmpresa(KEY_ATIVO);

  if (input.aliquotaBps != null) {
    const valor = String(parseAliquota(String(input.aliquotaBps)));
    writes.push(
      db.configuracaoSistema.upsert({
        where: { chave: kAliquota },
        create: { chave: kAliquota, valor },
        update: { valor },
      }),
    );
  }

  if (input.ativo != null) {
    const valor = input.ativo ? "true" : "false";
    writes.push(
      db.configuracaoSistema.upsert({
        where: { chave: kAtivo },
        create: { chave: kAtivo, valor },
        update: { valor },
      }),
    );
  }

  await Promise.all(writes);
  invalidateConfigImpostoSimplesCache();
  return getConfigImpostoSimples();
}

export function invalidateConfigImpostoSimplesCache(): void {
  cachePorEmpresa.clear();
}

export const IMPOSTO_SIMPLES_DEFAULTS = {
  aliquotaBps: DEFAULT_ALIQUOTA_BPS,
  ativo: true,
} as const;
