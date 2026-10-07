import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { originViolationResponse } from "@/lib/origin-check";
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieOptions,
  buildSessionExpiry,
  signSession,
} from "@/lib/session";
import { TipoAuditLog } from "@/modules/shared/domain";
import { conferirDesafio2FA, FINALIDADE_LOGIN } from "@/modules/auth/desafio-2fa";

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

  const { challengeId, codigo } = parsed.data;
  const lembrar = parsed.data.lembrar === true;

  const resultado = await conferirDesafio2FA({
    challengeId,
    codigo,
    finalidade: FINALIDADE_LOGIN,
    req,
  });
  if (!resultado.ok) {
    return NextResponse.json({ erro: resultado.erro }, { status: 401 });
  }
  const usuario = resultado.usuario;

  await db.usuario.update({
    where: { id: usuario.id },
    data: { ultimoAcesso: new Date() },
  });

  const token = await signSession({
    uid: usuario.id,
    email: usuario.email,
    nome: usuario.nome,
    role: usuario.role,
    exp: buildSessionExpiry(lembrar),
    v: usuario.sessionVersion,
    empresaId: usuario.empresaId ?? undefined,
  });

  await auditLog({
    session: { uid: usuario.id, email: usuario.email },
    req,
    acao: TipoAuditLog.LOGIN_SUCESSO,
    entidade: "Usuario",
    entidadeId: usuario.id,
    metadata: { etapa: "2FA" },
  });

  const res = NextResponse.json({
    usuario: {
      id: usuario.id,
      email: usuario.email,
      nome: usuario.nome,
      role: usuario.role,
      avatarUrl: usuario.avatarUrl,
    },
  });
  res.cookies.set(SESSION_COOKIE_NAME, token, buildSessionCookieOptions(lembrar));
  return res;
}
