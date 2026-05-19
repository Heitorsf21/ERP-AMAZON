import { z } from "zod";
import { handle, ok, erro } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ vendaId: string }> };

/**
 * GET /api/vendas/[vendaId]/custos-eventuais
 * Lista os custos eventuais associados à venda, do mais recente para o mais antigo.
 */
export const GET = handle(async (_req: Request, { params }: Params) => {
  const { vendaId } = await params;

  const venda = await db.vendaAmazon.findUnique({
    where: { id: vendaId },
    select: { id: true },
  });
  if (!venda) return erro(404, "venda não encontrada");

  const custos = await db.vendaCustoEventual.findMany({
    where: { vendaAmazonId: vendaId },
    orderBy: { criadoEm: "desc" },
  });

  return ok({ custos });
});

const criarSchema = z.object({
  descricao: z.string().trim().min(1, "descrição obrigatória").max(120),
  valorCentavos: z.number().int().positive(),
});

/**
 * POST /api/vendas/[vendaId]/custos-eventuais
 * Adiciona um custo eventual à venda. Body: { descricao, valorCentavos }.
 *
 * NÃO altera VendaAmazon.taxasCentavos/fretesCentavos/liquidoMarketplaceCentavos —
 * o custo vive em registro separado e é somado em runtime pelo breakdown.
 */
export const POST = handle(async (req: Request, { params }: Params) => {
  const { vendaId } = await params;
  const body = criarSchema.parse(await req.json());

  const venda = await db.vendaAmazon.findUnique({
    where: { id: vendaId },
    select: { id: true },
  });
  if (!venda) return erro(404, "venda não encontrada");

  const custo = await db.vendaCustoEventual.create({
    data: {
      vendaAmazonId: vendaId,
      descricao: body.descricao,
      valorCentavos: body.valorCentavos,
    },
  });

  return ok({ custo }, { status: 201 });
});
