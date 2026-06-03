import QRCode from "qrcode";
import { handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { encryptConfigValue } from "@/lib/crypto";
import { gerarSegredoTotp, montarOtpauthUri } from "@/lib/totp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Inicia o enrolamento TOTP: gera um segredo, guarda CIFRADO (ainda NÃO ativa o
// 2FA — só após /confirmar com um código válido) e devolve a URI otpauth + QR.
export const POST = handle(async () => {
  const session = await requireSession();
  const secret = gerarSegredoTotp();
  await db.usuario.update({
    where: { id: session.uid },
    data: { totpSecretEnc: encryptConfigValue(secret) },
  });
  const uri = montarOtpauthUri(secret, session.email ?? "usuario", "Atlas Seller");
  const qrDataUrl = await QRCode.toDataURL(uri);
  // `secret` retornado para entrada manual (quem não puder escanear o QR).
  return ok({ otpauthUri: uri, qrDataUrl, secret });
});
