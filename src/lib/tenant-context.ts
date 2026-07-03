// Contexto de tenant (multi-empresa) via AsyncLocalStorage.
//
// Puro e testável — não importa Prisma, logger nem nada de I/O. A camada de
// isolamento (src/lib/db.ts) e os handlers de rota consomem este módulo para
// saber qual empresa está "ativa" na chamada corrente.
//
// IMPORTANTE: este módulo é um no-op por si só. Nada lê o contexto a menos que
// a flag TENANT_ISOLATION esteja ligada na extensão do Prisma. Popular o ALS em
// rotas/worker é responsabilidade de outra fase (ver withTenantContextFromSession).

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Origem da execução corrente. Útil para diagnóstico e para futuras regras
 * (ex: worker pode iterar várias empresas; web sempre tem uma empresa fixa).
 */
export type TenantSource = "web" | "worker" | "system";

export type TenantContext = {
  /** Empresa ativa. `null` = sem empresa concreta (ex: superadmin amplo, system). */
  empresaId: string | null;
  /** Quando true, o isolamento não injeta filtro (acesso amplo a todos os tenants). */
  isSuperAdmin: boolean;
  source: TenantSource;
};

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Leitura NORMALIZADA da flag TENANT_ISOLATION. Único ponto de verdade para
 * "o isolamento está em enforce?" — com trim, porque um `.env` editado no
 * Windows (CRLF) ou com espaço acidental ("enforce\r", "enforce ") faria a
 * comparação crua falhar e o isolamento degradar SILENCIOSAMENTE para off,
 * vazando dados entre empresas com o operador acreditando que está ligado.
 */
export function isTenantIsolationEnforce(): boolean {
  return (
    (process.env.TENANT_ISOLATION ?? "").trim().toLowerCase() === "enforce"
  );
}

/**
 * Executa `fn` com o contexto de tenant amarrado ao escopo assíncrono. Tudo o
 * que rodar dentro de `fn` (incluindo awaits) enxerga o mesmo contexto via
 * getTenantContext(). Reentrante: chamadas aninhadas substituem o contexto
 * apenas no escopo interno.
 */
export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Retorna o contexto de tenant da execução corrente, ou `undefined` se nenhum
 * runWithTenant estiver ativo na pilha assíncrona.
 */
export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * Atalho para o empresaId do contexto corrente. `null` quando não há contexto
 * ou quando o contexto não fixa uma empresa concreta.
 */
export function getEmpresaId(): string | null {
  return storage.getStore()?.empresaId ?? null;
}

/**
 * Núcleo do escopo de chaves de ConfiguracaoSistema por empresa. A empresa
 * primária (WORKER_EMPRESA_ID) mantém a chave NUA — preserva as linhas já
 * existentes em produção e garante zero mudança de comportamento para a
 * mundofs. Demais empresas usam `chave::empresaId` para não colidir na mesma
 * linha global (ConfiguracaoSistema é GLOBAL_MODEL — nunca auto-filtrada).
 */
function scopedKeyParaEmpresa(baseKey: string): string {
  const empresaId = getEmpresaId();
  const primary = process.env.WORKER_EMPRESA_ID || "mundofs";
  if (!empresaId || empresaId === primary) return baseKey;
  return `${baseKey}::${empresaId}`;
}

/**
 * Escopa uma chave de CURSOR de sincronização por empresa (multi-seller F02).
 * Use SOMENTE em chaves de cursor.
 */
export function cursorKeyParaEmpresa(baseKey: string): string {
  return scopedKeyParaEmpresa(baseKey);
}

/**
 * Escopa uma chave de CONFIGURAÇÃO DE NEGÓCIO por empresa (reviews, imposto,
 * WhatsApp, seller id, destinação…). Mesma semântica de cursorKeyParaEmpresa
 * (primária mantém chave nua), separada por intenção: config de negócio de um
 * tenant nunca deve ser lida/escrita na linha de outro. Chaves de INFRA ou de
 * PLATAFORMA (heartbeat, app OAuth global, fee-estimator do marketplace)
 * continuam nuas de propósito — não escope essas.
 */
export function configKeyParaEmpresa(baseKey: string): string {
  return scopedKeyParaEmpresa(baseKey);
}

/**
 * A empresa é a PRIMÁRIA (dona das integrações globais legado — credencial
 * Amazon da ConfiguracaoSistema, Gmail, conciliação bancária)? Gate para rotas
 * que operam recursos globais: um ADMIN de outra empresa não pode ler nem
 * sobrescrever a integração da primária.
 */
export function isEmpresaPrimaria(
  empresaId: string | null | undefined,
): boolean {
  return empresaId === (process.env.WORKER_EMPRESA_ID || "mundofs");
}

/**
 * Popula o contexto de tenant para o RESTANTE da execução assíncrona corrente,
 * sem envolver um callback (ao contrário de runWithTenant). Usado em getSession
 * (auth.ts) para cobrir as rotas que chamam requireSession/requireRole direto,
 * sem passar por handleAuth. Cada request roda em escopo async isolado, então o
 * contexto não vaza entre requisições.
 */
export function enterWithTenant(ctx: TenantContext): void {
  storage.enterWith(ctx);
}

/**
 * Contexto de tenant padrão para execuções de BACKGROUND (worker daemon, consumer
 * SQS, crons HTTP). Single-tenant por ora: empresa de `WORKER_EMPRESA_ID` (default
 * "mundofs"). Centraliza o default para que todos os pontos de entrada sem sessão
 * de usuário rodem sob o mesmo escopo. Vira per-AmazonAccount (resolvido por
 * conta/sellerId) quando o worker iterar contas. Inócuo com TENANT_ISOLATION=off.
 */
export function runWithWorkerTenant<T>(fn: () => T): T {
  return runWithTenant(
    {
      empresaId: process.env.WORKER_EMPRESA_ID || "mundofs",
      isSuperAdmin: false,
      source: "worker",
    },
    fn,
  );
}

/**
 * empresaId do contexto corrente, com fallback para a empresa de background
 * (WORKER_EMPRESA_ID, default "mundofs"). Usado APENAS na composição de `where`
 * de uniques compostos `@@unique([empresaId, ...])` em upserts — onde o Prisma
 * exige o valor do empresaId no seletor. Em enforce o contexto sempre existe
 * (todos os pontos de entrada o estabelecem), então o fallback só atua em
 * dev/off (single-tenant). NUNCA usar para autorizar leitura — use getEmpresaId.
 */
export function currentEmpresaIdOrDefault(): string {
  return getEmpresaId() ?? (process.env.WORKER_EMPRESA_ID || "mundofs");
}
