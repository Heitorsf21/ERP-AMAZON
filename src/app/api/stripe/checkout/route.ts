import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";
import {
  parseBillingPeriod,
  parseBillingPlanId,
} from "@/modules/billing/plans";
import { criarCheckoutAssinatura, listarPlanosBilling } from "@/modules/billing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireRole(UsuarioRole.ADMIN);
  return NextResponse.json({ planos: listarPlanosBilling() });
});

export const POST = handle(async (req: Request) => {
  const session = await requireRole(UsuarioRole.ADMIN);
  if (!session.empresaId) {
    return NextResponse.json({ erro: "SEM_EMPRESA" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const planId = parseBillingPlanId(body.plano);
  const period = parseBillingPeriod(body.periodo ?? "mensal");

  const url = await criarCheckoutAssinatura({
    empresaId: session.empresaId,
    email: session.email,
    planId,
    period,
  });

  return NextResponse.json({ url });
});
