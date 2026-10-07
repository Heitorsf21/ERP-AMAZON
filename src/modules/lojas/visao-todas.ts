// Visão "Todas" do Início: em quais lojas rodar e como rodar cada uma no
// próprio tenant. As lojas saem da conta da sessão + chaveiro assinado DESTE
// aparelho (validado no banco) — o cliente só pede `?lojas=todas`. Nunca
// superadmin.

import { requireSession } from "@/lib/auth";
import { runWithTenant } from "@/lib/tenant-context";
import { chaveiroDoRequest } from "./chaveiro";
import type { LojaRef } from "./consolidado";
import { ordenarLojas } from "./regras";
import { listarLojas } from "./vinculos";

export function pedeVisaoTodas(searchParams: URLSearchParams): boolean {
  return searchParams.get("lojas") === "todas";
}

/**
 * Lojas da visão "Todas" (a da sessão + vinculadas válidas, por nome), ou
 * null quando não há o que somar: sem vínculo, ou cookie apontando para uma
 * empresa que não é a da conta (fail-closed — fica só a loja da sessão).
 */
export async function lojasDaVisaoTodas(): Promise<{ lojas: LojaRef[]; atualEmpresaId: string } | null> {
  const session = await requireSession();
  if (!session.empresaId) return null;
  const minhas = await listarLojas(session.uid, await chaveiroDoRequest());
  if (!minhas || minhas.vinculadas.length === 0) return null;
  if (minhas.atual.empresaId !== session.empresaId) return null;
  const lojas = ordenarLojas(
    [minhas.atual, ...minhas.vinculadas].map(({ empresaId, nome }) => ({ empresaId, nome })),
  );
  return { lojas, atualEmpresaId: session.empresaId };
}

/** Roda `fn` no tenant da loja (escopo de empresa explícito, sem superadmin). */
export function naLoja<T>(empresaId: string, fn: () => Promise<T>): Promise<T> {
  return runWithTenant({ empresaId, isSuperAdmin: false, source: "web" }, fn);
}
