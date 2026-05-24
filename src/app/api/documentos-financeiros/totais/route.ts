import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = handleAuth([UsuarioRole.FINANCEIRO], async () => {
  const [total, boletos, notasFiscais, semConta] = await Promise.all([
    db.documentoFinanceiro.count(),
    db.documentoFinanceiro.count({ where: { tipo: "BOLETO" } }),
    db.documentoFinanceiro.count({ where: { tipo: "NOTA_FISCAL" } }),
    db.documentoFinanceiro.count({
      where: { dossie: { contaPagarId: null } },
    }),
  ]);

  return ok({ total, boletos, notasFiscais, semConta });
});
