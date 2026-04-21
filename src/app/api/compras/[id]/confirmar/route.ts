import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { comprasService } from "@/modules/compras/service";

type Params = { params: Promise<{ id: string }> };

export const POST = handle(async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  await comprasService.confirmar(id, body);
  return ok({ ok: true });
});
