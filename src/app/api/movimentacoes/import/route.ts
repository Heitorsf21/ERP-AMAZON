import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/api";
import { financeiroService } from "@/modules/financeiro/service";
import { linhaImportacaoSchema } from "@/modules/financeiro/schemas";
import { FormatoImportacao } from "@/modules/shared/domain";

// O cliente envia um array de linhas já mapeadas (descobertas na UI de
// preview/mapeamento). Aqui revalidamos linha-a-linha antes de gravar.
const payloadSchema = z.object({
  nomeArquivo: z.string().min(1, "nome do arquivo obrigatório").max(255),
  formato: z.enum([FormatoImportacao.GENERICO, FormatoImportacao.NUBANK]),
  linhas: z.array(linhaImportacaoSchema).min(1, "nenhuma linha para importar"),
});

export const POST = handle(async (req: NextRequest) => {
  const body = await req.json();
  const { nomeArquivo, formato, linhas } = payloadSchema.parse(body);
  const resultado = await financeiroService.importarLote(linhas, {
    nomeArquivo,
    formato,
  });
  return ok(resultado, { status: 201 });
});
