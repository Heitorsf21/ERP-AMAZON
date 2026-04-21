import { NextRequest } from "next/server";
import { handle, ok, erro } from "@/lib/api";
import { comprasService } from "@/modules/compras/service";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const pedido = await comprasService.buscar(id);
  return ok(pedido);
});

export const PATCH = handle(async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const body = await req.json();
  const pedido = await comprasService.atualizar(id, body);
  return ok(pedido);
});

export const DELETE = handle(async (_req: NextRequest, { params }: Params) => {
  const { id } = await params;
  await comprasService.cancelar(id);
  return ok({ ok: true });
});
