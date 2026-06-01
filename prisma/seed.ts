import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { semearEmpresa } from "../src/modules/plataforma/seed-empresa";

const db = new PrismaClient();

// Empresa-tenant do seed (multi-tenant: uniques agora são compostos com empresaId).
// seed.ts usa PrismaClient cru (sem a extensão de isolamento), então preenchemos
// empresaId explicitamente.
const SEED_EMPRESA_ID = "mundofs";

// Renomeações de categorias entre versões do seed. Quando a nova categoria já
// existe, os vínculos são mesclados antes de remover a antiga.
const RENOMEACOES: Array<{ antigo: string; novo: string }> = [
  { antigo: "Vendas Amazon", novo: "Pagamento Amazon" },
  { antigo: "Reposição de estoque", novo: "Compra de mercadorias / produtos" },
];

async function main() {
  console.log("→ seed: categorias padrão + sentinelas Contas Fixas");
  await semearEmpresa(db, SEED_EMPRESA_ID);

  for (const r of RENOMEACOES) {
    const antiga = await db.categoria.findFirst({ where: { nome: r.antigo } });
    if (!antiga) continue;
    const nova = await db.categoria.findFirst({ where: { nome: r.novo } });

    if (!nova) {
      await db.categoria.update({
        where: { id: antiga.id },
        data: { nome: r.novo },
      });
      console.log(`  ✓ renomeada categoria "${r.antigo}" para "${r.novo}"`);
    } else {
      const usos =
        (await db.movimentacao.count({ where: { categoriaId: antiga.id } })) +
        (await db.contaPagar.count({ where: { categoriaId: antiga.id } }));

      await db.$transaction([
        db.movimentacao.updateMany({
          where: { categoriaId: antiga.id },
          data: { categoriaId: nova.id },
        }),
        db.contaPagar.updateMany({
          where: { categoriaId: antiga.id },
          data: { categoriaId: nova.id },
        }),
        db.categoria.delete({ where: { id: antiga.id } }),
      ]);

      console.log(
        `  ✓ mesclada categoria "${r.antigo}" em "${r.novo}" (${usos} vínculo(s))`,
      );
    }
  }

  await seedUsuarioInicial();

  console.log("✓ seed concluído");
}

// Cria o usuário inicial se (a) não houver nenhum usuário no banco e (b) as
// variáveis AUTH_SEED_* estiverem preenchidas. Se o e-mail já existe, não mexe.
async function seedUsuarioInicial() {
  const email = process.env.AUTH_SEED_EMAIL?.toLowerCase().trim();
  const senha = process.env.AUTH_SEED_SENHA;
  const nome = process.env.AUTH_SEED_NOME?.trim();

  if (!email || !senha || !nome) {
    console.log(
      "→ seed: usuário inicial pulado (defina AUTH_SEED_EMAIL, AUTH_SEED_SENHA, AUTH_SEED_NOME no .env)",
    );
    return;
  }

  const existente = await db.usuario.findUnique({
    where: { empresaId_email: { empresaId: SEED_EMPRESA_ID, email } },
  });
  if (existente) {
    console.log(`→ seed: usuário "${email}" já existe, mantendo`);
    return;
  }

  const senhaHash = await bcrypt.hash(senha, 12);
  await db.usuario.create({
    data: { email, nome, senhaHash, role: "ADMIN", empresaId: SEED_EMPRESA_ID },
  });
  console.log(`✓ seed: usuário inicial "${email}" criado`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
