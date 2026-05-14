import { Prisma } from "@prisma/client";
import { fromZonedTime } from "date-fns-tz";
import { TIMEZONE } from "@/lib/date";

export const STATUS_PEDIDO_CANCELADO = [
  "Canceled",
  "Cancelled",
  "CANCELADO",
  "CANCELED",
  "CANCELLED",
  "Cancelado",
  "Unfulfillable",
  "UNFULFILLABLE",
] as const;

export const STATUS_PEDIDO_REEMBOLSADO = [
  "REEMBOLSADO",
  "Reembolsado",
  "Refunded",
  "REFUNDED",
] as const;

export const STATUS_PEDIDO_PENDENTE = [
  "Pending",
  "PENDING",
  "PendingAvailability",
  "PENDING_AVAILABILITY",
] as const;

export const STATUS_FINANCEIRO_SEM_CONFIRMACAO = [
  "PENDENTE",
] as const;

export const STATUS_FINANCEIRO_NAO_CONTABILIZAVEL = [
  "REEMBOLSADO",
  "Reembolsado",
  "Refunded",
  "REFUNDED",
] as const;

const STATUS_PEDIDO_CANCELADO_NORMALIZADO = new Set(
  STATUS_PEDIDO_CANCELADO.map(normalizarStatus),
);
const STATUS_PEDIDO_REEMBOLSADO_NORMALIZADO = new Set(
  STATUS_PEDIDO_REEMBOLSADO.map(normalizarStatus),
);
const STATUS_PEDIDO_PENDENTE_NORMALIZADO = new Set(
  STATUS_PEDIDO_PENDENTE.map(normalizarStatus),
);
const STATUS_FINANCEIRO_SEM_CONFIRMACAO_NORMALIZADO = new Set(
  STATUS_FINANCEIRO_SEM_CONFIRMACAO.map(normalizarStatus),
);
const STATUS_FINANCEIRO_NAO_CONTABILIZAVEL_NORMALIZADO = new Set(
  STATUS_FINANCEIRO_NAO_CONTABILIZAVEL.map(normalizarStatus),
);

export function isVendaAmazonContabilizavel(input: {
  statusPedido?: string | null;
  statusFinanceiro?: string | null;
  valorBrutoCentavos?: number | null;
  precoOrigem?: string | null;
}): boolean {
  const statusPedido = normalizarStatus(input.statusPedido);
  const statusFinanceiro = normalizarStatus(input.statusFinanceiro);
  const valorBruto = input.valorBrutoCentavos ?? 0;

  if (STATUS_PEDIDO_CANCELADO_NORMALIZADO.has(statusPedido)) return false;
  if (STATUS_FINANCEIRO_NAO_CONTABILIZAVEL_NORMALIZADO.has(statusFinanceiro))
    return false;

  // Pending so entra no dashboard quando tem valor (real ou fallback do listing).
  // Pending zerado continua oculto — sem valor, nao da pra estimar receita.
  if (STATUS_PEDIDO_PENDENTE_NORMALIZADO.has(statusPedido)) {
    if (valorBruto <= 0) return false;
  }
  return true;
}

/**
 * Versao estrita para DRE/Contas a Receber/Caixa: alem das regras de
 * contabilizavel, exige `precoOrigem != "listing"` — o valor de fallback
 * vindo do cache do listing nao deve entrar como receita confirmada na
 * contabilidade. Apenas valor real da SP-API (`precoOrigem = "sp-api"`)
 * ou legado (null) conta.
 */
export function isVendaAmazonContabilizavelEstrito(input: {
  statusPedido?: string | null;
  statusFinanceiro?: string | null;
  valorBrutoCentavos?: number | null;
  precoOrigem?: string | null;
}): boolean {
  if (input.precoOrigem === "listing") return false;
  const statusPedido = normalizarStatus(input.statusPedido);
  const statusFinanceiro = normalizarStatus(input.statusFinanceiro);
  return (
    !STATUS_PEDIDO_CANCELADO_NORMALIZADO.has(statusPedido) &&
    !STATUS_FINANCEIRO_NAO_CONTABILIZAVEL_NORMALIZADO.has(statusFinanceiro) &&
    !(
      STATUS_PEDIDO_PENDENTE_NORMALIZADO.has(statusPedido) &&
      (!statusFinanceiro ||
        STATUS_FINANCEIRO_SEM_CONFIRMACAO_NORMALIZADO.has(statusFinanceiro))
    )
  );
}

export function isVendaAmazonPrincipal(input: {
  statusPedido?: string | null;
  statusFinanceiro?: string | null;
}): boolean {
  const statusPedido = normalizarStatus(input.statusPedido);
  const statusFinanceiro = normalizarStatus(input.statusFinanceiro);

  return (
    !STATUS_PEDIDO_CANCELADO_NORMALIZADO.has(statusPedido) &&
    !STATUS_PEDIDO_REEMBOLSADO_NORMALIZADO.has(statusPedido) &&
    !STATUS_FINANCEIRO_NAO_CONTABILIZAVEL_NORMALIZADO.has(statusFinanceiro)
  );
}

/**
 * Filtro contabilizavel — usado pelo dashboard E-commerce.
 *
 * Exclui:
 * - Pedidos cancelados (statusPedido em STATUS_PEDIDO_CANCELADO)
 * - Pedidos reembolsados (statusPedido em STATUS_PEDIDO_REEMBOLSADO)
 * - Vendas com statusFinanceiro NAO_CONTABILIZAVEL (REEMBOLSADO/Refunded)
 * - Pedidos `Pending` SEM valor (`valorBrutoCentavos <= 0` ou null) —
 *   sem preco, nao tem como contar receita; permanecem ocultos ate a
 *   SP-API entregar ItemPrice OU o cache do listing preencher fallback.
 *
 * Pending COM valor (qualquer origem: "sp-api" ou "listing") entra no
 * dashboard. Para a contabilidade estrita (DRE/Contas a Receber/Caixa),
 * use `whereVendaAmazonContabilizavelEstrito`.
 */
export function whereVendaAmazonContabilizavel(
  where?: Prisma.VendaAmazonWhereInput,
): Prisma.VendaAmazonWhereInput {
  const contabilizavel: Prisma.VendaAmazonWhereInput = {
    NOT: [
      {
        statusPedido: {
          in: [...STATUS_PEDIDO_CANCELADO],
        },
      },
      {
        statusPedido: {
          in: [...STATUS_PEDIDO_REEMBOLSADO],
        },
      },
      {
        statusFinanceiro: {
          in: [...STATUS_FINANCEIRO_NAO_CONTABILIZAVEL],
        },
      },
      {
        // Pending oculto APENAS quando ainda nao tem valor preenchido.
        AND: [
          {
            statusPedido: {
              in: [...STATUS_PEDIDO_PENDENTE],
            },
          },
          {
            OR: [
              { valorBrutoCentavos: null },
              { valorBrutoCentavos: { lte: 0 } },
            ],
          },
        ],
      },
    ],
  };

  if (!where || Object.keys(where).length === 0) return contabilizavel;

  return {
    AND: [contabilizavel, where],
  };
}

/**
 * Filtro estrito — DRE, Contas a Receber, Caixa, Destinacao.
 *
 * Mantém a regra antiga (Pending + PENDENTE oculto) E adiciona exclusao
 * de `precoOrigem = "listing"` (valor de fallback do cache de catalogo
 * nao deve entrar como receita confirmada na contabilidade). Apenas
 * `precoOrigem = "sp-api"` ou null (legado, antes da feature) entra.
 */
export function whereVendaAmazonContabilizavelEstrito(
  where?: Prisma.VendaAmazonWhereInput,
): Prisma.VendaAmazonWhereInput {
  const contabilizavel: Prisma.VendaAmazonWhereInput = {
    NOT: [
      { statusPedido: { in: [...STATUS_PEDIDO_CANCELADO] } },
      { statusPedido: { in: [...STATUS_PEDIDO_REEMBOLSADO] } },
      { statusFinanceiro: { in: [...STATUS_FINANCEIRO_NAO_CONTABILIZAVEL] } },
      {
        AND: [
          { statusPedido: { in: [...STATUS_PEDIDO_PENDENTE] } },
          { statusFinanceiro: { in: [...STATUS_FINANCEIRO_SEM_CONFIRMACAO] } },
        ],
      },
      { precoOrigem: "listing" },
    ],
  };

  if (!where || Object.keys(where).length === 0) return contabilizavel;

  return {
    AND: [contabilizavel, where],
  };
}

export type VisaoVendas = "principal" | "cancelados" | "reembolsados" | "todos";

export function normalizarVisaoVendas(value?: string | null): VisaoVendas {
  if (
    value === "cancelados" ||
    value === "reembolsados" ||
    value === "todos"
  ) {
    return value;
  }
  return "principal";
}

export function whereVendaAmazonPrincipal(
  where?: Prisma.VendaAmazonWhereInput,
): Prisma.VendaAmazonWhereInput {
  return andWhere(
    {
      NOT: [
        { statusPedido: { in: [...STATUS_PEDIDO_CANCELADO] } },
        { statusPedido: { in: [...STATUS_PEDIDO_REEMBOLSADO] } },
        { statusFinanceiro: { in: [...STATUS_FINANCEIRO_NAO_CONTABILIZAVEL] } },
      ],
    },
    where,
  );
}

export function whereVendaAmazonPorVisao(
  visao: VisaoVendas,
  where?: Prisma.VendaAmazonWhereInput,
): Prisma.VendaAmazonWhereInput {
  if (visao === "todos") return where ?? {};
  if (visao === "cancelados") {
    return andWhere(
      { statusPedido: { in: [...STATUS_PEDIDO_CANCELADO] } },
      where,
    );
  }
  if (visao === "reembolsados") {
    return andWhere(
      {
        OR: [
          { statusPedido: { in: [...STATUS_PEDIDO_REEMBOLSADO] } },
          { statusFinanceiro: { in: [...STATUS_FINANCEIRO_NAO_CONTABILIZAVEL] } },
        ],
      },
      where,
    );
  }
  return whereVendaAmazonPrincipal(where);
}

export function dataVendaPeriodoSP(
  de?: string | null,
  ate?: string | null,
): Prisma.DateTimeFilter | undefined {
  if (!de && !ate) return undefined;

  const dataVenda: Prisma.DateTimeFilter = {};
  if (de) dataVenda.gte = fromZonedTime(`${de}T00:00:00`, TIMEZONE);
  if (ate) dataVenda.lte = fromZonedTime(`${ate}T23:59:59.999`, TIMEZONE);

  return dataVenda;
}

function normalizarStatus(status?: string | null): string {
  return (status ?? "").trim().toUpperCase();
}

function andWhere(
  base: Prisma.VendaAmazonWhereInput,
  where?: Prisma.VendaAmazonWhereInput,
): Prisma.VendaAmazonWhereInput {
  if (!where || Object.keys(where).length === 0) return base;
  return { AND: [base, where] };
}
