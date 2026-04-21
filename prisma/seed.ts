import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { TipoCategoria } from "../src/modules/shared/domain";

const db = new PrismaClient();

// Conjunto mínimo para destravar o F1: categorias padrão + 1 fornecedor exemplo.
// Cada categoria vira âncora de movimentações e contas. Percentuais da
// "destinação do recebido" (F6) virão depois em ConfiguracaoSistema.
const CATEGORIAS_PADRAO: Array<{
  nome: string;
  tipo: TipoCategoria;
  cor: string;
}> = [
  { nome: "Pagamento Amazon", tipo: "RECEITA", cor: "#16a34a" },
  { nome: "Outras receitas", tipo: "RECEITA", cor: "#0ea5e9" },
  { nome: "Aportes dos sócios", tipo: "RECEITA", cor: "#22c55e" },
  { nome: "Resgates de aplicações", tipo: "RECEITA", cor: "#14b8a6" },
  { nome: "Compra de mercadorias / produtos", tipo: "DESPESA", cor: "#ea580c" },
  { nome: "Fretes e entregas", tipo: "DESPESA", cor: "#f97316" },
  { nome: "Impostos", tipo: "DESPESA", cor: "#dc2626" },
  { nome: "Despesas operacionais", tipo: "DESPESA", cor: "#6366f1" },
  { nome: "Contabilidade", tipo: "DESPESA", cor: "#0891b2" },
  { nome: "Pagamento de fatura", tipo: "DESPESA", cor: "#7c3aed" },
  { nome: "Marketing", tipo: "DESPESA", cor: "#ec4899" },
  { nome: "Serviços terceirizados", tipo: "DESPESA", cor: "#0f766e" },
  { nome: "Tecnologia e sistemas", tipo: "DESPESA", cor: "#2563eb" },
  { nome: "Taxas de plataformas / pagamentos", tipo: "DESPESA", cor: "#9333ea" },
  { nome: "Aplicações financeiras", tipo: "DESPESA", cor: "#64748b" },
  { nome: "Reserva", tipo: "DESPESA", cor: "#64748b" },
  { nome: "Pró-labore / Lucro", tipo: "DESPESA", cor: "#a16207" },
  { nome: "Ajuste de saldo", tipo: "AMBAS", cor: "#475569" },
];

// Renomeações de categorias entre versões do seed. Quando a nova categoria já
// existe, os vínculos são mesclados antes de remover a antiga.
const RENOMEACOES: Array<{ antigo: string; novo: string }> = [
  { antigo: "Vendas Amazon", novo: "Pagamento Amazon" },
  { antigo: "Reposição de estoque", novo: "Compra de mercadorias / produtos" },
];

async function main() {
  console.log("→ seed: categorias padrão");
  for (const cat of CATEGORIAS_PADRAO) {
    await db.categoria.upsert({
      where: { nome: cat.nome },
      update: { tipo: cat.tipo, cor: cat.cor },
      create: cat,
    });
  }

  for (const r of RENOMEACOES) {
    const antiga = await db.categoria.findUnique({ where: { nome: r.antigo } });
    if (!antiga) continue;
    const nova = await db.categoria.findUnique({ where: { nome: r.novo } });

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

  console.log("→ seed: fornecedor exemplo");
  await db.fornecedor.upsert({
    where: { nome: "Fornecedor Exemplo" },
    update: {},
    create: {
      nome: "Fornecedor Exemplo",
      observacoes:
        "Registro de exemplo criado pelo seed. Pode ser apagado quando a base real for cadastrada.",
    },
  });

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

  const existente = await db.usuario.findUnique({ where: { email } });
  if (existente) {
    console.log(`→ seed: usuário "${email}" já existe, mantendo`);
    return;
  }

  const senhaHash = await bcrypt.hash(senha, 10);
  await db.usuario.create({
    data: { email, nome, senhaHash, role: "ADMIN" },
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
