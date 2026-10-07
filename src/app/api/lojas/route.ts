import { handle, ok, erro } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { listarLojas } from "@/modules/lojas/vinculos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A loja aberta e as lojas vinculadas à conta da sessão (duas lojas juntas). */
export const GET = handle(async () => {
  const session = await requireSession();
  const lojas = await listarLojas(session.uid);
  if (!lojas) return erro(401, "NAO_AUTENTICADO");
  return ok(lojas);
});
