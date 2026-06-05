import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieOptions,
  buildSessionExpiry,
  signSession,
} from "@/lib/session";
import { enviarEmail, escapeHtml } from "@/lib/email";
import {
  recordLoginFailureByKey,
  resetLoginFailuresByKey,
  getLoginFailureKey,
} from "@/lib/auth-rate-limit";
import { originViolationResponse } from "@/lib/origin-check";
import { TipoAuditLog } from "@/modules/shared/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email().max(200),
  senha: z.string().min(1).max(200),
  lembrar: z.boolean().optional(),
});

// Hash bcrypt REAL para o dummy compare (uniformiza tempo quando empresa/usuario
// nao existem). Gerado no load do modulo: garante hash valido => bcrypt.compare
// faz o trabalho real (um hash malformado seria rejeitado rapido, anulando a defesa).
const DUMMY_HASH = bcrypt.hashSync("atlas-seller-dummy-password", 10);

export async function POST(req: Request) {
  const origemBloqueada = originViolationResponse(req);
  if (origemBloqueada) return origemBloqueada;

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

  // email e unico GLOBAL (1 email = 1 empresa). Usuario e GLOBAL_MODEL, entao a
  // extensao de tenant nao auto-filtra esta query (login roda pre-contexto).
  const user = await db.usuario.findUnique({
    where: { email },
    include: { empresa: { select: { ativa: true } } },
  });

  // Dummy bcrypt SEMPRE quando nao ha user: tempo uniforme (anti-enumeracao).
  let senhaOk = false;
  if (user) {
    senhaOk = await bcrypt.compare(parsed.data.senha, user.senhaHash);
  } else {
    await bcrypt.compare(parsed.data.senha, DUMMY_HASH); // descarta resultado, so p/ uniformizar tempo
  }

  const empresaInativa = user != null && user.empresa.ativa === false;

  if (!user || !user.ativo || empresaInativa || !senhaOk) {
    const failureLimit = await recordLoginFailureByKey(
      getLoginFailureKey(req.headers, email),
    );

    await auditLog({
      req,
      acao: TipoAuditLog.LOGIN_FALHA,
      entidade: "Usuario",
      entidadeId: user?.id ?? null,
      metadata: { email },
    });

    if (failureLimit.limited) {
      return NextResponse.json(
        {
          erro: "MUITAS_TENTATIVAS_LOGIN",
          retryAfterSeconds: failureLimit.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(failureLimit.retryAfterSeconds),
          },
        },
      );
    }

    return NextResponse.json(
      { erro: "CREDENCIAIS_INVALIDAS" },
      { status: 401 },
    );
  }

  await resetLoginFailuresByKey(getLoginFailureKey(req.headers, email));

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
          <p>Olá ${escapeHtml(user.nome)},</p>
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

  // 2FA por TOTP (app autenticador): cria um challenge SEM enviar email. O código
  // vem do app do usuário; o verificador valida contra o segredo cifrado.
  if (user.twoFactorEnabled && user.twoFactorMethod === "TOTP") {
    const challengeId = crypto.randomBytes(16).toString("hex");
    await db.codigoVerificacao2FA.create({
      data: {
        usuarioId: user.id,
        codigoHash: "-", // não usado no TOTP (validação é contra o segredo)
        metodo: "TOTP",
        challengeId,
        expiresAt: new Date(Date.now() + 5 * 60_000),
      },
    });
    return NextResponse.json({
      requires2FA: true,
      challengeId,
      lembrar,
      metodo: "TOTP",
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
    v: user.sessionVersion,
    empresaId: user.empresaId ?? undefined,
  });

  await auditLog({
    session: { uid: user.id, email: user.email },
    req,
    acao: TipoAuditLog.LOGIN_SUCESSO,
    entidade: "Usuario",
    entidadeId: user.id,
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
