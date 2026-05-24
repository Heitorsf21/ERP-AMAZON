import { NextResponse } from "next/server";
import { sincronizarGestorSeller } from "@/lib/gestor-seller-sync";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  try {
    // Operacao privilegiada (dispara script externo). Apenas ADMIN.
    await requireRole(UsuarioRole.ADMIN);
    const resultado = await sincronizarGestorSeller();
    return NextResponse.json(resultado);
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    logger.error({ err }, "[estoque/sincronizar-gestor-seller] falha");
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
