import type { PrismaClient } from "@prisma/client";

type TipoCategoria = "RECEITA" | "DESPESA" | "AMBAS";

export const CATEGORIAS_PADRAO: Array<{ nome: string; tipo: TipoCategoria; cor: string }> = [
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

// Nome da sentinela usada pelo módulo contas-fixas quando categoria/fornecedor
// não são informados. NÃO renomear sem alinhar com contas-fixas/repository.
export const SENTINELA_CONTAS_FIXAS = "Contas Fixas";

/** Cliente mínimo aceito: o cru (seed.ts) ou o tx estendido (criarEmpresa). */
type SeedClient = Pick<PrismaClient, "categoria" | "fornecedor">;

/**
 * Semeia catálogo inicial de uma empresa: 18 categorias padrão + sentinelas
 * "Contas Fixas" (categoria DESPESA + fornecedor). Idempotente (upsert por
 * @@unique([empresaId, nome])). empresaId é passado EXPLÍCITO em todo create —
 * funciona com o client cru (sem extensão) e com o estendido.
 */
export async function semearEmpresa(client: SeedClient, empresaId: string): Promise<void> {
  for (const cat of CATEGORIAS_PADRAO) {
    await client.categoria.upsert({
      where: { empresaId_nome: { empresaId, nome: cat.nome } },
      update: { tipo: cat.tipo, cor: cat.cor },
      create: { ...cat, empresaId },
    });
  }
  await client.categoria.upsert({
    where: { empresaId_nome: { empresaId, nome: SENTINELA_CONTAS_FIXAS } },
    update: {},
    create: { nome: SENTINELA_CONTAS_FIXAS, tipo: "DESPESA", cor: "#7c3aed", empresaId },
  });
  await client.fornecedor.upsert({
    where: { empresaId_nome: { empresaId, nome: SENTINELA_CONTAS_FIXAS } },
    update: {},
    create: { nome: SENTINELA_CONTAS_FIXAS, empresaId },
  });
}
