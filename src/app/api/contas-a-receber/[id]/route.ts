import { NextResponse } from "next/server";
import { contasReceberService } from "@/modules/contas-a-receber/service";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    await contasReceberService.deletar(id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "falha ao remover conta a receber";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
