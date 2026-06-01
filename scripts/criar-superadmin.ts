/**
 * Bootstrap do 1o superadmin (PlataformaUsuario). Uso:
 *   npx tsx scripts/criar-superadmin.ts --email a@b.com --nome "Fulano" --senha "..."
 * Idempotente: se o email ja existe, atualiza nome/senha.
 */
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("--email")?.toLowerCase().trim();
  const nome = arg("--nome")?.trim();
  const senha = arg("--senha");
  if (!email || !nome || !senha) {
    logger.error("Uso: --email <e> --nome <n> --senha <s>");
    process.exit(1);
  }
  if (senha.length < 10) {
    logger.error("Senha do superadmin deve ter >= 10 caracteres.");
    process.exit(1);
  }
  const senhaHash = await bcrypt.hash(senha, 12);
  const u = await db.plataformaUsuario.upsert({
    where: { email },
    update: { nome, senhaHash, ativo: true },
    create: { email, nome, senhaHash, ativo: true },
  });
  logger.info({ id: u.id, email: u.email }, "superadmin pronto");
  await db.$disconnect();
}

main().catch((e) => { logger.error({ err: e }, "falha"); process.exit(1); });
