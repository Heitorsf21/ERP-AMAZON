import { NextResponse } from "next/server";
import { contasRepository } from "@/modules/contas-a-pagar/repository";
import { requireSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(req.url);
    const busca = searchParams.get("busca") ?? undefined;
    const fornecedores = await contasRepository.listarFornecedores(busca);
    return NextResponse.json(fornecedores);
  } catch (e) {
    if (e instanceof Response) return e;
    logger.error({ err: e }, "[fornecedores] falha");
    return NextResponse.json({ error: "falha ao listar fornecedores" }, { status: 500 });
  }
}
