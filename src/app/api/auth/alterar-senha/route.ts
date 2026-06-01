import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { bumpSessionVersion, getSession } from "@/lib/auth";
import { strongPasswordSchema } from "@/lib/password-policy";
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieOptions,
  buildSessionExpiry,
  signSession,
} from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  senhaAtual: z.string().min(1).max(200),
  senhaNova: strongPasswordSchema,
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ erro: "NAO_AUTENTICADO" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: "JSON_INVALIDO" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { erro: parsed.error.issues[0]?.message ?? "DADOS_INVALIDOS" },
      { status: 400 },
    );
  }

  const user = await db.usuario.findUnique({ where: { id: session.uid } });
  if (!user || !user.ativo) {
    return NextResponse.json({ erro: "NAO_AUTENTICADO" }, { status: 401 });
  }

  const ok = await bcrypt.compare(parsed.data.senhaAtual, user.senhaHash);
  if (!ok) {
    return NextResponse.json({ erro: "SENHA_ATUAL_INCORRETA" }, { status: 400 });
  }

  const senhaHash = await bcrypt.hash(parsed.data.senhaNova, 12);
  await db.usuario.update({
    where: { id: user.id },
    data: { senhaHash },
  });

  // Invalida sessoes em outros devices (incrementa sessionVersion). Reemite
  // o cookie do device atual com o novo `v` para o usuario nao ser deslogado.
  const novoV = await bumpSessionVersion(user.id);

  const res = NextResponse.json({ ok: true });
  const token = await signSession({
    uid: user.id,
    email: user.email,
    nome: user.nome,
    role: user.role,
    exp: buildSessionExpiry(false),
    v: novoV,
    // Preserva o empresaId — senao, sob TENANT_ISOLATION=enforce, o getSession
    // invalida o cookie reemitido (sem empresaId) e desloga o usuario.
    empresaId: session.empresaId,
  });
  res.cookies.set(SESSION_COOKIE_NAME, token, buildSessionCookieOptions(false));
  return res;
}
