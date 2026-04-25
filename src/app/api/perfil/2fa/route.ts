import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  enabled: z.boolean(),
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
    return NextResponse.json({ erro: "DADOS_INVALIDOS" }, { status: 400 });
  }

  await db.usuario.update({
    where: { id: session.uid },
    data: {
      twoFactorEnabled: parsed.data.enabled,
      twoFactorMethod: parsed.data.enabled ? "EMAIL" : null,
    },
  });

  return NextResponse.json({
    ok: true,
    twoFactorEnabled: parsed.data.enabled,
  });
}
