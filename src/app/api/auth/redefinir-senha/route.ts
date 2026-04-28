import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { strongPasswordSchema } from "@/lib/password-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().min(32).max(128),
  novaSenha: strongPasswordSchema,
});

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export async function POST(req: Request) {
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

  const tokenHash = sha256(parsed.data.token);
  const reg = await db.tokenRecuperacaoSenha.findUnique({
    where: { tokenHash },
  });

  if (!reg || reg.usadoEm || reg.expiresAt < new Date()) {
    return NextResponse.json(
      { erro: "TOKEN_INVALIDO_OU_EXPIRADO" },
      { status: 401 },
    );
  }

  const senhaHash = await bcrypt.hash(parsed.data.novaSenha, 12);

  await db.$transaction([
    db.usuario.update({
      where: { id: reg.usuarioId },
      data: { senhaHash },
    }),
    db.tokenRecuperacaoSenha.update({
      where: { id: reg.id },
      data: { usadoEm: new Date() },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
