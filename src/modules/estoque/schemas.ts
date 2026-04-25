import { z } from "zod";
import {
  TipoMovimentacaoEstoque,
  OrigemMovimentacaoEstoque,
  StatusReposicao,
} from "@/modules/shared/domain";

export const criarProdutoSchema = z.object({
  sku: z
    .string()
    .min(1, "SKU obrigatório")
    .max(100)
    .regex(/^MFS-/, "SKU deve comecar com 'MFS-'"),
  asin: z.string().max(20).optional().nullable(),
  nome: z.string().min(1, "Nome obrigatório").max(200),
  descricao: z.string().max(500).optional().nullable(),
  custoUnitario: z.number().int().min(0).optional().nullable(),
  precoVenda: z.number().int().min(0).optional().nullable(),
  estoqueMinimo: z.number().int().min(0).default(0),
  unidade: z.string().max(20).default("un"),
  imagemUrl: z.string().url().optional().nullable(),
  observacoes: z.string().max(500).optional().nullable(),
});
export type CriarProdutoInput = z.infer<typeof criarProdutoSchema>;

export const atualizarProdutoSchema = criarProdutoSchema
  .partial()
  .omit({ sku: true })
  .extend({
    solicitarReviewsAtivo: z.boolean().optional(),
  });
export type AtualizarProdutoInput = z.infer<typeof atualizarProdutoSchema>;

export const filtrosProdutoSchema = z.object({
  busca: z.string().optional(),
  ativo: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  statusReposicao: z
    .enum([
      StatusReposicao.OK,
      StatusReposicao.ATENCAO,
      StatusReposicao.REPOR,
    ])
    .optional(),
  incluirNaoMfs: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});
export type FiltrosProdutoInput = z.infer<typeof filtrosProdutoSchema>;

export const criarMovimentacaoEstoqueSchema = z.object({
  produtoId: z.string().min(1),
  tipo: z.enum([TipoMovimentacaoEstoque.ENTRADA, TipoMovimentacaoEstoque.SAIDA]),
  quantidade: z.number().int().min(1, "Quantidade deve ser ≥ 1"),
  custoUnitario: z.number().int().min(0).optional().nullable(),
  origem: z.enum([
    OrigemMovimentacaoEstoque.MANUAL,
    OrigemMovimentacaoEstoque.IMPORTACAO,
    OrigemMovimentacaoEstoque.AJUSTE,
    OrigemMovimentacaoEstoque.COMPRA,
    OrigemMovimentacaoEstoque.VENDA,
  ]),
  observacoes: z.string().max(500).optional().nullable(),
  dataMovimentacao: z.string().datetime({ offset: true }).or(z.string().date()),
});
export type CriarMovimentacaoEstoqueInput = z.infer<
  typeof criarMovimentacaoEstoqueSchema
>;

export const importarProdutosSchema = z.array(
  z.object({
    sku: z
      .string()
      .min(1)
      .regex(/^MFS-/, "SKU deve comecar com 'MFS-'"),
    asin: z.string().optional().nullable(),
    nome: z.string().min(1),
    custoUnitario: z.number().int().min(0).optional().nullable(),
    estoqueMinimo: z.number().int().min(0).optional(),
    unidade: z.string().optional(),
    estoqueInicial: z.number().int().min(0).optional(),
  }),
);
export type ImportarProdutosInput = z.infer<typeof importarProdutosSchema>;
