import { NextRequest, NextResponse } from "next/server";
import { consumirEstadoOAuth, trocarCodigo } from "@/lib/gmail";
import { requireRole, UsuarioRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Apenas ADMIN sincroniza Gmail. O Google redireciona aqui com o cookie
    // de sessao do admin que iniciou o flow.
    await requireRole(UsuarioRole.ADMIN);
  } catch (e) {
    if (e instanceof Response) {
      const url = new URL("/login?next=/configuracoes", req.url);
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
      new URL(`/configuracoes?gmail_erro=${encodeURIComponent(errorParam)}`, req.url),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/configuracoes?gmail_erro=code_missing", req.url),
    );
  }

  // CSRF: state precisa bater com o gerado em gerarUrlAutorizacao.
  const stateOk = await consumirEstadoOAuth(state);
  if (!stateOk) {
    return NextResponse.redirect(
      new URL("/configuracoes?gmail_erro=state_invalido", req.url),
    );
  }

  try {
    await trocarCodigo(code);
    return NextResponse.redirect(new URL("/configuracoes?gmail_ok=1", req.url));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro desconhecido";
    return NextResponse.redirect(
      new URL(`/configuracoes?gmail_erro=${encodeURIComponent(msg)}`, req.url),
    );
  }
}
