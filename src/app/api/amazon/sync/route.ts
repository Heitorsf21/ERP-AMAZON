import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import {
  processEligibleReviewSolicitations,
  syncInventory,
  syncOrders,
  testConnection,
} from "@/modules/amazon/service";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({})) as { tipo?: string; diasAtras?: number };
  const tipo = body.tipo ?? "ALL";

  if (tipo === "TEST") {
    const result = await testConnection();
    return ok(result);
  }

  if (tipo === "ORDERS" || tipo === "ALL") {
    const diasAtras = body.diasAtras ?? 30;
    const result = await syncOrders(diasAtras);
    if (tipo === "ORDERS") return ok(result);
  }

  if (tipo === "INVENTORY" || tipo === "ALL") {
    const result = await syncInventory();
    return ok(result);
  }

  if (tipo === "REVIEWS") {
    const diasAtras = body.diasAtras ?? 30;
    const result = await processEligibleReviewSolicitations(diasAtras);
    return ok(result);
  }

  return ok({ ok: true });
});
