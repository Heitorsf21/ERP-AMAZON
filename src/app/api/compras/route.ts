import { NextRequest } from "next/server";
import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { comprasService } from "@/modules/compras/service";

export const dynamic = "force-dynamic";

export const GET = handleAuth(
  [UsuarioRole.OPERADOR],
  async (req: NextRequest) => {
    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status") ?? undefined;
    const dados = await comprasService.listar({ status });
    return ok(dados);
  },
);

export const POST = handleAuth(
  [UsuarioRole.OPERADOR],
  async (req: NextRequest) => {
    const body = await req.json();
    const pedido = await comprasService.criar(body);
    return ok(pedido, { status: 201 });
  },
);
