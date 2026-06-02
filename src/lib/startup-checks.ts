// Verificações de boot (fail-fast) — protegem invariantes de segurança que, se
// violadas, NÃO devem deixar o processo subir em produção.
//
// Motivação (audit 2026-06): o isolamento multi-tenant defaultava para "off" e
// nada garantia que CONFIG_ENCRYPTION_KEY/SESSION_SECRET existissem em produção.
// Estas funções centralizam os guards e são chamadas em `instrumentation.ts`
// (boot do Next, runtime nodejs) e no entrypoint do worker.
//
// Design: o NÚCLEO são funções PURAS (recebem env/contagens, retornam issues),
// fáceis de testar. `runStartupChecks` é o orquestrador impuro que lê process.env,
// consulta o banco e LANÇA em issues fatais.

import { logger } from "./logger";

export type StartupEnv = {
  nodeEnv?: string;
  sessionSecret?: string;
  plataformaSessionSecret?: string;
  configEncryptionKey?: string;
  tenantIsolation?: string;
};

export type GuardIssue = {
  level: "fatal" | "warn";
  code: string;
  message: string;
};

const HEX_64 = /^[0-9a-fA-F]{64}$/;

/**
 * Isolamento multi-tenant: assim que existe mais de uma empresa no banco, a flag
 * TENANT_ISOLATION TEM que estar em "enforce" — caso contrário queries cruzam
 * tenants (vazamento de PII). Com 0 ou 1 empresa é inócuo (single-tenant).
 */
export function checkTenantIsolation(
  empresaCount: number,
  tenantIsolation: string | undefined,
): GuardIssue | null {
  if (empresaCount <= 1) return null;
  const mode = tenantIsolation?.toLowerCase();
  if (mode === "enforce") return null;
  return {
    level: "fatal",
    code: "TENANT_ISOLATION_OFF_MULTI_TENANT",
    message:
      `Há ${empresaCount} empresas no banco mas TENANT_ISOLATION=${tenantIsolation ?? "(ausente)"}. ` +
      `Com mais de um tenant, o isolamento é OBRIGATÓRIO: defina TENANT_ISOLATION=enforce. ` +
      `Subir assim vazaria dados (e PII) entre empresas.`,
  };
}

/**
 * Segredos obrigatórios em produção. Em desenvolvimento são apenas avisos
 * (modo permissivo documentado), nunca fatais — para não travar o boot local.
 */
export function checkRequiredSecrets(env: StartupEnv): GuardIssue[] {
  const isProd = env.nodeEnv === "production";
  const level: GuardIssue["level"] = isProd ? "fatal" : "warn";
  const issues: GuardIssue[] = [];

  if (!env.sessionSecret || env.sessionSecret.length < 32) {
    issues.push({
      level,
      code: "SESSION_SECRET_INVALIDO",
      message: "SESSION_SECRET ausente ou com menos de 32 caracteres.",
    });
  }

  if (!env.plataformaSessionSecret || env.plataformaSessionSecret.length < 32) {
    issues.push({
      level,
      code: "PLATAFORMA_SESSION_SECRET_INVALIDO",
      message: "PLATAFORMA_SESSION_SECRET ausente ou com menos de 32 caracteres.",
    });
  }

  if (!env.configEncryptionKey || !HEX_64.test(env.configEncryptionKey)) {
    issues.push({
      level,
      code: "CONFIG_ENCRYPTION_KEY_INVALIDO",
      message:
        "CONFIG_ENCRYPTION_KEY ausente ou não é hex de 32 bytes (64 caracteres). " +
        "Sem ela, credenciais OAuth/SMTP ficam em texto puro.",
    });
  }

  return issues;
}

function readEnv(): StartupEnv {
  return {
    nodeEnv: process.env.NODE_ENV,
    sessionSecret: process.env.SESSION_SECRET,
    plataformaSessionSecret: process.env.PLATAFORMA_SESSION_SECRET,
    configEncryptionKey: process.env.CONFIG_ENCRYPTION_KEY,
    tenantIsolation: process.env.TENANT_ISOLATION,
  };
}

/**
 * Orquestrador de boot. Reúne todas as issues, loga e LANÇA se houver alguma
 * fatal. `countEmpresas` é injetável para teste; em runtime usa db.empresa.count().
 * Falha de banco ao contar é tratada como WARN (não derruba o boot por
 * indisponibilidade transitória do DB) — o guard de isolamento só dispara quando
 * conseguimos confirmar >1 empresa.
 */
export async function runStartupChecks(opts?: {
  countEmpresas?: () => Promise<number>;
}): Promise<void> {
  const env = readEnv();
  const issues: GuardIssue[] = [...checkRequiredSecrets(env)];

  try {
    const counter =
      opts?.countEmpresas ??
      (async () => {
        const { db } = await import("./db");
        return db.empresa.count();
      });
    const empresaCount = await counter();
    const tenantIssue = checkTenantIsolation(empresaCount, env.tenantIsolation);
    if (tenantIssue) issues.push(tenantIssue);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[startup] não foi possível contar empresas para o guard de isolamento — pulando essa verificação",
    );
  }

  for (const issue of issues) {
    if (issue.level === "fatal") {
      logger.error({ code: issue.code }, `[startup] FATAL: ${issue.message}`);
    } else {
      logger.warn({ code: issue.code }, `[startup] aviso: ${issue.message}`);
    }
  }

  const fatais = issues.filter((i) => i.level === "fatal");
  if (fatais.length > 0) {
    throw new Error(
      `[startup] ${fatais.length} verificação(ões) de segurança falharam: ` +
        fatais.map((i) => i.code).join(", ") +
        ". Corrija a configuração antes de subir o processo.",
    );
  }
}
