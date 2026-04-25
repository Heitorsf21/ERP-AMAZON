import { handle, ok } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const [total, boletos, notasFiscais, semConta] = await Promise.all([
    db.documentoFinanceiro.count(),
    db.documentoFinanceiro.count({ where: { tipo: "BOLETO" } }),
    db.documentoFinanceiro.count({ where: { tipo: "NOTA_FISCAL" } }),
    // DocumentoFinanceiro não tem contaPagarId direto: o vínculo está em
    // DossieFinanceiro.contaPagarId. Contamos documentos cujo dossiê ainda
    // não foi vinculado a uma ContaPagar (status PENDENTE).
    db.documentoFinanceiro.count({
      where: { dossie: { contaPagarId: null } },
    }),
  ]);

  return ok({ total, boletos, notasFiscais, semConta });
});
