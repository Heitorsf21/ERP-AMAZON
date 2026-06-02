import { NextRequest } from "next/server";
import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { resolverPeriodoDeBusca } from "@/lib/periodo";
import { comprasService } from "@/modules/compras/service";

export const dynamic = "force-dynamic";

export const GET = handleAuth(
  [UsuarioRole.OPERADOR],
  async (req: NextRequest) => {
    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status") ?? undefined;
    const fornecedorId = searchParams.get("fornecedor") ?? undefined;
    const temPeriodo =
      searchParams.has("preset") ||
      (searchParams.has("de") && searchParams.has("ate"));
    const periodo = temPeriodo ? resolverPeriodoDeBusca(searchParams) : undefined;
    const dados = await comprasService.listar({
      status,
      fornecedorId,
      de: periodo?.de,
      ate: periodo?.ate,
    });
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
