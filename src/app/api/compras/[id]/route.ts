import { NextRequest } from "next/server";
import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { comprasService } from "@/modules/compras/service";

type Params = { params: Promise<{ id: string }> };

export const GET = handleAuth(
  [UsuarioRole.OPERADOR],
  async (_req: NextRequest, { params }: Params) => {
    const { id } = await params;
    const pedido = await comprasService.buscar(id);
    return ok(pedido);
  },
);

export const PATCH = handleAuth(
  [UsuarioRole.OPERADOR],
  async (req: NextRequest, { params }: Params) => {
    const { id } = await params;
    const body = await req.json();
    const pedido = await comprasService.atualizar(id, body);
    return ok(pedido);
  },
);

export const DELETE = handleAuth(
  [UsuarioRole.OPERADOR],
  async (_req: NextRequest, { params }: Params) => {
    const { id } = await params;
    await comprasService.cancelar(id);
    return ok({ ok: true });
  },
);
