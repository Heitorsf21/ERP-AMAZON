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
}): boolean {
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
        AND: [
          {
            statusPedido: {
              in: [...STATUS_PEDIDO_PENDENTE],
            },
          },
          {
            statusFinanceiro: { in: [...STATUS_FINANCEIRO_SEM_CONFIRMACAO] },
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
