import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ erro: "NAO_AUTENTICADO" }, { status: 401 });
  }

  const user = await db.usuario.findUnique({
    where: { id: session.uid },
    select: {
      id: true,
      email: true,
      nome: true,
      role: true,
      avatarUrl: true,
      ativo: true,
      ultimoAcesso: true,
      createdAt: true,
    },
  });

  if (!user || !user.ativo) {
    return NextResponse.json({ erro: "NAO_AUTENTICADO" }, { status: 401 });
  }

  return NextResponse.json({ usuario: user });
}
