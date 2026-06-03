import { db } from "@/lib/db";
import { erro, handle, ok } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async () => {
  const session = await requireRole(UsuarioRole.ADMIN);
  if (!session.empresaId) return erro(400, "SEM_EMPRESA");

  await db.amazonAccount.updateMany({
    where: { empresaId: session.empresaId },
    data: {
      adsRefreshTokenEnc: null,
      adsAccessTokenEnc: null,
      adsTokenExpiresAt: null,
      adsProfileId: null,
      adsEndpoint: null,
      adsConectadoEm: null,
      adsStatus: "PENDENTE",
    },
  });

  return ok({ ok: true });
});
