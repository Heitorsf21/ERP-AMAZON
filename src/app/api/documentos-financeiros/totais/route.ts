import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = handleAuth([UsuarioRole.FINANCEIRO], async () => {
  const [total, boletos, notasFiscais, semConta] = await Promise.all([
    db.documentoFinanceiro.count({ where: { deletedAt: null } }),
    db.documentoFinanceiro.count({ where: { tipo: "BOLETO", deletedAt: null } }),
    db.documentoFinanceiro.count({
      where: { tipo: "NOTA_FISCAL", deletedAt: null },
    }),
    db.documentoFinanceiro.count({
      where: { dossie: { contaPagarId: null }, deletedAt: null },
    }),
  ]);

  return ok({ total, boletos, notasFiscais, semConta });
});
