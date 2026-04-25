import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  nome: z.string().min(2, "Nome muito curto").max(120),
  email: z.string().email("E-mail inválido").max(200),
});

export async function PATCH(req: Request) {
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

  const novoEmail = parsed.data.email.toLowerCase().trim();
  const nome = parsed.data.nome.trim();

  // Se email mudou, verifica unicidade.
  const atual = await db.usuario.findUnique({
    where: { id: session.uid },
    select: { email: true },
  });
  if (!atual) {
    return NextResponse.json({ erro: "USUARIO_NAO_ENCONTRADO" }, { status: 404 });
  }
  if (novoEmail !== atual.email) {
    const conflito = await db.usuario.findUnique({
      where: { email: novoEmail },
      select: { id: true },
    });
    if (conflito && conflito.id !== session.uid) {
      return NextResponse.json(
        { erro: "EMAIL_JA_USADO" },
        { status: 400 },
      );
    }
  }

  const atualizado = await db.usuario.update({
    where: { id: session.uid },
    data: { nome, email: novoEmail },
    select: {
      id: true,
      email: true,
      nome: true,
      role: true,
      avatarUrl: true,
    },
  });

  return NextResponse.json({ usuario: atualizado });
}
