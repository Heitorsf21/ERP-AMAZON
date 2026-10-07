import { z } from "zod";

// ── Faixas de cobertura de estoque ───────────────────────────────────
// Classificacao por dias de cobertura (estoqueAtual / mediaDiaVendas30d).
export const FaixaEstoque = {
  CRITICO: "CRITICO",
  ATENCAO: "ATENCAO",
  ESTAVEL: "ESTAVEL",
  SEGURO: "SEGURO",
} as const;
export type FaixaEstoque = (typeof FaixaEstoque)[keyof typeof FaixaEstoque];

// Ordem fixa usada na mensagem (do mais urgente ao mais folgado).
export const FAIXAS_ORDENADAS: readonly FaixaEstoque[] = [
  FaixaEstoque.CRITICO,
  FaixaEstoque.ATENCAO,
  FaixaEstoque.ESTAVEL,
  FaixaEstoque.SEGURO,
];

export const FAIXA_LABEL: Record<FaixaEstoque, string> = {
  CRITICO: "Critico",
  ATENCAO: "Atencao",
  ESTAVEL: "Estavel",
  SEGURO: "Seguro",
};

// Limiares (em dias de cobertura, comparados sobre o valor arredondado p/ baixo):
//   <= 15  -> CRITICO
//   <= 30  -> ATENCAO
//   <  60  -> ESTAVEL
//   >= 60  -> SEGURO
export const FAIXA_CRITICO_MAX_DIAS = 15;
export const FAIXA_ATENCAO_MAX_DIAS = 30;
export const FAIXA_SEGURO_MIN_DIAS = 60;

/**
 * Classifica a cobertura de estoque em faixa. Opera sobre o valor arredondado
 * para baixo (mesma logica da cobertura exibida) para alinhar mensagem e faixa.
 * Pura (sem db): usada no servidor (resumo WhatsApp) e no cliente (cards).
 */
export function classificarFaixa(diasEstoque: number): FaixaEstoque {
  const dias = Math.floor(diasEstoque);
  if (dias <= FAIXA_CRITICO_MAX_DIAS) return FaixaEstoque.CRITICO;
  if (dias <= FAIXA_ATENCAO_MAX_DIAS) return FaixaEstoque.ATENCAO;
  if (dias < FAIXA_SEGURO_MIN_DIAS) return FaixaEstoque.ESTAVEL;
  return FaixaEstoque.SEGURO;
}

// ── Validacao da configuracao (rota POST) ────────────────────────────
const HORARIO_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const salvarConfigSchema = z.object({
  ativo: z.boolean(),
  horario: z
    .string()
    .trim()
    .regex(HORARIO_REGEX, "horario deve estar no formato HH:mm"),
  destinatario: z.string().trim().max(25),
  wahaUrl: z
    .string()
    .trim()
    .max(300)
    .refine(
      (v) => v === "" || /^https?:\/\//i.test(v),
      "URL do WAHA deve comecar com http:// ou https://",
    ),
  wahaSession: z.string().trim().max(80),
  // Pode vir mascarada (com "*") da UI quando o usuario nao redigita o segredo.
  wahaApiKey: z.string().trim().max(300).optional(),
});

export type SalvarConfigInput = z.infer<typeof salvarConfigSchema>;
