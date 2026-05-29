import { z } from "zod";

export const criarContaFixaSchema = z.object({
  descricao: z.string().trim().min(1, "descrição obrigatória").max(300),
  // valor em centavos
  valorCentavos: z.number().int().positive("valor deve ser > 0"),
  diaVencimento: z
    .number()
    .int()
    .min(1, "dia entre 1 e 31")
    .max(31, "dia entre 1 e 31"),
  recorrente: z.boolean().default(true),
  // Data completa da ocorrência única (yyyy-MM-dd) — usada quando NÃO recorrente.
  // O backend deriva diaVencimento + competência a partir dela.
  vencimentoUnico: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "formato yyyy-MM-dd")
    .nullish(),
  ativa: z.boolean().default(true),
  categoriaId: z.string().trim().min(1).nullish(),
  fornecedorId: z.string().trim().min(1).nullish(),
  observacoes: z.string().trim().max(500).nullish(),
});

export const atualizarContaFixaSchema = criarContaFixaSchema.partial().extend({
  // Quando true, ao editar, atualiza as ocorrências FUTURAS em aberto
  // (ABERTA/VENCIDA) com o novo valor/dia; ocorrências pagas nunca mudam.
  sincronizarFuturas: z.boolean().optional(),
});

export const garantirOcorrenciasSchema = z.object({
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "formato yyyy-MM-dd"),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "formato yyyy-MM-dd"),
});

export type CriarContaFixaInput = z.infer<typeof criarContaFixaSchema>;
export type AtualizarContaFixaInput = z.infer<typeof atualizarContaFixaSchema>;
