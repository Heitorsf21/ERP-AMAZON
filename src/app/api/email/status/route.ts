import { handle, ok } from "@/lib/api";
import { getStatus, verificarConexao } from "@/lib/gmail";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const base = await getStatus();

  let emailConta: string | undefined;
  if (base.autorizado) {
    const check = await verificarConexao();
    emailConta = check.email;
    if (!check.ok) {
      return ok({ ...base, conectado: false, emailConta: null });
    }
  }

  // Last 10 sync results stored in ConfiguracaoSistema
  const historicoRow = await db.configuracaoSistema.findUnique({
    where: { chave: "gmail_historico_sync" },
  });
  const historico = historicoRow?.valor
    ? (JSON.parse(historicoRow.valor) as unknown[])
    : [];

  return ok({
    ...base,
    conectado: base.autorizado,
    emailConta: emailConta ?? null,
    historico,
  });
});
