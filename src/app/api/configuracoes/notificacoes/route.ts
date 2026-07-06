import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { requireRole, requireSession, UsuarioRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { configKeyParaEmpresa } from "@/lib/tenant-context";
import { TipoNotificacao } from "@/modules/shared/domain";

export const dynamic = "force-dynamic";

// Escopada por empresa via configKeyParaEmpresa: a primária mantém a chave
// nua (retrocompat — zero mudança p/ mundofs); demais empresas usam
// "notif_preferencias::<empresaId>" e começam no default do sistema.
const CHAVE_BASE = "notif_preferencias";

type Preferencias = Partial<Record<keyof typeof TipoNotificacao, boolean>>;

function defaultPreferencias(): Preferencias {
  const out: Preferencias = {};
  for (const k of Object.keys(TipoNotificacao) as Array<keyof typeof TipoNotificacao>) {
    out[k] = true;
  }
  return out;
}

export const GET = handle(async () => {
  await requireSession();
  const chave = configKeyParaEmpresa(CHAVE_BASE);
  const row = await db.configuracaoSistema.findUnique({ where: { chave } });
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
  await requireRole(UsuarioRole.ADMIN);
  const body = (await req.json()) as { preferencias?: Preferencias };
  const incoming = body?.preferencias ?? {};

  // Filtra apenas chaves válidas
  const safe: Preferencias = {};
  for (const k of Object.keys(TipoNotificacao) as Array<keyof typeof TipoNotificacao>) {
    if (k in incoming) safe[k] = Boolean(incoming[k]);
  }

  const merged: Preferencias = { ...defaultPreferencias(), ...safe };

  const chave = configKeyParaEmpresa(CHAVE_BASE);
  await db.configuracaoSistema.upsert({
    where: { chave },
    create: { chave, valor: JSON.stringify(merged) },
    update: { valor: JSON.stringify(merged) },
  });

  return ok({ ok: true, preferencias: merged });
});
