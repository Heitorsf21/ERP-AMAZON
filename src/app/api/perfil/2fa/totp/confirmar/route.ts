import { erro, handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptConfigValue } from "@/lib/crypto";
import { verificarTotp } from "@/lib/totp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Confirma o enrolamento: valida um código do app autenticador contra o segredo
// pendente. Só então ATIVA o 2FA por TOTP (prova de posse do dispositivo).
export const POST = handle(async (req: Request) => {
  const session = await requireSession();
  const body = (await req.json().catch(() => ({}))) as { codigo?: string };
  const codigo = String(body.codigo ?? "");
  if (!/^\d{6}$/.test(codigo)) return erro(400, "CODIGO_INVALIDO");

  const user = await db.usuario.findUnique({
    where: { id: session.uid },
    select: { totpSecretEnc: true },
  });
  const secret = decryptConfigValue(user?.totpSecretEnc);
  if (!secret || !verificarTotp(codigo, secret)) {
    return erro(401, "CODIGO_INCORRETO");
  }

  await db.usuario.update({
    where: { id: session.uid },
    data: { twoFactorEnabled: true, twoFactorMethod: "TOTP" },
  });
  return ok({ ok: true });
});
