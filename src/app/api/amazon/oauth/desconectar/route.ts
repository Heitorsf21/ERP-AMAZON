import { db } from "@/lib/db";
import { erro, handle, ok } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// T8 (F02): desconecta a conta Amazon da empresa logada. Zera o grant (tokens) e
// volta status para PENDENTE — o worker para de iterar essa conta.
export const POST = handle(async () => {
  const session = await requireRole(UsuarioRole.ADMIN);
  if (!session.empresaId) return erro(400, "SEM_EMPRESA");
  await db.amazonAccount.updateMany({
    where: { empresaId: session.empresaId },
    data: {
      refreshTokenEnc: null,
      accessTokenEnc: null,
      tokenExpiresAt: null,
      status: "PENDENTE",
    },
  });
  return ok({ ok: true });
});
