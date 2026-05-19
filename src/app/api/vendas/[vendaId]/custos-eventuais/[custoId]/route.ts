import { handle, ok, erro } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ vendaId: string; custoId: string }> };

/**
 * DELETE /api/vendas/[vendaId]/custos-eventuais/[custoId]
 * Remove um custo eventual. 404 quando não pertence à venda.
 */
export const DELETE = handle(async (_req: Request, { params }: Params) => {
  const { vendaId, custoId } = await params;

  const custo = await db.vendaCustoEventual.findFirst({
    where: { id: custoId, vendaAmazonId: vendaId },
    select: { id: true },
  });
  if (!custo) return erro(404, "custo eventual não encontrado");

  await db.vendaCustoEventual.delete({ where: { id: custoId } });

  return ok({ ok: true });
});
