import { handle, ok, erro } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Params) => {
  const { id } = await params;

  const produto = await db.produto.findUnique({
    where: { id },
    select: { sku: true },
  });
  if (!produto) return erro(404, "produto não encontrado");

  const solicitacoes = await db.amazonReviewSolicitation.findMany({
    where: { sku: produto.sku },
    select: {
      amazonOrderId: true,
      status: true,
      eligibleFrom: true,
      sentAt: true,
    },
    orderBy: { eligibleFrom: "asc" },
  });

  const pendentes = solicitacoes.filter((s) => s.status === "PENDENTE").length;
  const enviadas = solicitacoes.filter((s) => s.sentAt !== null).length;
  const total = solicitacoes.length;

  const agora = new Date();
  const proximasElegiveis = solicitacoes
    .filter(
      (s) =>
        s.status === "PENDENTE" &&
        s.eligibleFrom != null &&
        s.eligibleFrom > agora,
    )
    .slice(0, 10)
    .map((s) => ({
      amazonOrderId: s.amazonOrderId,
      eligibleFrom: s.eligibleFrom,
    }));

  return ok({ pendentes, enviadas, total, proximasElegiveis });
});
