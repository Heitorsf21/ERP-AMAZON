/**
 * Serviço de Destinação de Caixa.
 *
 * Permite o usuário definir percentuais para "bolsas" (reinvestir, reserva,
 * pro-labore, impostos, marketing, outros) e calcula como o saldo livre
 * projetado seria distribuído entre elas.
 *
 * Percentuais são persistidos em ConfiguracaoSistema (chaves
 * `destinacao_percent_<bolsa>`). Defaults aplicados quando nenhuma chave existir.
 *
 * Money em centavos. Datas UTC.
 */
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// Bolsas fixas suportadas. Ordem importa para UI.
export const BOLSAS = [
  "reinvestir",
  "reserva",
  "pro_labore",
  "impostos",
  "marketing",
  "outros",
] as const;

export type Bolsa = (typeof BOLSAS)[number];

export type Percentuais = Record<Bolsa, number>;

export const PERCENTUAIS_DEFAULT: Percentuais = {
  reinvestir: 50,
  reserva: 15,
  pro_labore: 20,
  impostos: 10,
  marketing: 5,
  outros: 0,
};

// Metadados visuais (cores Tailwind + label legível). Usados pela UI.
export const BOLSA_META: Record<
  Bolsa,
  { label: string; descricao: string; cor: string; corClasse: string }
> = {
  reinvestir: {
    label: "Reinvestir",
    descricao: "Compras de mercadoria e expansão",
    cor: "#10b981",
    corClasse: "bg-emerald-500",
  },
  reserva: {
    label: "Reserva",
    descricao: "Caixa de emergência",
    cor: "#0ea5e9",
    corClasse: "bg-sky-500",
  },
  pro_labore: {
    label: "Pró-labore",
    descricao: "Retirada do sócio",
    cor: "#a855f7",
    corClasse: "bg-purple-500",
  },
  impostos: {
    label: "Impostos",
    descricao: "DAS, IRPJ, contribuições",
    cor: "#f59e0b",
    corClasse: "bg-amber-500",
  },
  marketing: {
    label: "Marketing",
    descricao: "Anúncios e mídia paga",
    cor: "#ec4899",
    corClasse: "bg-pink-500",
  },
  outros: {
    label: "Outros",
    descricao: "Reserva genérica",
    cor: "#64748b",
    corClasse: "bg-slate-500",
  },
};

const CHAVE_PREFIX = "destinacao_percent_";

function chaveDe(bolsa: Bolsa): string {
  return `${CHAVE_PREFIX}${bolsa}`;
}

function parsePercent(valor: string | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 100) return null;
  return n;
}

/**
 * Lê percentuais salvos. Aplica defaults para bolsas sem registro,
 * exceto se EXISTIR ao menos uma chave (nesse caso ausências viram 0,
 * porque o usuário já configurou explicitamente).
 */
export async function getPercentuais(): Promise<{
  percentuais: Percentuais;
  configurado: boolean;
}> {
  const chaves = BOLSAS.map(chaveDe);
  const registros = await db.configuracaoSistema.findMany({
    where: { chave: { in: chaves } },
  });

  const map = new Map<string, string>();
  for (const r of registros) map.set(r.chave, r.valor);

  const configurado = registros.length > 0;
  const result: Percentuais = { ...PERCENTUAIS_DEFAULT };

  if (configurado) {
    // Limpa defaults — só aplica o que estiver salvo.
    for (const b of BOLSAS) result[b] = 0;
    for (const b of BOLSAS) {
      const v = parsePercent(map.get(chaveDe(b)) ?? null);
      if (v !== null) result[b] = v;
    }
  }

  return { percentuais: result, configurado };
}

/**
 * Salva percentuais. Valida que cada valor está em [0, 100] e que a soma
 * é exatamente 100 (com tolerância de 0.01 pra arredondamentos).
 */
export async function setPercentuais(input: Partial<Percentuais>): Promise<Percentuais> {
  const finalPct: Percentuais = { ...PERCENTUAIS_DEFAULT };
  for (const b of BOLSAS) finalPct[b] = 0;
  for (const b of BOLSAS) {
    const raw = input[b];
    if (raw === undefined || raw === null) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new Error(`percentual inválido para "${b}": ${raw}`);
    }
    finalPct[b] = n;
  }

  const soma = BOLSAS.reduce((acc, b) => acc + finalPct[b], 0);
  if (Math.abs(soma - 100) > 0.01) {
    throw new Error(`soma dos percentuais deve ser 100 (atual: ${soma.toFixed(2)})`);
  }

  await db.$transaction(
    BOLSAS.map((b) =>
      db.configuracaoSistema.upsert({
        where: { chave: chaveDe(b) },
        create: { chave: chaveDe(b), valor: String(finalPct[b]) },
        update: { valor: String(finalPct[b]) },
      }),
    ),
  );

  logger.info({ percentuais: finalPct }, "destinacao: percentuais atualizados");
  return finalPct;
}

/**
 * Calcula a distribuição em centavos para um saldo dado.
 * Usa floor por bolsa e joga o resto na maior bolsa (evita perder centavo
 * por arredondamento).
 */
export function calcularDistribuicao(
  saldoCentavos: number,
  percentuais: Percentuais,
): Record<Bolsa, number> {
  const base = Math.max(saldoCentavos, 0);
  const valores: Record<Bolsa, number> = {
    reinvestir: 0,
    reserva: 0,
    pro_labore: 0,
    impostos: 0,
    marketing: 0,
    outros: 0,
  };

  if (base === 0) return valores;

  let alocado = 0;
  let maiorBolsa: Bolsa = "reinvestir";
  let maiorPct = -1;
  for (const b of BOLSAS) {
    const v = Math.floor((base * percentuais[b]) / 100);
    valores[b] = v;
    alocado += v;
    if (percentuais[b] > maiorPct) {
      maiorPct = percentuais[b];
      maiorBolsa = b;
    }
  }
  const sobra = base - alocado;
  if (sobra > 0) valores[maiorBolsa] += sobra;
  return valores;
}

export type DistribuicaoBolsa = {
  bolsa: Bolsa;
  label: string;
  descricao: string;
  cor: string;
  percent: number;
  valor: number;
};

export async function getDistribuicaoCompleta(saldoCentavos: number): Promise<{
  saldo: number;
  percentuais: Percentuais;
  configurado: boolean;
  distribuicao: DistribuicaoBolsa[];
  somaPercentuais: number;
}> {
  const { percentuais, configurado } = await getPercentuais();
  const valores = calcularDistribuicao(saldoCentavos, percentuais);
  const distribuicao: DistribuicaoBolsa[] = BOLSAS.map((b) => ({
    bolsa: b,
    label: BOLSA_META[b].label,
    descricao: BOLSA_META[b].descricao,
    cor: BOLSA_META[b].cor,
    percent: percentuais[b],
    valor: valores[b],
  }));
  const somaPercentuais = BOLSAS.reduce((acc, b) => acc + percentuais[b], 0);
  return {
    saldo: saldoCentavos,
    percentuais,
    configurado,
    distribuicao,
    somaPercentuais,
  };
}

/**
 * Projeção: usa a média diária de receita líquida (entradas - saídas) dos
 * últimos N dias para projetar o saldo livre nos próximos 30/60/90 dias e
 * aplica os percentuais.
 *
 * Receita bruta projetada = mediaDiaria * dias.
 * Não soma o saldo livre atual — é projeção INCREMENTAL.
 */
export async function getProjecao(saldoLivreAtual: number): Promise<{
  mediaDiariaCentavos: number;
  baseHistoricoDias: number;
  janelas: Array<{
    dias: number;
    receitaProjetada: number;
    saldoProjetado: number;
    distribuicao: Record<Bolsa, number>;
  }>;
}> {
  const baseHistoricoDias = 30;
  const ate = new Date();
  const desde = new Date(ate.getTime() - baseHistoricoDias * 24 * 60 * 60 * 1000);

  const [entradas, saidas] = await Promise.all([
    db.movimentacao.aggregate({
      where: { tipo: "ENTRADA", dataCaixa: { gte: desde, lte: ate } },
      _sum: { valor: true },
    }),
    db.movimentacao.aggregate({
      where: { tipo: "SAIDA", dataCaixa: { gte: desde, lte: ate } },
      _sum: { valor: true },
    }),
  ]);

  const liquidoNoPeriodo =
    (entradas._sum.valor ?? 0) - (saidas._sum.valor ?? 0);
  const mediaDiariaCentavos = Math.round(liquidoNoPeriodo / baseHistoricoDias);

  const { percentuais } = await getPercentuais();

  const janelas = [30, 60, 90].map((dias) => {
    const receitaProjetada = mediaDiariaCentavos * dias;
    const saldoProjetado = saldoLivreAtual + receitaProjetada;
    const distribuicao = calcularDistribuicao(saldoProjetado, percentuais);
    return { dias, receitaProjetada, saldoProjetado, distribuicao };
  });

  return { mediaDiariaCentavos, baseHistoricoDias, janelas };
}
