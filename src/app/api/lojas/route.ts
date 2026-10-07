import { handle, ok, erro } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { chaveiroDoRequest } from "@/modules/lojas/chaveiro";
import { listarLojas } from "@/modules/lojas/vinculos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A loja aberta e as lojas que ESTE aparelho abre sem senha (chaveiro do cookie). */
export const GET = handle(async () => {
  const session = await requireSession();
  const lojas = await listarLojas(session.uid, await chaveiroDoRequest());
  if (!lojas) return erro(401, "NAO_AUTENTICADO");
  return ok(lojas);
});
