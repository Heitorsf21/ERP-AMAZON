import { erro, handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { currentEmpresaIdOrDefault } from "@/lib/tenant-context";
import { enviarPush, TipoPushEnvio } from "@/modules/push/envio";
import { nomeDaLoja } from "@/modules/push/loja";
import { montarPayloadTeste } from "@/modules/push/regras";

export const dynamic = "force-dynamic";

const INTERVALO_MS = 30_000;
const ultimoTeste = new Map<string, number>();

export const POST = handle(async () => {
  const session = await requireSession();
  const agora = Date.now();
  if (agora - (ultimoTeste.get(session.uid) ?? 0) < INTERVALO_MS) {
    return erro(429, "Aguarde alguns segundos para enviar outro teste.");
  }
  ultimoTeste.set(session.uid, agora);
  const empresaId = session.empresaId ?? currentEmpresaIdOrDefault();
  const r = await enviarPush({
    empresaId,
    tipo: TipoPushEnvio.TESTE,
    dedupeKey: null,
    payload: montarPayloadTeste(await nomeDaLoja(empresaId)),
    usuarioId: session.uid,
  });
  return ok({ enviados: r.ok, destinos: r.destinos });
});
