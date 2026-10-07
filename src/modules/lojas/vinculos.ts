// Vínculo entre contas de lojas diferentes (duas lojas juntas).
//
// VinculoLoja e Usuario são GLOBAIS (não auto-filtrados por tenant): todo o
// escopo daqui sai explicitamente da conta da sessão. Nada vem do cliente.

import { db } from "@/lib/db";
import { ordenarLojas, ordenarPar, vinculoValido, type ContaVinculo } from "./regras";

export type Loja = { empresaId: string; nome: string; email: string; papel: string };
export type LojaVinculada = Loja & { vinculoId: string; vinculadaEm: string };

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

function paraContaVinculo(c: ContaComLoja): ContaVinculo {
  return {
    id: c.id,
    ativo: c.ativo,
    sessionVersion: c.sessionVersion,
    empresaId: c.empresaId,
    empresaAtiva: c.empresa.ativa,
  };
}

function paraLoja(c: ContaComLoja): Loja {
  return { empresaId: c.empresaId, nome: c.empresa.nome, email: c.email, papel: c.role };
}

async function carregarConta(id: string): Promise<ContaComLoja | null> {
  return db.usuario.findUnique({ where: { id }, select: SELECT_CONTA });
}

/**
 * Vínculos VÁLIDOS da conta, já pelo lado oposto (a outra conta), um por
 * empresa (o mais antigo vence) e sem a própria empresa.
 */
async function vinculosValidos(
  eu: ContaComLoja,
): Promise<{ vinculoId: string; criadoEm: Date; outra: ContaComLoja }[]> {
  const vinculos = await db.vinculoLoja.findMany({
    where: { OR: [{ usuarioAId: eu.id }, { usuarioBId: eu.id }] },
    include: { usuarioA: { select: SELECT_CONTA }, usuarioB: { select: SELECT_CONTA } },
    orderBy: { criadoEm: "asc" },
  });
  const porEmpresa = new Map<string, { vinculoId: string; criadoEm: Date; outra: ContaComLoja }>();
  for (const v of vinculos) {
    if (!vinculoValido(v, paraContaVinculo(v.usuarioA), paraContaVinculo(v.usuarioB))) continue;
    const outra = v.usuarioAId === eu.id ? v.usuarioB : v.usuarioA;
    if (outra.empresaId === eu.empresaId || porEmpresa.has(outra.empresaId)) continue;
    porEmpresa.set(outra.empresaId, { vinculoId: v.id, criadoEm: v.criadoEm, outra });
  }
  return [...porEmpresa.values()];
}

/** A loja aberta e as lojas vinculadas (válidas) da conta, ordenadas por nome. */
export async function listarLojas(
  usuarioId: string,
): Promise<{ atual: Loja; vinculadas: LojaVinculada[] } | null> {
  const eu = await carregarConta(usuarioId);
  if (!eu || !eu.ativo) return null;
  const vinculadas = (await vinculosValidos(eu)).map(({ vinculoId, criadoEm, outra }) => ({
    ...paraLoja(outra),
    vinculoId,
    vinculadaEm: criadoEm.toISOString(),
  }));
  return { atual: paraLoja(eu), vinculadas: ordenarLojas(vinculadas) };
}

/**
 * Cria (ou renova) o vínculo entre a conta da sessão e a conta provada por
 * senha/2FA. Renovar atualiza as versões — volta a valer depois de uma troca
 * de senha.
 */
export async function criarVinculo(solicitanteId: string, alvoId: string): Promise<LojaVinculada> {
  const [solicitante, alvo] = await Promise.all([carregarConta(solicitanteId), carregarConta(alvoId)]);
  if (!solicitante || !alvo || !solicitante.ativo || !alvo.ativo) {
    throw new ErroVinculo("CONTA_INVALIDA");
  }
  if (solicitante.id === alvo.id || solicitante.empresaId === alvo.empresaId) {
    throw new ErroVinculo("MESMA_LOJA");
  }
  const par = ordenarPar(solicitante.id, alvo.id);
  const versao = (id: string) => (id === solicitante.id ? solicitante.sessionVersion : alvo.sessionVersion);
  const versoes = { versaoA: versao(par.usuarioAId), versaoB: versao(par.usuarioBId) };
  const vinculo = await db.vinculoLoja.upsert({
    where: { usuarioAId_usuarioBId: par },
    create: { ...par, ...versoes, criadoPorId: solicitante.id },
    update: { ...versoes, criadoPorId: solicitante.id },
  });
  return { ...paraLoja(alvo), vinculoId: vinculo.id, vinculadaEm: vinculo.criadoEm.toISOString() };
}

/** Desfaz o vínculo — só se a conta for um dos dois lados. */
export async function removerVinculo(usuarioId: string, vinculoId: string): Promise<boolean> {
  const r = await db.vinculoLoja.deleteMany({
    where: { id: vinculoId, OR: [{ usuarioAId: usuarioId }, { usuarioBId: usuarioId }] },
  });
  return r.count > 0;
}

/** A conta vinculada (válida) na empresa pedida, para trocar de loja. */
export async function contaVinculadaNaEmpresa(
  usuarioId: string,
  empresaId: string,
): Promise<ContaComLoja | null> {
  const eu = await carregarConta(usuarioId);
  if (!eu || !eu.ativo || eu.empresaId === empresaId) return null;
  const achado = (await vinculosValidos(eu)).find((v) => v.outra.empresaId === empresaId);
  return achado?.outra ?? null;
}
