import type { NextRequest } from "next/server";
import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { financeiroService } from "@/modules/financeiro/service";

export const dynamic = "force-dynamic";

function extrairFiltros(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  return {
    de: sp.get("de") ?? undefined,
    ate: sp.get("ate") ?? undefined,
    tipo: sp.get("tipo") ?? undefined,
    categoriaId: sp.get("categoriaId") ?? undefined,
    origem: sp.get("origem") ?? undefined,
  };
}

export const GET = handleAuth(
  [UsuarioRole.FINANCEIRO],
  async (req: NextRequest) => {
    const filtros = extrairFiltros(req);
    const lista = await financeiroService.listar(filtros);
    return ok(lista);
  },
);

export const POST = handleAuth(
  [UsuarioRole.FINANCEIRO],
  async (req: NextRequest) => {
    const body = await req.json();
    const criada =
      body?.origem === "AJUSTE"
        ? await financeiroService.registrarAjuste(body)
        : await financeiroService.registrarMovimentacao(body);
    return ok(criada, { status: 201 });
  },
);
