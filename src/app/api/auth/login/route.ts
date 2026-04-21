import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieOptions,
  buildSessionExpiry,
  signSession,
} from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email().max(200),
  senha: z.string().min(1).max(200),
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
  const user = await db.usuario.findUnique({ where: { email } });

  const senhaOk = user ? await bcrypt.compare(parsed.data.senha, user.senhaHash) : false;

  if (!user || !user.ativo || !senhaOk) {
    return NextResponse.json(
      { erro: "CREDENCIAIS_INVALIDAS" },
      { status: 401 },
    );
  }

  await db.usuario.update({
    where: { id: user.id },
    data: { ultimoAcesso: new Date() },
  });

  const token = await signSession({
    uid: user.id,
    email: user.email,
    nome: user.nome,
    role: user.role,
    exp: buildSessionExpiry(),
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
  res.cookies.set(SESSION_COOKIE_NAME, token, buildSessionCookieOptions());
  return res;
}
