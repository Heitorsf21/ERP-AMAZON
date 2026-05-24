import { NextRequest } from "next/server";
import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { comprasService } from "@/modules/compras/service";

type Params = { params: Promise<{ id: string }> };

export const POST = handleAuth(
  [UsuarioRole.OPERADOR],
  async (req: NextRequest, { params }: Params) => {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    await comprasService.confirmar(id, body);
    return ok({ ok: true });
  },
);
