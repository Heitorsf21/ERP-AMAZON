import { z } from "zod";
import {
  OrigemMovimentacao,
  TipoMovimentacao,
} from "@/modules/shared/domain";
import { fimDoDiaSP, inicioDoDiaSP, parseDataBR } from "@/lib/date";

const tipoEnum = z.enum([TipoMovimentacao.ENTRADA, TipoMovimentacao.SAIDA]);

// Aceita "yyyy-MM-dd" (input[type=date]) e "dd/MM/yyyy" (planilhas/URL) como
// meia-noite no fuso de SP. ISO completo ("...T00:00:00.000Z") segue o path
// padrão do z.coerce.date(), preservando a semântica.
const dataSchemaBase = z.preprocess((v) => {
  if (typeof v === "string") {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
      return parseDataBR(s);
    }
  }
  return v;
}, z.coerce.date());

// Movimentações têm precisão de dia — normalizamos para início do dia em SP.
const dataDiaSchema = dataSchemaBase.transform(inicioDoDiaSP);

// Formulário do usuário: valor em reais (string ou número), data em ISO ou BR.
// Conversão para centavos + Date acontece no service.
export const novaMovimentacaoSchema = z.object({
  tipo: tipoEnum,
  valorCentavos: z.number().int().positive("valor deve ser > 0"),
  dataCaixa: dataDiaSchema,
  dataCompetencia: dataDiaSchema.optional(),
  categoriaId: z.string().min(1, "categoria obrigatória"),
  descricao: z.string().min(1, "descrição obrigatória").max(300),
});
export type NovaMovimentacaoInput = z.infer<typeof novaMovimentacaoSchema>;

export const ajusteSaldoSchema = z.object({
  tipo: tipoEnum,
  valorCentavos: z.number().int().positive(),
  dataCaixa: dataDiaSchema,
  categoriaId: z.string().min(1),
  descricao: z.string().min(1).max(300),
  motivoAjuste: z
    .string()
    .min(3, "motivo do ajuste é obrigatório (mínimo 3 caracteres)")
    .max(500),
});
export type AjusteSaldoInput = z.infer<typeof ajusteSaldoSchema>;

export const filtrosMovimentacaoSchema = z.object({
  // "de" vai para o início do dia; "ate" para o fim do dia — ambos em SP —
  // para que filtros de intervalo incluam o dia inteiro escolhido pelo usuário.
  de: dataSchemaBase.transform(inicioDoDiaSP).optional(),
  ate: dataSchemaBase.transform(fimDoDiaSP).optional(),
  tipo: tipoEnum.optional(),
  categoriaId: z.string().optional(),
  origem: z
    .enum([
      OrigemMovimentacao.MANUAL,
      OrigemMovimentacao.CONTA_PAGA,
      OrigemMovimentacao.IMPORTACAO,
      OrigemMovimentacao.AJUSTE,
    ])
    .optional(),
});
// Input: o que chega do caller (rota/UI) — datas podem ser string ou Date.
// Output: o objeto já parseado — datas sempre Date.
export type FiltrosMovimentacaoInput = z.input<typeof filtrosMovimentacaoSchema>;
export type FiltrosMovimentacao = z.output<typeof filtrosMovimentacaoSchema>;

// Schema usado pelo importador: cada linha da planilha vira um objeto assim.
// Suporta valor assinado (negativo = saída) OU colunas separadas de entrada/saída,
// resolvidas antes pela UI de mapeamento.
export const linhaImportacaoSchema = z
  .object({
    data: dataDiaSchema,
    descricao: z.string().min(1, "descrição vazia"),
    valorCentavos: z.number().int().refine((v) => v !== 0, "valor zero"),
    categoriaId: z.string().min(1, "categoria obrigatória"),
  })
  .transform((row) => ({
    dataCaixa: row.data,
    descricao: row.descricao,
    categoriaId: row.categoriaId,
    tipo:
      row.valorCentavos > 0
        ? TipoMovimentacao.ENTRADA
        : TipoMovimentacao.SAIDA,
    valorCentavos: Math.abs(row.valorCentavos),
  }));
export type LinhaImportacao = z.infer<typeof linhaImportacaoSchema>;
