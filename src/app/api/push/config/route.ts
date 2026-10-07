import { handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { currentEmpresaIdOrDefault } from "@/lib/tenant-context";
import { getVapidConfig } from "@/modules/push/envio";
import { nomeDaLoja } from "@/modules/push/loja";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const session = await requireSession();
  const cfg = getVapidConfig();
  const loja = await nomeDaLoja(session.empresaId ?? currentEmpresaIdOrDefault());
  return ok({ enabled: !!cfg, publicKey: cfg?.publicKey ?? null, loja });
});
