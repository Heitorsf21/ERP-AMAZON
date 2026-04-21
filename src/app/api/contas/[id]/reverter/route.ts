import { NextResponse } from "next/server";
import { contasService } from "@/modules/contas-a-pagar/service";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const conta = await contasService.reverterPagamento(id);
    return NextResponse.json(conta);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "falha ao reverter pagamento";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
