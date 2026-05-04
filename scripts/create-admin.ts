/**
 * Cria ou reseta a senha do usuário ADMIN no banco de produção.
 *
 * Uso na VPS:
 *   sudo -u erp npx tsx scripts/create-admin.ts
 *   sudo -u erp npx tsx scripts/create-admin.ts --email admin@empresa.com --senha MinhaSenh@123 --nome "Heitor"
 *
 * Flags opcionais:
 *   --email   (padrão: admin@mundofs.cloud)
 *   --senha   (padrão: ERP@2026mundofs)
 *   --nome    (padrão: Administrador)
 *   --reset   força reset de senha mesmo que o usuário já exista
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

function arg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const email = arg("--email", "admin@mundofs.cloud").toLowerCase().trim();
const senha = arg("--senha", "ERP@2026mundofs");
const nome  = arg("--nome",  "Administrador");
const reset = process.argv.includes("--reset");

async function main() {
  console.log(`\n[create-admin] banco: ${process.env.DATABASE_URL?.split("@")[1] ?? "local"}`);
  console.log(`[create-admin] email alvo: ${email}`);

  const existente = await db.usuario.findUnique({ where: { email } });

  if (existente) {
    if (!reset) {
      console.log(`\n✓ Usuário "${email}" já existe.`);
      console.log("  Use --reset para forçar a troca de senha.");
      console.log("  Ex: npx tsx scripts/create-admin.ts --reset --senha NovaSenha123\n");
      return;
    }

    const senhaHash = await bcrypt.hash(senha, 10);
    await db.usuario.update({
      where: { email },
      data: { senhaHash, ativo: true, twoFactorEnabled: false },
    });
    console.log(`\n✓ Senha do usuário "${email}" redefinida.`);
  } else {
    const senhaHash = await bcrypt.hash(senha, 10);
    await db.usuario.create({
      data: { email, nome, senhaHash, role: "ADMIN", ativo: true },
    });
    console.log(`\n✓ Usuário ADMIN criado: ${email}`);
  }

  console.log(`  Senha: ${senha}`);
  console.log("  Acesse o ERP e troque a senha imediatamente em Perfil → Alterar senha.\n");
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => db.$disconnect());
