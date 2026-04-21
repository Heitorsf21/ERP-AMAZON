import { NextRequest, NextResponse } from "next/server";
import { trocarCodigo } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
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
