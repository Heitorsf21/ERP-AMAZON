import { NextResponse } from "next/server";
import { contasReceberService } from "@/modules/contas-a-receber/service";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const conta = await contasReceberService.marcarRecebida(id);
    return NextResponse.json(conta);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "falha ao marcar como recebida";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
