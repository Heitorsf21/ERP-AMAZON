import { handle, ok, erro } from "@/lib/api";
import { buscarEmailsComAnexos, marcarProcessado } from "@/lib/gmail";
import { processarAnexo } from "@/lib/email-processor";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as { diasAtras?: number };
  const diasAtras = body.diasAtras ?? 14;

  let emailsEncontrados = 0;
  const resultados: unknown[] = [];
  const erros: string[] = [];

  try {
    const anexos = await buscarEmailsComAnexos(diasAtras);
    emailsEncontrados = anexos.length;

    // Track unique messageIds to mark processed after all attachments in email are done
    const mensagensProcessadas = new Set<string>();

    for (const anexo of anexos) {
      try {
        const resultado = await processarAnexo(anexo);
        resultados.push({
          arquivo: resultado.arquivo,
          tipo: resultado.tipo,
          registros: resultado.registros,
          mensagem: resultado.mensagem ?? null,
          remetente: anexo.remetente,
          data: anexo.dataEmail,
        });
        mensagensProcessadas.add(anexo.messageId);
      } catch (e) {
        erros.push(
          `${anexo.nomeArquivo}: ${e instanceof Error ? e.message : "Erro desconhecido"}`,
        );
      }
    }

    for (const id of mensagensProcessadas) {
      await marcarProcessado(id);
    }

    // Save last sync timestamp and history
    const agora = new Date().toISOString();
    await db.configuracaoSistema.upsert({
      where: { chave: "gmail_ultima_sincronizacao" },
      update: { valor: agora },
      create: { chave: "gmail_ultima_sincronizacao", valor: agora },
    });

    // Append to history (keep last 20)
    const historicoRow = await db.configuracaoSistema.findUnique({
      where: { chave: "gmail_historico_sync" },
    });
    const historico = historicoRow?.valor
      ? (JSON.parse(historicoRow.valor) as unknown[])
      : [];

    historico.push({ data: agora, emailsEncontrados, resultados, erros });
    const historicoTrimmed = historico.slice(-20);

    await db.configuracaoSistema.upsert({
      where: { chave: "gmail_historico_sync" },
      update: { valor: JSON.stringify(historicoTrimmed) },
      create: { chave: "gmail_historico_sync", valor: JSON.stringify(historicoTrimmed) },
    });
  } catch (e) {
    return erro(500, e instanceof Error ? e.message : "Erro ao sincronizar");
  }

  return ok({ ok: true, emailsEncontrados, resultados, erros });
});
