/**
 * Verifica se as migrations da Sprint 2 de hardening foram aplicadas.
 * Roda contra o DB configurado em DATABASE_URL (ou MIGRATION_DATABASE_URL
 * se rolar separacao de roles do Postgres).
 *
 * Uso:
 *   npx tsx scripts/migration-status.ts
 *   DATABASE_URL="..." npx tsx scripts/migration-status.ts
 *
 * Saida: tabela com status de cada migration + check funcional dos campos.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { db } from "../src/lib/db";

type CheckResult = {
  nome: string;
  aplicada: boolean;
  detalhe: string;
};

async function checkCodigo2faTentativas(): Promise<CheckResult> {
  try {
    // Tenta selecionar tentativas — falha se a coluna não existe
    await db.codigoVerificacao2FA.findFirst({ select: { tentativas: true } });
    return {
      nome: "20260522180000_codigo2fa_tentativas",
      aplicada: true,
      detalhe: "campo CodigoVerificacao2FA.tentativas presente",
    };
  } catch (err) {
    return {
      nome: "20260522180000_codigo2fa_tentativas",
      aplicada: false,
      detalhe: `coluna ausente: ${(err as Error).message.slice(0, 100)}`,
    };
  }
}

async function checkUsuarioSessionVersion(): Promise<CheckResult> {
  try {
    await db.usuario.findFirst({ select: { sessionVersion: true } });
    return {
      nome: "20260523120000_usuario_session_version",
      aplicada: true,
      detalhe: "campo Usuario.sessionVersion presente",
    };
  } catch (err) {
    return {
      nome: "20260523120000_usuario_session_version",
      aplicada: false,
      detalhe: `coluna ausente: ${(err as Error).message.slice(0, 100)}`,
    };
  }
}

async function checkLoginThrottle(): Promise<CheckResult> {
  try {
    await db.loginThrottle.count();
    return {
      nome: "20260523130000_login_throttle",
      aplicada: true,
      detalhe: "tabela LoginThrottle acessivel",
    };
  } catch (err) {
    return {
      nome: "20260523130000_login_throttle",
      aplicada: false,
      detalhe: `tabela ausente: ${(err as Error).message.slice(0, 100)}`,
    };
  }
}

async function main() {
  const url = process.env.DATABASE_URL ?? "(nao configurado)";
  console.log("Atlas Seller — Migration status check");
  console.log("=".repeat(60));
  console.log("DATABASE_URL:", url.replace(/(:\/\/[^:]+:)[^@]+(@)/, "$1***$2"));
  console.log("");

  const checks = await Promise.all([
    checkCodigo2faTentativas(),
    checkUsuarioSessionVersion(),
    checkLoginThrottle(),
  ]);

  let okCount = 0;
  for (const c of checks) {
    const icon = c.aplicada ? "✓" : "✗";
    console.log(`${icon} ${c.nome}`);
    console.log(`   ${c.detalhe}`);
    if (c.aplicada) okCount++;
  }

  console.log("");
  console.log(`Resumo: ${okCount}/${checks.length} migrations aplicadas.`);

  if (okCount < checks.length) {
    console.log("");
    console.log("Para aplicar em SQLite (dev):");
    console.log('  DATABASE_URL="file:./prisma/dev.db" npm run prisma:push');
    console.log("");
    console.log("Para aplicar em Postgres (prod):");
    console.log("  npm run prisma:migrate:deploy:pg");
    console.log("  npm run prisma:generate:pg");
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[migration-status] erro:", err);
  process.exit(2);
});
