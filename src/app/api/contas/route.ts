import { NextResponse } from "next/server";
import { contasService } from "@/modules/contas-a-pagar/service";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const filtros = Object.fromEntries(searchParams.entries());
    const contas = await contasService.listar(filtros);
    return NextResponse.json(contas);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "falha ao listar contas" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const conta = await contasService.criar(body);
    return NextResponse.json(conta, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "falha ao criar conta";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
