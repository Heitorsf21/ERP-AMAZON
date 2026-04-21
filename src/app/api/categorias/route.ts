import type { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { categoriaService } from "@/modules/shared/service";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: NextRequest) => {
  const tipo = req.nextUrl.searchParams.get("tipo") ?? undefined;
  const lista = await categoriaService.listar({ tipo });
  return ok(lista);
});

export const POST = handle(async (req: NextRequest) => {
  const body = await req.json();
  const criada = await categoriaService.criar(body);
  return ok(criada, { status: 201 });
});
