import { z } from "zod";

export const criarContaSchema = z.object({
  fornecedorNome: z.string().min(1, "fornecedor obrigatório").max(200),
  fornecedorDocumento: z.string().optional(),
  categoriaId: z.string().min(1, "categoria obrigatória"),
  descricao: z.string().min(1, "descrição obrigatória").max(300),
  // valor em centavos
  valorCentavos: z.number().int().positive("valor deve ser > 0"),
  // ISO date string (yyyy-MM-dd)
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "formato yyyy-MM-dd"),
  recorrencia: z.enum(["NENHUMA", "MENSAL"]).default("NENHUMA"),
  observacoes: z.string().max(500).optional(),
  nfAnexo: z.string().optional(),
  nfNome: z.string().optional(),
  dossieId: z.string().optional(),
});

export const pagarContaSchema = z.object({
  // ISO date string (yyyy-MM-dd)
  pagoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "formato yyyy-MM-dd"),
});

export const filtrosContaSchema = z.object({
  status: z.string().optional(),
  fornecedorId: z.string().optional(),
  categoriaId: z.string().optional(),
  de: z.string().optional(),
  ate: z.string().optional(),
});

export type CriarContaInput = z.infer<typeof criarContaSchema>;
export type PagarContaInput = z.infer<typeof pagarContaSchema>;
export type FiltrosConta = z.infer<typeof filtrosContaSchema>;
