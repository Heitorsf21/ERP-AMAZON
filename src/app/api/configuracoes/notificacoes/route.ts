import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { TipoNotificacao } from "@/modules/shared/domain";

export const dynamic = "force-dynamic";

const CHAVE = "notif_preferencias";

type Preferencias = Partial<Record<keyof typeof TipoNotificacao, boolean>>;

function defaultPreferencias(): Preferencias {
  const out: Preferencias = {};
  for (const k of Object.keys(TipoNotificacao) as Array<keyof typeof TipoNotificacao>) {
    out[k] = true;
  }
  return out;
}

export const GET = handle(async () => {
  const row = await db.configuracaoSistema.findUnique({ where: { chave: CHAVE } });
  if (!row) return ok({ preferencias: defaultPreferencias() });

  let parsed: Preferencias = {};
  try {
    parsed = JSON.parse(row.valor) as Preferencias;
  } catch {
    parsed = {};
  }
  // Mescla com default para garantir que tipos novos apareçam ligados por padrão.
  return ok({ preferencias: { ...defaultPreferencias(), ...parsed } });
});

export const POST = handle(async (req: NextRequest) => {
  const body = (await req.json()) as { preferencias?: Preferencias };
  const incoming = body?.preferencias ?? {};

  // Filtra apenas chaves válidas
  const safe: Preferencias = {};
  for (const k of Object.keys(TipoNotificacao) as Array<keyof typeof TipoNotificacao>) {
    if (k in incoming) safe[k] = Boolean(incoming[k]);
  }

  const merged: Preferencias = { ...defaultPreferencias(), ...safe };

  await db.configuracaoSistema.upsert({
    where: { chave: CHAVE },
    create: { chave: CHAVE, valor: JSON.stringify(merged) },
    update: { valor: JSON.stringify(merged) },
  });

  return ok({ ok: true, preferencias: merged });
});
