// Lojas da conta NESTE APARELHO (duas lojas juntas).
//
// O vínculo é do aparelho de quem vinculou: o chaveiro (cookie assinado, ver
// chaveiro.ts) guarda as contas que este navegador provou com senha/2FA. Sem o
// chaveiro — outro aparelho, outra pessoa com o mesmo login, depois de "Sair" —
// a conta vê só a própria loja. Usuario é GLOBAL: o escopo sai da sessão e do
// chaveiro assinado, nunca do cliente.

import { db } from "@/lib/db";
import { temConta, type Chaveiro, type ContaNoChaveiro } from "./chaveiro";
import { contaValidaNoChaveiro, ordenarLojas } from "./regras";

export type Loja = { empresaId: string; nome: string; email: string; papel: string };
/** `vinculoId` = id da conta da outra loja (chave para desvincular neste aparelho). */
export type LojaVinculada = Loja & { vinculoId: string };

export class ErroVinculo extends Error {
  constructor(public readonly codigo: "MESMA_LOJA" | "CONTA_INVALIDA") {
    super(codigo);
    this.name = "ErroVinculo";
  }
}

const SELECT_CONTA = {
  id: true,
  email: true,
  nome: true,
  role: true,
  ativo: true,
  sessionVersion: true,
  empresaId: true,
  avatarUrl: true,
  empresa: { select: { nome: true, ativa: true } },
} as const;

type ContaComLoja = {
  id: string;
  email: string;
  nome: string;
  role: string;
  ativo: boolean;
  sessionVersion: number;
  empresaId: string;
  avatarUrl?: string | null;
  empresa: { nome: string; ativa: boolean };
};

function paraLoja(c: ContaComLoja): Loja {
  return { empresaId: c.empresaId, nome: c.empresa.nome, email: c.email, papel: c.role };
}

async function carregarConta(id: string): Promise<ContaComLoja | null> {
  return db.usuario.findUnique({ where: { id }, select: SELECT_CONTA });
}

function versaoNoChaveiro(chaveiro: Chaveiro, uid: string): number | undefined {
  return chaveiro.contas.find((c) => c.uid === uid)?.v;
}

/**
 * Contas das OUTRAS lojas que este aparelho pode abrir a partir de `eu`: a
 * própria conta precisa estar no chaveiro (e valer), e cada outra também
 * (ativa, loja ativa, mesma versão). Uma conta por loja (a primeira guardada).
 */
async function outrasContasDoAparelho(
  eu: ContaComLoja,
  chaveiro: Chaveiro | null,
): Promise<ContaComLoja[]> {
  if (!chaveiro || !temConta(chaveiro, eu.id)) return [];
  if (!contaValidaNoChaveiro(paraValidacao(eu), versaoNoChaveiro(chaveiro, eu.id))) return [];

  const ids = chaveiro.contas.map((c) => c.uid).filter((uid) => uid !== eu.id);
  if (ids.length === 0) return [];
  const contas = await db.usuario.findMany({ where: { id: { in: ids } }, select: SELECT_CONTA });
  const porId = new Map(contas.map((c) => [c.id, c]));

  const porEmpresa = new Map<string, ContaComLoja>();
  for (const uid of ids) {
    const c = porId.get(uid);
    if (!c || c.empresaId === eu.empresaId || porEmpresa.has(c.empresaId)) continue;
    if (!contaValidaNoChaveiro(paraValidacao(c), versaoNoChaveiro(chaveiro, uid))) continue;
    porEmpresa.set(c.empresaId, c);
  }
  return [...porEmpresa.values()];
}

function paraValidacao(c: ContaComLoja) {
  return { ativo: c.ativo, sessionVersion: c.sessionVersion, empresaAtiva: c.empresa.ativa };
}

/** A loja aberta e as lojas que ESTE aparelho abre sem senha, por nome. */
export async function listarLojas(
  usuarioId: string,
  chaveiro: Chaveiro | null,
): Promise<{ atual: Loja; vinculadas: LojaVinculada[] } | null> {
  const eu = await carregarConta(usuarioId);
  if (!eu || !eu.ativo) return null;
  const vinculadas = (await outrasContasDoAparelho(eu, chaveiro)).map((c) => ({
    ...paraLoja(c),
    vinculoId: c.id,
  }));
  return { atual: paraLoja(eu), vinculadas: ordenarLojas(vinculadas) };
}

/** A conta da loja `empresaId` que este aparelho abre sem senha (para trocar). */
export async function contaVinculadaNaEmpresa(
  usuarioId: string,
  empresaId: string,
  chaveiro: Chaveiro | null,
): Promise<ContaComLoja | null> {
  const eu = await carregarConta(usuarioId);
  if (!eu || !eu.ativo || eu.empresaId === empresaId) return null;
  return (await outrasContasDoAparelho(eu, chaveiro)).find((c) => c.empresaId === empresaId) ?? null;
}

/**
 * Depois de provada a senha/2FA da outra conta: as duas contas (com a versão
 * atual) que vão para o chaveiro deste aparelho, e a loja vinculada.
 */
export async function prepararVinculo(
  solicitanteId: string,
  alvoId: string,
): Promise<{ contas: ContaNoChaveiro[]; loja: LojaVinculada }> {
  const [solicitante, alvo] = await Promise.all([carregarConta(solicitanteId), carregarConta(alvoId)]);
  if (!solicitante || !alvo || !solicitante.ativo || !alvo.ativo) {
    throw new ErroVinculo("CONTA_INVALIDA");
  }
  if (solicitante.id === alvo.id || solicitante.empresaId === alvo.empresaId) {
    throw new ErroVinculo("MESMA_LOJA");
  }
  return {
    contas: [
      { uid: solicitante.id, v: solicitante.sessionVersion },
      { uid: alvo.id, v: alvo.sessionVersion },
    ],
    loja: { ...paraLoja(alvo), vinculoId: alvo.id },
  };
}
