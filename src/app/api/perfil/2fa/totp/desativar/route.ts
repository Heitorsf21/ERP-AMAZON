import { handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Desativa o 2FA TOTP do usuário logado (sessão já autenticada). Zera o segredo.
export const POST = handle(async () => {
  const session = await requireSession();
  await db.usuario.update({
    where: { id: session.uid },
    data: { twoFactorEnabled: false, twoFactorMethod: null, totpSecretEnc: null },
  });
  return ok({ ok: true });
});
