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

export const MARKETPLACE_REMOVAL_ORDER = [
  "Non-Amazon",
  "NON_AMAZON",
  "Non Amazon",
] as const;

const PREFIXO_REMOVAL_ORDER = "S01-";

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
  amazonOrderId?: string | null;
  marketplace?: string | null;
  statusPedido?: string | null;
  statusFinanceiro?: string | null;
  valorBrutoCentavos?: number | null;
  precoOrigem?: string | null;
}): boolean {
  const statusPedido = normalizarStatus(input.statusPedido);
  const statusFinanceiro = normalizarStatus(input.statusFinanceiro);
  const valorBruto = input.valorBrutoCentavos ?? 0;

  if (isVendaAmazonRemovalOrder(input)) return false;
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
  amazonOrderId?: string | null;
  marketplace?: string | null;
  statusPedido?: string | null;
  statusFinanceiro?: string | null;
  valorBrutoCentavos?: number | null;
  precoOrigem?: string | null;
}): boolean {
  if (isVendaAmazonRemovalOrder(input)) return false;
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
  amazonOrderId?: string | null;
  marketplace?: string | null;
  statusPedido?: string | null;
  statusFinanceiro?: string | null;
}): boolean {
  const statusPedido = normalizarStatus(input.statusPedido);
  const statusFinanceiro = normalizarStatus(input.statusFinanceiro);

  return (
    !isVendaAmazonRemovalOrder(input) &&
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
      ...whereRemovalOrders(),
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
      ...whereRemovalOrders(),
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

/**
 * Base do espelho Gestor Seller.
 *
 * Importante: nao exclui reembolsos por status vitalicio da venda. No Gestor,
 * o status "Reembolsado" e recortado pelo periodo do relatorio; uma venda de
 * janeiro reembolsada em fevereiro segue como "Enviado" no relatorio de
 * janeiro. Por isso o Dashboard remove apenas os pedidos com AmazonReembolso
 * dentro da propria janela consultada.
 */
export function whereVendaAmazonEspelhoGestorSeller(
  where?: Prisma.VendaAmazonWhereInput,
): Prisma.VendaAmazonWhereInput {
  return andWhere(
    {
      NOT: [
        ...whereRemovalOrders(),
        { statusPedido: { in: [...STATUS_PEDIDO_CANCELADO] } },
        {
          AND: [
            { statusPedido: { in: [...STATUS_PEDIDO_PENDENTE] } },
            {
              OR: [
                { valorBrutoCentavos: null },
                { valorBrutoCentavos: { lte: 0 } },
              ],
            },
          ],
        },
      ],
    },
    where,
  );
}

/**
 * Parte complementar do tooltip do Gestor Seller: vendas do periodo que foram
 * reembolsadas. Mantem exclusao de Removal Orders e cancelados.
 */
export function whereVendaAmazonReembolsadaGestorSeller(
  where?: Prisma.VendaAmazonWhereInput,
): Prisma.VendaAmazonWhereInput {
  return andWhere(
    {
      NOT: [
        ...whereRemovalOrders(),
        { statusPedido: { in: [...STATUS_PEDIDO_CANCELADO] } },
      ],
      OR: [
        { statusPedido: { in: [...STATUS_PEDIDO_REEMBOLSADO] } },
        { statusFinanceiro: { in: [...STATUS_FINANCEIRO_NAO_CONTABILIZAVEL] } },
      ],
    },
    where,
  );
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
        ...whereRemovalOrders(),
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
  if (visao === "todos") {
    return andWhere({ NOT: [...whereRemovalOrders()] }, where);
  }
  if (visao === "cancelados") {
    return andWhere(
      {
        NOT: [...whereRemovalOrders()],
        statusPedido: { in: [...STATUS_PEDIDO_CANCELADO] },
      },
      where,
    );
  }
  if (visao === "reembolsados") {
    return andWhere(
      {
        NOT: [...whereRemovalOrders()],
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

export function isVendaAmazonRemovalOrder(input: {
  amazonOrderId?: string | null;
  marketplace?: string | null;
}): boolean {
  const amazonOrderId = input.amazonOrderId?.trim() ?? "";
  const marketplace = input.marketplace?.trim().toUpperCase() ?? "";
  return (
    amazonOrderId.startsWith(PREFIXO_REMOVAL_ORDER) ||
    MARKETPLACE_REMOVAL_ORDER.some(
      (value) => value.toUpperCase() === marketplace,
    )
  );
}

function whereRemovalOrders(): Prisma.VendaAmazonWhereInput[] {
  return [
    { marketplace: { in: [...MARKETPLACE_REMOVAL_ORDER] } },
    { amazonOrderId: { startsWith: PREFIXO_REMOVAL_ORDER } },
  ];
}

function andWhere(
  base: Prisma.VendaAmazonWhereInput,
  where?: Prisma.VendaAmazonWhereInput,
): Prisma.VendaAmazonWhereInput {
  if (!where || Object.keys(where).length === 0) return base;
  return { AND: [base, where] };
}
