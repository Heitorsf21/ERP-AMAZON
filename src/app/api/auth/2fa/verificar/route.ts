import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieOptions,
  buildSessionExpiry,
  signSession,
} from "@/lib/session";
import { TipoAuditLog } from "@/modules/shared/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  challengeId: z.string().min(8).max(64),
  codigo: z
    .string()
    .regex(/^\d{6}$/, "Código deve ter 6 dígitos"),
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

  const { challengeId, codigo } = parsed.data;
  const lembrar = parsed.data.lembrar === true;

  const challenge = await db.codigoVerificacao2FA.findUnique({
    where: { challengeId },
    include: { usuario: true },
  });

  if (
    !challenge ||
    challenge.usadoEm ||
    challenge.expiresAt < new Date() ||
    !challenge.usuario.ativo
  ) {
    await auditLog({
      req,
      acao: TipoAuditLog.LOGIN_FALHA,
      entidade: "Usuario",
      entidadeId: challenge?.usuarioId ?? null,
      metadata: { etapa: "2FA", motivo: "challenge_invalido" },
    });
    return NextResponse.json(
      { erro: "CODIGO_INVALIDO_OU_EXPIRADO" },
      { status: 401 },
    );
  }

  const codigoOk = await bcrypt.compare(codigo, challenge.codigoHash);
  if (!codigoOk) {
    await auditLog({
      req,
      acao: TipoAuditLog.LOGIN_FALHA,
      entidade: "Usuario",
      entidadeId: challenge.usuarioId,
      metadata: { etapa: "2FA", motivo: "codigo_incorreto" },
    });
    return NextResponse.json({ erro: "CODIGO_INCORRETO" }, { status: 401 });
  }

  await db.$transaction([
    db.codigoVerificacao2FA.update({
      where: { id: challenge.id },
      data: { usadoEm: new Date() },
    }),
    db.usuario.update({
      where: { id: challenge.usuarioId },
      data: { ultimoAcesso: new Date() },
    }),
  ]);

  const token = await signSession({
    uid: challenge.usuario.id,
    email: challenge.usuario.email,
    nome: challenge.usuario.nome,
    role: challenge.usuario.role,
    exp: buildSessionExpiry(lembrar),
  });

  await auditLog({
    session: { uid: challenge.usuario.id, email: challenge.usuario.email },
    req,
    acao: TipoAuditLog.LOGIN_SUCESSO,
    entidade: "Usuario",
    entidadeId: challenge.usuario.id,
    metadata: { etapa: "2FA" },
  });

  const res = NextResponse.json({
    usuario: {
      id: challenge.usuario.id,
      email: challenge.usuario.email,
      nome: challenge.usuario.nome,
      role: challenge.usuario.role,
      avatarUrl: challenge.usuario.avatarUrl,
    },
  });
  res.cookies.set(SESSION_COOKIE_NAME, token, buildSessionCookieOptions(lembrar));
  return res;
}
