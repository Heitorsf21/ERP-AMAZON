import { NextResponse } from "next/server";
import { sincronizarGestorSeller } from "@/lib/gestor-seller-sync";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  try {
    const resultado = await sincronizarGestorSeller();
    return NextResponse.json(resultado);
  } catch (err) {
    console.error("[estoque/sincronizar-gestor-seller]", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
