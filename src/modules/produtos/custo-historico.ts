/**
 * Histórico de custos por produto.
 *
 * Modelo:
 *   ProdutoCustoHistorico armazena vigências (intervalos de tempo) com o
 *   custo unitário válido naquele período. Não se sobrepõem para o mesmo
 *   produto — `vigenciaFim` da anterior é fechada quando uma nova começa.
 *
 * Resolução:
 *   Para uma venda em dataVenda, busca o registro onde
 *     produtoId = X
 *     vigenciaInicio <= dataVenda
 *     AND (vigenciaFim IS NULL OR vigenciaFim > dataVenda)
 *   Se nenhuma vigência cobre, fallback para Produto.custoUnitario.
 *
 * Os 3 modos de update:
 *   - A_PARTIR_DE_HOJE      : fecha vigência atual em hoje, abre nova vigência hoje
 *                             e atualiza Produto.custoUnitario.
 *   - PERIODO               : insere/fecha vigência num intervalo específico
 *                             (vigenciaInicio = de, vigenciaFim = ate).
 *   - HISTORICO_COMPLETO    : apaga todas as vigências e cria uma única com
 *                             vigenciaInicio epoch (1970-01-01) e vigenciaFim
 *                             aberta, valendo para sempre. Atualiza Produto.
 */
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export const ORIGEM_INICIAL = "inicial";
export const ORIGEM_MANUAL = "manual";
export const ORIGEM_GESTOR_SELLER = "gestor-seller-import";

const EPOCH = new Date("1970-01-01T00:00:00.000Z");

export type ModoUpdate = "A_PARTIR_DE_HOJE" | "PERIODO" | "HISTORICO_COMPLETO";

/**
 * Resolve o custo unitário (em centavos) de um produto para uma data específica.
 * Retorna null se não houver vigência nem fallback.
 */
export async function resolverCustoUnitario(
  produtoId: string,
  dataVenda: Date,
  tx?: Prisma.TransactionClient,
): Promise<number | null> {
  const client = tx ?? db;

  // Busca a vigência mais específica que cobre a data
  const vigencia = await client.produtoCustoHistorico.findFirst({
    where: {
      produtoId,
      vigenciaInicio: { lte: dataVenda },
      OR: [{ vigenciaFim: null }, { vigenciaFim: { gt: dataVenda } }],
    },
    orderBy: { vigenciaInicio: "desc" },
  });

  if (vigencia) return vigencia.custoCentavos;

  // Fallback: Produto.custoUnitario atual
  const produto = await client.produto.findUnique({
    where: { id: produtoId },
    select: { empresaId: true, custoUnitario: true },
  });
  return produto?.custoUnitario && produto.custoUnitario > 0
    ? produto.custoUnitario
    : null;
}

export type CustoFallbackPorProduto = {
  produtoId: string;
  custoUnitario: number | null;
};

/**
 * Versão batch de `resolverCustoUnitario` — para a listagem de Vendas.
 *
 * Faz no máximo 2 queries:
 *   1. ProdutoCustoHistorico com `produtoId IN (...)` — busca todas as
 *      vigências dos produtos da página.
 *   2. Produto com `id IN (...)` para fallback de `custoUnitario` quando
 *      nenhuma vigência cobre a data.
 *
 * Para cada par (produtoId, dataVenda), escolhe a vigência válida com
 * maior `vigenciaInicio <= dataVenda` e `vigenciaFim` nula ou `> dataVenda`.
 *
 * Retorna `Map<chave, centavos>` onde a chave é `${produtoId}::${dataVendaISO}`
 * (string estável) para que callers com a mesma (produto, dia) reaproveitem.
 */
export async function resolverCustoUnitarioEmLote(
  pares: Array<{ produtoId: string; dataVenda: Date }>,
  fallbacks?: CustoFallbackPorProduto[],
): Promise<Map<string, number>> {
  const resultado = new Map<string, number>();
  if (pares.length === 0) return resultado;

  const produtoIds = [...new Set(pares.map((p) => p.produtoId))];

  const [vigencias, fallbacksFromDb] = await Promise.all([
    db.produtoCustoHistorico.findMany({
      where: { produtoId: { in: produtoIds } },
      select: {
        produtoId: true,
        custoCentavos: true,
        vigenciaInicio: true,
        vigenciaFim: true,
      },
      orderBy: { vigenciaInicio: "desc" },
    }),
    fallbacks
      ? Promise.resolve(fallbacks)
      : db.produto.findMany({
          where: { id: { in: produtoIds } },
          select: { id: true, custoUnitario: true },
        }).then((produtos) =>
          produtos.map((p) => ({
            produtoId: p.id,
            custoUnitario: p.custoUnitario && p.custoUnitario > 0 ? p.custoUnitario : null,
          })),
        ),
  ]);

  const vigenciasPorProduto = new Map<string, typeof vigencias>();
  for (const v of vigencias) {
    const arr = vigenciasPorProduto.get(v.produtoId) ?? [];
    arr.push(v);
    vigenciasPorProduto.set(v.produtoId, arr);
  }

  const fallbackPorProduto = new Map<string, number | null>();
  for (const f of fallbacksFromDb) {
    fallbackPorProduto.set(f.produtoId, f.custoUnitario);
  }

  for (const { produtoId, dataVenda } of pares) {
    const chave = chaveResolucao(produtoId, dataVenda);
    if (resultado.has(chave)) continue;

    const lista = vigenciasPorProduto.get(produtoId) ?? [];
    const valida = lista.find((v) =>
      v.vigenciaInicio.getTime() <= dataVenda.getTime() &&
      (v.vigenciaFim == null || v.vigenciaFim.getTime() > dataVenda.getTime()),
    );

    if (valida) {
      resultado.set(chave, valida.custoCentavos);
      continue;
    }

    const fallback = fallbackPorProduto.get(produtoId);
    if (fallback != null && fallback > 0) {
      resultado.set(chave, fallback);
    }
  }

  return resultado;
}

/** Chave canônica para o Map retornado por `resolverCustoUnitarioEmLote`. */
export function chaveResolucao(produtoId: string, dataVenda: Date): string {
  return `${produtoId}::${dataVenda.toISOString()}`;
}

/**
 * Insere uma vigência, fechando a anterior se houver sobreposição.
 * Não atualiza VendaAmazon — chame reaplicarCustoEmVendas separadamente
 * quando quiser propagar.
 */
export async function inserirVigencia(input: {
  produtoId: string;
  custoCentavos: number;
  vigenciaInicio: Date;
  vigenciaFim?: Date | null;
  origem: string;
  observacao?: string | null;
}): Promise<void> {
  return db.$transaction(async (tx) => {
    // Fecha vigência anterior (caso exista) se a nova começa depois
    const anteriorAberta = await tx.produtoCustoHistorico.findFirst({
      where: {
        produtoId: input.produtoId,
        vigenciaInicio: { lt: input.vigenciaInicio },
        OR: [
          { vigenciaFim: null },
          { vigenciaFim: { gt: input.vigenciaInicio } },
        ],
      },
      orderBy: { vigenciaInicio: "desc" },
    });

    if (anteriorAberta) {
      await tx.produtoCustoHistorico.update({
        where: { id: anteriorAberta.id },
        data: { vigenciaFim: input.vigenciaInicio },
      });
    }

    // Remove vigências internas que ficam dentro da nova janela
    if (input.vigenciaFim) {
      await tx.produtoCustoHistorico.deleteMany({
        where: {
          produtoId: input.produtoId,
          vigenciaInicio: { gte: input.vigenciaInicio },
          OR: [{ vigenciaFim: null }, { vigenciaFim: { lte: input.vigenciaFim } }],
        },
      });
    }

    // Upsert da nova vigência
    await tx.produtoCustoHistorico.upsert({
      where: {
        produtoId_vigenciaInicio: {
          produtoId: input.produtoId,
          vigenciaInicio: input.vigenciaInicio,
        },
      },
      create: {
        produtoId: input.produtoId,
        custoCentavos: input.custoCentavos,
        vigenciaInicio: input.vigenciaInicio,
        vigenciaFim: input.vigenciaFim ?? null,
        origem: input.origem,
        observacao: input.observacao ?? null,
      },
      update: {
        custoCentavos: input.custoCentavos,
        vigenciaFim: input.vigenciaFim ?? null,
        origem: input.origem,
        observacao: input.observacao ?? null,
      },
    });
  });
}

/**
 * Atualiza o custo "a partir de hoje". Fecha vigência atual, abre nova,
 * e atualiza Produto.custoUnitario (que serve como fallback do snapshot
 * em ORDERS_SYNC para novas vendas).
 */
export async function aplicarCustoAPartirDeHoje(input: {
  produtoId: string;
  custoCentavos: number;
  observacao?: string | null;
}): Promise<void> {
  const hoje = startOfDay(new Date());
  await inserirVigencia({
    produtoId: input.produtoId,
    custoCentavos: input.custoCentavos,
    vigenciaInicio: hoje,
    vigenciaFim: null,
    origem: ORIGEM_MANUAL,
    observacao: input.observacao,
  });
  await db.produto.update({
    where: { id: input.produtoId },
    data: { custoUnitario: input.custoCentavos },
  });
}

/**
 * Atualiza o custo num período específico (sem mexer em outros períodos).
 */
export async function aplicarCustoNoPeriodo(input: {
  produtoId: string;
  custoCentavos: number;
  de: Date;
  ate: Date;
  observacao?: string | null;
}): Promise<void> {
  await inserirVigencia({
    produtoId: input.produtoId,
    custoCentavos: input.custoCentavos,
    vigenciaInicio: startOfDay(input.de),
    vigenciaFim: endOfDay(input.ate),
    origem: ORIGEM_MANUAL,
    observacao: input.observacao,
  });
}

/**
 * Substitui TODO o histórico do produto por uma única vigência aberta.
 */
export async function aplicarCustoHistoricoCompleto(input: {
  produtoId: string;
  custoCentavos: number;
  observacao?: string | null;
}): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.produtoCustoHistorico.deleteMany({
      where: { produtoId: input.produtoId },
    });
    await tx.produtoCustoHistorico.create({
      data: {
        produtoId: input.produtoId,
        custoCentavos: input.custoCentavos,
        vigenciaInicio: EPOCH,
        vigenciaFim: null,
        origem: ORIGEM_MANUAL,
        observacao: input.observacao ?? null,
      },
    });
    await tx.produto.update({
      where: { id: input.produtoId },
      data: { custoUnitario: input.custoCentavos },
    });
  });
}

/**
 * Reaplica o custo nas VendaAmazon de um produto (ou todos), usando o histórico.
 * Útil após importação ou alteração de vigência.
 */
export async function reaplicarCustoEmVendas(opts?: {
  produtoId?: string;
  apenasSemCusto?: boolean;
}): Promise<{ atualizadas: number; semProdutoMapeado: number }> {
  const filtroProduto = opts?.produtoId
    ? { sku: { in: await skusDoProduto(opts.produtoId) } }
    : {};
  const filtroSemCusto = opts?.apenasSemCusto
    ? {
        OR: [
          { custoUnitarioCentavos: null },
          { custoUnitarioCentavos: { lte: 0 } },
        ],
      }
    : {};

  const vendas = await db.vendaAmazon.findMany({
    where: { ...filtroProduto, ...filtroSemCusto },
    select: {
      id: true,
      sku: true,
      dataVenda: true,
      custoUnitarioCentavos: true,
    },
  });

  if (vendas.length === 0) return { atualizadas: 0, semProdutoMapeado: 0 };

  // Mapeia SKU -> produtoId (1 query)
  const skus = [...new Set(vendas.map((v) => v.sku))];
  const produtos = await db.produto.findMany({
    where: { sku: { in: skus } },
    select: { id: true, sku: true },
  });
  const produtoPorSku = new Map(produtos.map((p) => [p.sku, p.id]));

  let atualizadas = 0;
  let semProdutoMapeado = 0;
  for (const v of vendas) {
    const produtoId = produtoPorSku.get(v.sku);
    if (!produtoId) {
      semProdutoMapeado++;
      continue;
    }
    const custo = await resolverCustoUnitario(produtoId, v.dataVenda);
    if (custo == null) continue;
    if (custo === v.custoUnitarioCentavos) continue;
    await db.vendaAmazon.update({
      where: { id: v.id },
      data: { custoUnitarioCentavos: custo, ultimaSyncEm: new Date() },
    });
    atualizadas++;
  }

  return { atualizadas, semProdutoMapeado };
}

async function skusDoProduto(produtoId: string): Promise<string[]> {
  const produto = await db.produto.findUnique({
    where: { id: produtoId },
    select: { empresaId: true, sku: true },
  });
  return produto ? [produto.sku] : [];
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}
