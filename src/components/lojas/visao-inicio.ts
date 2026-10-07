"use client";

import * as React from "react";

// Visão do Início: só a loja aberta ("loja") ou as lojas vinculadas somadas
// ("todas"). Preferência deste aparelho — fica no localStorage e é lida pela
// topbar (seletor) e pelo Início (abas) ao mesmo tempo.

export type VisaoInicio = "todas" | "loja";

const CHAVE = "atlas:visao-inicio";

type Leitor = { getItem(chave: string): string | null };
type Gravador = { setItem(chave: string, valor: string): void };

export function lerVisao(storage: Leitor | null): VisaoInicio {
  try {
    return storage?.getItem(CHAVE) === "todas" ? "todas" : "loja";
  } catch {
    return "loja";
  }
}

export function gravarVisao(storage: Gravador | null, visao: VisaoInicio): void {
  try {
    storage?.setItem(CHAVE, visao);
  } catch {
    // Aba anônima / armazenamento bloqueado: vale só até recarregar.
  }
}

function armazenamento(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const ouvintes = new Set<() => void>();
let emMemoria: VisaoInicio | null = null;

function atual(): VisaoInicio {
  return emMemoria ?? lerVisao(armazenamento());
}

export function definirVisaoInicio(visao: VisaoInicio): void {
  emMemoria = visao;
  gravarVisao(armazenamento(), visao);
  for (const ouvir of ouvintes) ouvir();
}

function assinar(ouvir: () => void): () => void {
  ouvintes.add(ouvir);
  return () => ouvintes.delete(ouvir);
}

/** [visão, definir]. No servidor e na 1ª pintura é "loja" (sem flash de soma). */
export function useVisaoInicio(): [VisaoInicio, (visao: VisaoInicio) => void] {
  const visao = React.useSyncExternalStore(assinar, atual, () => "loja" as const);
  return [visao, definirVisaoInicio];
}
