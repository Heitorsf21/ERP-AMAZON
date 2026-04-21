import { NextResponse } from "next/server";
import { contasRepository } from "@/modules/contas-a-pagar/repository";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const busca = searchParams.get("busca") ?? undefined;
    const fornecedores = await contasRepository.listarFornecedores(busca);
    return NextResponse.json(fornecedores);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "falha ao listar fornecedores" }, { status: 500 });
  }
}
