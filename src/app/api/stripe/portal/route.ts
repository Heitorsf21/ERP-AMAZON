import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { criarPortalAssinatura } from "@/modules/billing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async () => {
  const session = await requireRole(UsuarioRole.ADMIN);
  if (!session.empresaId) {
    return NextResponse.json({ erro: "SEM_EMPRESA" }, { status: 400 });
  }

  const url = await criarPortalAssinatura(session.empresaId);
  return NextResponse.json({ url });
});
