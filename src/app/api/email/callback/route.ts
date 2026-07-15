import { NextRequest, NextResponse } from "next/server";
import { consumirEstadoOAuth, trocarCodigo } from "@/lib/gmail";
import { assertEmpresaPrimaria, requireRole, UsuarioRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Redirect pós-OAuth pelo host público (APP_URL); atrás do Nginx req.url é localhost:3000.
  const appBase = process.env.APP_URL || new URL(req.url).origin;
  try {
    // Apenas ADMIN da empresa PRIMARIA sincroniza Gmail (integracao global).
    // O Google redireciona aqui com o cookie de sessao do admin que iniciou o flow.
    const session = await requireRole(UsuarioRole.ADMIN);
    assertEmpresaPrimaria(session);
  } catch (e) {
    if (e instanceof Response) {
      const url = new URL("/login?next=/configuracoes", appBase);
      return NextResponse.redirect(url);
    }
    throw e;
  }

  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/configuracoes?gmail_erro=${encodeURIComponent(errorParam)}`, appBase),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/configuracoes?gmail_erro=code_missing", appBase),
    );
  }

  // CSRF: state precisa bater com o gerado em gerarUrlAutorizacao.
  const stateOk = await consumirEstadoOAuth(state);
  if (!stateOk) {
    return NextResponse.redirect(
      new URL("/configuracoes?gmail_erro=state_invalido", appBase),
    );
  }

  try {
    await trocarCodigo(code);
    return NextResponse.redirect(new URL("/configuracoes?gmail_ok=1", appBase));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro desconhecido";
    return NextResponse.redirect(
      new URL(`/configuracoes?gmail_erro=${encodeURIComponent(msg)}`, appBase),
    );
  }
}
