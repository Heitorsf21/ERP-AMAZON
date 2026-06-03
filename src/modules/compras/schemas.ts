import { z } from "zod";

// Campos opcionais vindos de <Select>/<Input> chegam como "" quando vazios.
// "" passaria pelo `?? null` do repositório (nullish só pega null/undefined) e
// um fornecedorId="" viola a FK (PedidoCompra_fornecedorId_fkey). Normalizamos
// string vazia -> undefined na borda para todos os opcionais.
const stringOpcional = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().optional(),
);

export const itemPedidoSchema = z.object({
  produtoId: z.string().min(1, "Produto obrigatório"),
  quantidade: z.number().int().positive("Quantidade deve ser maior que zero"),
  custoUnitario: z
    .number()
    .int()
    .nonnegative("Custo não pode ser negativo"),
});

export const criarPedidoCompraSchema = z.object({
  numero: stringOpcional,
  fornecedorId: stringOpcional,
  dataEmissao: z.string(), // ISO date string
  dataPrevisao: stringOpcional,
  observacoes: stringOpcional,
  itens: z
    .array(itemPedidoSchema)
    .min(1, "Adicione pelo menos 1 item ao pedido"),
});

export const atualizarPedidoCompraSchema = criarPedidoCompraSchema.partial();

export const confirmarPedidoSchema = z.object({
  criarContaPagar: z.boolean().optional().default(true),
  vencimento: z.string().optional(), // ISO date; default = dataPrevisao ou hoje+15d
});

export const receberPedidoSchema = z.object({
  dataRecebimento: z.string(), // ISO date
});

export type CriarPedidoCompraInput = z.infer<typeof criarPedidoCompraSchema>;
export type AtualizarPedidoCompraInput = z.infer<typeof atualizarPedidoCompraSchema>;
export type ConfirmarPedidoInput = z.infer<typeof confirmarPedidoSchema>;
export type ReceberPedidoInput = z.infer<typeof receberPedidoSchema>;
