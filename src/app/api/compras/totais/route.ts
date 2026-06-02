import { NextRequest } from "next/server";
import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { resolverPeriodoDeBusca } from "@/lib/periodo";
import { comprasService } from "@/modules/compras/service";

export const dynamic = "force-dynamic";

export const GET = handleAuth([UsuarioRole.OPERADOR], async (req: NextRequest) => {
  const periodo = resolverPeriodoDeBusca(req.nextUrl.searchParams);
  const totais = await comprasService.totais(periodo);
  return ok(totais);
});
