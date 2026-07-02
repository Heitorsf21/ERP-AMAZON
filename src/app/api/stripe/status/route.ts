import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const session = await requireRole(UsuarioRole.ADMIN);
  if (!session.empresaId) {
    return NextResponse.json({ erro: "SEM_EMPRESA" }, { status: 400 });
  }

  const empresa = await db.empresa.findUnique({
    where: { id: session.empresaId },
    select: {
      plano: true,
      cicloAssinatura: true,
      assinaturaStatus: true,
      assinaturaAtualizadaEm: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      stripePriceId: true,
      stripeCurrentPeriodEnd: true,
    },
  });

  return NextResponse.json({ assinatura: empresa });
});
