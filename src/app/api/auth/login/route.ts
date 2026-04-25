import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieOptions,
  buildSessionExpiry,
  signSession,
} from "@/lib/session";
import { enviarEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email().max(200),
  senha: z.string().min(1).max(200),
  lembrar: z.boolean().optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: "JSON_INVALIDO" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "DADOS_INVALIDOS" }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const lembrar = parsed.data.lembrar === true;
  const user = await db.usuario.findUnique({ where: { email } });

  const senhaOk = user
    ? await bcrypt.compare(parsed.data.senha, user.senhaHash)
    : false;

  if (!user || !user.ativo || !senhaOk) {
    return NextResponse.json(
      { erro: "CREDENCIAIS_INVALIDAS" },
      { status: 401 },
    );
  }

  // Se 2FA habilitado, gera challenge e envia código por email — NÃO cria sessão.
  if (user.twoFactorEnabled && user.twoFactorMethod === "EMAIL") {
    const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const codigoHash = await bcrypt.hash(codigo, 8);
    const challengeId = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 5 * 60_000); // 5 minutos

    await db.codigoVerificacao2FA.create({
      data: {
        usuarioId: user.id,
        codigoHash,
        challengeId,
        expiresAt,
      },
    });

    await enviarEmail({
      to: user.email,
      subject: "Código de verificação — ERP Mundo F&S",
      html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #0b1220;">Código de verificação</h2>
          <p>Olá ${user.nome},</p>
          <p>Seu código de acesso ao ERP é:</p>
          <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; background: #f3f4f6; padding: 16px; text-align: center; border-radius: 8px;">${codigo}</p>
          <p style="color: #6b7280; font-size: 13px;">Este código expira em 5 minutos. Se você não tentou entrar, ignore este email.</p>
        </div>
      `,
    });

    return NextResponse.json({
      requires2FA: true,
      challengeId,
      lembrar,
    });
  }

  // Sem 2FA: cria sessão direto.
  await db.usuario.update({
    where: { id: user.id },
    data: { ultimoAcesso: new Date() },
  });

  const token = await signSession({
    uid: user.id,
    email: user.email,
    nome: user.nome,
    role: user.role,
    exp: buildSessionExpiry(lembrar),
  });

  const res = NextResponse.json({
    usuario: {
      id: user.id,
      email: user.email,
      nome: user.nome,
      role: user.role,
      avatarUrl: user.avatarUrl,
    },
  });
  res.cookies.set(SESSION_COOKIE_NAME, token, buildSessionCookieOptions(lembrar));
  return res;
}
