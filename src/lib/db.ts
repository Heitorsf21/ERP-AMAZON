import { PrismaClient } from "@prisma/client";
import { getTenantContext } from "./tenant-context";
import { resolveEmpresaIdFromRequestCookie } from "./tenant-request";
import { logger } from "./logger";

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof buildClient> | undefined;
};

function buildDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  if (process.env.NODE_ENV !== "production") return url;
  if (!url.startsWith("postgres")) return url;
  if (url.includes("connection_limit=")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}connection_limit=10&pool_timeout=20`;
}

const datasourceUrl = buildDatabaseUrl();

// ── Isolamento multi-tenant (por empresa) ───────────────────────────────────
//
// CONTROLE POR FLAG — process.env.TENANT_ISOLATION:
//   - ausente | "off" (DEFAULT): NO-OP TOTAL. A extensão chama `query(args)`
//     sem tocar em nada. O comportamento do app é IDÊNTICO ao de antes da
//     extensão existir. Isto é inegociável.
//   - "enforce": injeta `where.empresaId` em reads/updates/deletes e
//     `data.empresaId` em creates para os modelos TENANT, lendo a empresa do
//     contexto AsyncLocalStorage (tenant-context.ts). Fail-closed.
//
// Por que listas EXPLÍCITAS (e não derivar do DMMF)? Para que adicionar/remover
// um modelo seja uma decisão consciente de segurança, revisável em diff.
// MANUTENÇÃO: ao criar um modelo novo COM `empresaId` de negócio, adicione-o em
// TENANT_MODELS. Modelos de plataforma/auth ficam em GLOBAL_MODELS.

/**
 * Modelos "owned" por uma empresa: a extensão filtra/injeta `empresaId` neles.
 * São todos os modelos que possuem `empresaId` de NEGÓCIO, EXCETO os de
 * plataforma/auth (AmazonAccount, Usuario) que vivem em GLOBAL_MODELS porque
 * seu escopo de empresa é tratado explicitamente pela aplicação, não por
 * auto-filtro de query.
 *
 * MANUTENÇÃO: mantenha em sincronia com o schema. Lista derivada do conjunto de
 * modelos com `empresaId` no schema.postgresql.prisma menos AmazonAccount/Usuario.
 */
const TENANT_MODELS = new Set<string>([
  "Categoria",
  "Fornecedor",
  "Movimentacao",
  "ContaPagar",
  "ContaFixa",
  "DossieFinanceiro",
  "DocumentoFinanceiro",
  "ContaReceber",
  "Produto",
  "AmazonFeeEstimate",
  "ProdutoCustoHistorico",
  "VendaAmazon",
  "VendaCustoEventual",
  "AmazonOrderRaw",
  "ProdutoVariacao",
  "AmazonReembolso",
  "AdsGastoManual",
  "MovimentacaoEstoque",
  "PedidoCompra",
  "ItemPedidoCompra",
  "AmazonSyncLog",
  "AmazonSyncJob",
  "AmazonNotification",
  "AmazonApiQuota",
  "AmazonReviewSolicitation",
  "WhatsAppEstoqueProdutoExcluido",
  "WhatsAppEstoqueEnvio",
  "LoteImportacaoFBA",
  "VendaFBA",
  "LoteMetricaGS",
  "ProdutoMetricaGestorSeller",
  "ImportacaoLote",
  "AdsCampanha",
  "Notificacao",
  "Tarefa",
  "FbmPickingBatch",
  "FbmPickingItem",
  "AmazonSettlementReport",
  "BuyBoxSnapshot",
  "AmazonFinanceTransaction",
  "InventorySnapshot",
  "AmazonReimbursement",
  "AmazonReturn",
  "AmazonStorageFee",
  "AmazonSkuTrafficDaily",
  "AmazonAdsCampanha",
  "AmazonAdsMetricaDiaria",
  "AmazonAdsMetricaHoraria",
  "AmazonAdsOptimizerState",
  "AmazonAdsPortfolio",
  "AmazonAdsCampaignEntity",
  "AmazonAdsAdGroup",
  "AmazonAdsProductAd",
  "AmazonAdsKeyword",
  "AmazonAdsTarget",
  "AmazonAdsNegativeKeyword",
  "AmazonAdsNegativeTarget",
  "AmazonAdsTargetingMetricDaily",
  "AmazonAdsSearchTermMetricDaily",
  "AdsOptimizationRun",
  "AdsOptimizationRecommendation",
  "AdsOptimizationExecutionLog",
]);

/**
 * Modelos GLOBAIS: NUNCA auto-filtrados por empresaId pela extensão.
 * Inclui base multi-tenant (Empresa/AmazonAccount/PlataformaUsuario), auth
 * (Usuario + tokens/throttle/2FA) e configuração de sistema. Observação:
 * AmazonAccount e Usuario possuem campo `empresaId`, mas o escopo de empresa
 * deles é resolvido explicitamente pela aplicação — por isso ficam aqui, não
 * em TENANT_MODELS.
 *
 * MANUTENÇÃO: usado também como sanity-check. Todo modelo do schema deve estar
 * em TENANT_MODELS ou GLOBAL_MODELS.
 */
const GLOBAL_MODELS = new Set<string>([
  "Empresa",
  "AmazonAccount",
  "PlataformaUsuario",
  "Usuario",
  "TokenRecuperacaoSenha",
  "LoginThrottle",
  "CodigoVerificacao2FA",
  "ConfiguracaoSistema",
  // AuditLog é GLOBAL de propósito: é gravado em fluxos PRÉ-contexto (login,
  // 2FA, recuperação de senha) onde ainda não há empresa resolvida. Auto-filtrar
  // por empresaId faria o fail-closed abortar essas gravações de auditoria —
  // justamente os eventos mais importantes de registrar. O helper auditLog()
  // carimba empresaId quando há contexto (getEmpresaId), para leitura escopada
  // futura. Hoje AuditLog é WRITE-ONLY (nenhum findMany na base), então não há
  // risco de vazamento entre tenants por leitura via extensão.
  "AuditLog",
  // Convite de admin e auditoria de plataforma: gravados em fluxos PRE-contexto
  // (criacao de empresa pelo superadmin, set-password publico). Sem empresaId de
  // negocio; escopo resolvido explicitamente pela aplicacao.
  "ConviteUsuario",
  "AuditPlataforma",
]);

// Exportadas para inspeção/teste. Não usar em código de produção fora daqui.
export const TENANT_MODEL_NAMES: ReadonlySet<string> = TENANT_MODELS;
export const GLOBAL_MODEL_NAMES: ReadonlySet<string> = GLOBAL_MODELS;

type TenantMode = "off" | "enforce";

function tenantMode(): TenantMode {
  const raw = process.env.TENANT_ISOLATION?.toLowerCase();
  return raw === "enforce" ? "enforce" : "off";
}

// Log deduplicado (1x por model.operation por processo) quando o fallback de
// empresa é usado — serve para mapear quais caminhos ainda não estabelecem
// contexto de tenant explícito (a serem envolvidos em runWithTenant).
const fallbackLogged = new Set<string>();
function logTenantFallbackOnce(
  model: string,
  operation: string,
  source: string | undefined,
) {
  const key = `${model}.${operation}`;
  if (fallbackLogged.has(key)) return;
  fallbackLogged.add(key);
  logger.warn(
    { model, operation, source: source ?? "none" },
    "tenant-isolation: contexto ausente — usando TENANT_FALLBACK_EMPRESA (modo single-tenant; envolver esta rota em runWithTenant antes do 2o tenant)",
  );
}

// Confirmação (1x por processo) de que a recuperação de tenant via cookie está
// funcionando para rotas web sem runWithTenant.
let cookieTenantLogged = false;
function logCookieTenantOnce() {
  if (cookieTenantLogged) return;
  cookieTenantLogged = true;
  logger.info(
    "tenant-isolation: empresaId recuperado do cookie da requisição (rota web sem runWithTenant) — escopo aplicado",
  );
}

// Operações que filtram/leem linhas existentes — injetamos where.empresaId.
const FILTERED_OPERATIONS = new Set<string>([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

// Operações de criação — injetamos data.empresaId quando ausente.
const CREATE_OPERATIONS = new Set<string>(["create", "createMany"]);

type WhereArgs = { where?: Record<string, unknown> } & Record<string, unknown>;

/**
 * Mescla `empresaId` no `where` sem sobrescrever um filtro já presente. Se o
 * caller já restringiu por empresaId (caso raro/legado), respeitamos o valor
 * dele — a extensão só PREENCHE a ausência. Nunca emite `empresaId: undefined`.
 */
function injectWhereEmpresaId(args: WhereArgs | undefined, empresaId: string): WhereArgs {
  const next: WhereArgs = { ...(args ?? {}) };
  const where = { ...(next.where ?? {}) } as Record<string, unknown>;
  if (!("empresaId" in where)) {
    where.empresaId = empresaId;
  }
  next.where = where;
  return next;
}

/**
 * Injeta `empresaId` em create/createMany quando ausente.
 * - create: args.data é um objeto.
 * - createMany: args.data é um array de objetos.
 */
function injectCreateEmpresaId(
  operation: string,
  args: Record<string, unknown> | undefined,
  empresaId: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(args ?? {}) };
  const data = next.data;
  if (operation === "createMany" && Array.isArray(data)) {
    next.data = data.map((row) => {
      const r = { ...(row as Record<string, unknown>) };
      if (!("empresaId" in r)) r.empresaId = empresaId;
      return r;
    });
    return next;
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const r = { ...(data as Record<string, unknown>) };
    if (!("empresaId" in r)) r.empresaId = empresaId;
    next.data = r;
  }
  return next;
}

/**
 * Injeta `empresaId` em upsert.
 *  - `create`: preenche empresaId quando ausente (linha nova nasce no tenant).
 *  - `update`: NUNCA permite trocar a empresa de uma linha existente — se o
 *    caller tentar setar `empresaId`, removemos para o valor do banco prevalecer.
 *  - `where`: deixado INALTERADO. O `where` de upsert é um seletor de índice
 *    ÚNICO; com uniques simples (estado atual, tenant único) a linha casada é
 *    sempre a do tenant. Quando os uniques virarem compostos (com empresaId), o
 *    próprio call site passará empresaId no `where` — e este helper continua
 *    correto (não sobrescreve where). LIMITAÇÃO documentada da transição:
 *    enquanto o unique de NEGÓCIO (ex: Produto.sku) for simples, um 2º tenant
 *    poderia casar a linha de outro no upsert. Por isso os uniques de negócio
 *    DEVEM virar compostos antes de onboard de empresa externa (Fase 1c).
 */
function injectUpsertEmpresaId(
  args: Record<string, unknown> | undefined,
  empresaId: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(args ?? {}) };
  const create = next.create;
  if (create && typeof create === "object" && !Array.isArray(create)) {
    const c = { ...(create as Record<string, unknown>) };
    if (!("empresaId" in c)) c.empresaId = empresaId;
    next.create = c;
  }
  const update = next.update;
  if (update && typeof update === "object" && !Array.isArray(update)) {
    if ("empresaId" in (update as Record<string, unknown>)) {
      const u = { ...(update as Record<string, unknown>) };
      delete u.empresaId;
      next.update = u;
    }
  }
  return next;
}

/** Argumentos genéricos de uma operação do Prisma, do ponto de vista da extensão. */
export type TenantOperationParams = {
  model?: string;
  operation: string;
  args: unknown;
  /** Executa a operação real do Prisma com os args (possivelmente reescritos). */
  query: (args: unknown) => Promise<unknown>;
};

/**
 * NÚCLEO testável do isolamento multi-tenant. A extensão do Prisma apenas
 * delega para cá. Exportada para teste — não chamar diretamente em produção.
 *
 * Contrato:
 *  - modo "off": retorna `query(args)` sem tocar em nada (no-op).
 *  - modo "enforce": para TENANT_MODELS injeta empresaId (where/data) ou faz
 *    fail-closed; modelos globais e operações desconhecidas passam inalterados.
 */
export async function applyTenantIsolation({
  model,
  operation,
  args,
  query,
}: TenantOperationParams): Promise<unknown> {
  // CAMINHO PADRÃO (flag ausente/off): no-op absoluto. Nenhuma leitura de
  // contexto, nenhuma mutação de args. Comportamento idêntico ao cliente sem
  // extensão.
  if (tenantMode() === "off") {
    return query(args);
  }

  // A partir daqui: TENANT_ISOLATION="enforce".

  // Modelos globais nunca são auto-filtrados.
  if (!model || !TENANT_MODELS.has(model)) {
    return query(args);
  }

  const ctx = getTenantContext();

  // Superadmin: acesso amplo (não injeta filtro), mas registramos. Sem
  // empresaId concreto, não há filtro a aplicar — deixa passar.
  if (ctx?.isSuperAdmin && !ctx.empresaId) {
    logger.debug(
      { model, operation, source: ctx.source },
      "tenant-isolation: superadmin amplo (sem filtro de empresaId)",
    );
    return query(args);
  }

  let empresaId = ctx?.empresaId ?? null;

  // Sem empresaId concreto e sem superadmin. NUNCA emitir
  // `where: { empresaId: undefined }` (vazaria todos os tenants).
  if (!empresaId) {
    // FONTE SECUNDÁRIA (rotas web): rotas que usam requireRole/requireSession
    // direto não propagam o contexto via ALS (enterWith não sobrevive ao await).
    // Recuperamos o tenant do cookie de sessão assinado da requisição corrente —
    // multi-tenant CORRETO (cada request usa o empresaId do seu cookie) e seguro
    // (o corpo da rota valida o usuário via requireRole ANTES de qualquer query).
    const fromCookie = await resolveEmpresaIdFromRequestCookie();
    if (fromCookie) {
      logCookieTenantOnce();
      empresaId = fromCookie;
    } else {
      // FALLBACK SINGLE-TENANT (interim, opcional): TENANT_FALLBACK_EMPRESA cobre
      // caminhos sem contexto ALS E sem cookie (raro). SEGURO só com uma empresa.
      const fallback = process.env.TENANT_FALLBACK_EMPRESA?.trim();
      if (fallback) {
        logTenantFallbackOnce(model, operation, ctx?.source);
        empresaId = fallback;
      } else {
        // FAIL-CLOSED (default — sem cookie e sem fallback configurado).
        throw new Error(
          `[tenant-isolation] Contexto de empresa ausente para operação tenant ` +
            `"${model}.${operation}". Configure runWithTenant({ empresaId }) antes ` +
            `da query (ou marque o contexto como isSuperAdmin para acesso amplo).`,
        );
      }
    }
  }

  // findUnique / findUniqueOrThrow: o Prisma só aceita campos do índice único
  // no `where`, então NÃO podemos injetar empresaId ali. Em vez disso fazemos a
  // query normal e validamos o tenant PÓS-FETCH: se o registro pertencer a
  // outra empresa, devolvemos null. Isso mantém o isolamento sem quebrar a
  // tipagem do Prisma.
  if (operation === "findUnique" || operation === "findUniqueOrThrow") {
    const result = (await query(args)) as { empresaId?: string | null } | null;
    if (result == null) return result;
    // Se o registro não expõe empresaId (caller restringiu o `select`), não
    // temos como validar pós-fetch — fail-closed para não vazar.
    if (!("empresaId" in (result as object))) {
      throw new Error(
        `[tenant-isolation] ${model}.${operation}: não foi possível validar ` +
          `empresaId pós-fetch (campo ausente no resultado — verifique o select). ` +
          `Abortando para evitar vazamento entre tenants.`,
      );
    }
    if (result.empresaId !== empresaId) {
      return null;
    }
    return result;
  }

  if (FILTERED_OPERATIONS.has(operation)) {
    return query(injectWhereEmpresaId(args as WhereArgs, empresaId));
  }

  if (CREATE_OPERATIONS.has(operation)) {
    return query(
      injectCreateEmpresaId(operation, args as Record<string, unknown>, empresaId),
    );
  }

  if (operation === "upsert") {
    return query(injectUpsertEmpresaId(args as Record<string, unknown>, empresaId));
  }

  // Operações sem regra explícita: deixa passar inalterado.
  return query(args);
}

// ⚠️ INVARIANTE DE SEGURANÇA — QUERIES RAW NÃO SÃO ISOLADAS POR TENANT.
// A extensão abaixo só intercepta operações de MODELO (findMany, update, …).
// `db.$queryRaw` / `$executeRaw` / `$queryRawUnsafe` / `$executeRawUnsafe`
// PASSAM DIRETO ao banco, SEM injeção de `empresaId`. Regras (audit 2026-06, F10):
//   1. NUNCA use raw para LER/ESCREVER linhas de modelos TENANT (vendas, pedidos,
//      financeiro, PII…) em caminho de requisição web. Use o client de modelo.
//   2. Se for inevitável, adicione você mesmo `WHERE "empresaId" = $1` com o
//      empresaId do contexto (getEmpresaId()), parametrizado — nunca interpolado.
//   3. NUNCA interpole input do usuário em $queryRawUnsafe (SQL injection).
// Usos atuais auditados e considerados seguros: health (`SELECT 1`), sistema/
// db-stats (ADMIN, métricas agregadas de banco — sem PII), e scripts manuais de
// operador/sistema (fora do escopo de requisição).
function buildClient() {
  const base = new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
    ...(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : {}),
  });

  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return applyTenantIsolation({
            model,
            operation,
            args,
            query: (a) => query(a as typeof args),
          });
        },
      },
    },
  });
}

export const db = globalForPrisma.prisma ?? buildClient();

/**
 * Tipo do cliente Prisma ESTENDIDO exportado por este módulo. `$extends` muda o
 * tipo de retorno (perde métodos internos `$on`/`$use`, ganha o extension), por
 * isso quem aceita `db` como default de transação deve usar este tipo em vez de
 * `PrismaClient` cru. Em runtime continua compatível (delegates + $transaction).
 */
export type ExtendedPrismaClient = typeof db;

/**
 * Tipo do `tx` entregue por `db.$transaction(async (tx) => ...)` no cliente
 * estendido. Difere do `Prisma.TransactionClient` cru (carrega o tipo das
 * extensions), então funções que recebem `tx` como parâmetro devem aceitá-lo.
 */
export type ExtendedTransactionClient = Parameters<
  Parameters<ExtendedPrismaClient["$transaction"]>[0]
>[0];

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
