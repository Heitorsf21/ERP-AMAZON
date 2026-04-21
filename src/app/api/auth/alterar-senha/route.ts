import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  senhaAtual: z.string().min(1).max(200),
  senhaNova: z
    .string()
    .min(8, "Senha nova deve ter ao menos 8 caracteres")
    .max(200),
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

  const senhaHash = await bcrypt.hash(parsed.data.senhaNova, 10);
  await db.usuario.update({
    where: { id: user.id },
    data: { senhaHash },
  });

  return NextResponse.json({ ok: true });
}
