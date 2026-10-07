// Chaveiro do APARELHO (duas lojas juntas): as contas que este navegador
// provou com senha/2FA. Fica num cookie httpOnly assinado (domínio próprio,
// separado da sessão). O vínculo é do aparelho de quem vinculou — quem entra
// pelo login de uma loja em outro aparelho (ex.: o sócio) não tem o chaveiro e
// vê só aquela loja. Cada conta guarda o sessionVersion do momento: trocar a
// senha ou "encerrar sessões" invalida a entrada. "Sair" apaga o chaveiro.

import {
  assinarComRotulo,
  buildSessionClearCookieOptions,
  buildSessionCookieOptions,
  verificarComRotulo,
} from "@/lib/session";

export const CHAVEIRO_COOKIE = "erp_lojas";
const ROTULO = "chaveiro-lojas";
export const MAX_CONTAS = 10;
export const VALIDADE_CHAVEIRO_SEG = 180 * 24 * 60 * 60;

export type ContaNoChaveiro = { uid: string; v: number };
export type Chaveiro = { contas: ContaNoChaveiro[]; exp: number };

function agoraSeg(): number {
  return Math.floor(Date.now() / 1000);
}

/** Valida forma e prazo do conteúdo (a assinatura já foi conferida). */
export function chaveiroValido(x: unknown, agora = agoraSeg()): Chaveiro | null {
  if (!x || typeof x !== "object") return null;
  const { contas, exp } = x as { contas?: unknown; exp?: unknown };
  if (typeof exp !== "number" || exp <= agora) return null;
  if (!Array.isArray(contas) || contas.length === 0 || contas.length > MAX_CONTAS) return null;
  const ok = contas.every(
    (c) =>
      !!c &&
      typeof (c as ContaNoChaveiro).uid === "string" &&
      (c as ContaNoChaveiro).uid.length > 0 &&
      Number.isInteger((c as ContaNoChaveiro).v),
  );
  if (!ok) return null;
  return {
    contas: (contas as ContaNoChaveiro[]).map(({ uid, v }) => ({ uid, v })),
    exp,
  };
}

/** Acrescenta (ou atualiza a versão de) contas e renova o prazo. */
export function guardarContas(
  atual: Chaveiro | null,
  novas: ContaNoChaveiro[],
  agora = agoraSeg(),
): Chaveiro {
  const contas = [...(atual?.contas ?? [])];
  for (const nova of novas) {
    const i = contas.findIndex((c) => c.uid === nova.uid);
    if (i >= 0) contas[i] = { uid: nova.uid, v: nova.v };
    else contas.push({ uid: nova.uid, v: nova.v });
  }
  return { contas: contas.slice(-MAX_CONTAS), exp: agora + VALIDADE_CHAVEIRO_SEG };
}

/** Tira a conta do aparelho. Sobrando uma só, não há o que trocar: null. */
export function tirarConta(atual: Chaveiro, uid: string): Chaveiro | null {
  const contas = atual.contas.filter((c) => c.uid !== uid);
  return contas.length > 1 ? { ...atual, contas } : null;
}

/**
 * Chaveiro a aproveitar ao vincular mais uma loja: só o do PRÓPRIO dono (a
 * conta da sessão está nele, com a versão atual). Outra pessoa no mesmo
 * aparelho, ou o dono depois de trocar a senha, começa do zero — nunca herda
 * as lojas guardadas antes.
 */
export function baseParaVincular(
  atual: Chaveiro | null,
  uidSessao: string,
  versaoAtual: number,
): Chaveiro | null {
  const minha = atual?.contas.find((c) => c.uid === uidSessao);
  return minha && minha.v === versaoAtual ? atual : null;
}

export function temConta(chaveiro: Chaveiro | null, uid: string): boolean {
  return !!chaveiro?.contas.some((c) => c.uid === uid);
}

export async function assinarChaveiro(chaveiro: Chaveiro): Promise<string> {
  return assinarComRotulo(chaveiro, ROTULO);
}

export async function lerChaveiro(token: string | undefined | null): Promise<Chaveiro | null> {
  return chaveiroValido(await verificarComRotulo(token, ROTULO));
}

export function opcoesCookieChaveiro() {
  return { ...buildSessionCookieOptions(true), maxAge: VALIDADE_CHAVEIRO_SEG };
}

export function opcoesLimparChaveiro() {
  return buildSessionClearCookieOptions();
}

/** Chaveiro do request corrente (rotas Next). Nunca lança. */
export async function chaveiroDoRequest(): Promise<Chaveiro | null> {
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    return await lerChaveiro(jar.get(CHAVEIRO_COOKIE)?.value);
  } catch {
    return null;
  }
}
