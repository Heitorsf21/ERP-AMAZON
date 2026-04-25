import { subDays } from "date-fns";
import { handle, ok, erro } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const diasParam = Number(searchParams.get("dias") ?? "15");
  const dias = Number.isFinite(diasParam) && diasParam > 0 ? Math.min(diasParam, 90) : 15;

  const produto = await db.produto.findUnique({
    where: { id },
    select: { sku: true },
  });
  if (!produto) return erro(404, "produto não encontrado");

  const desde = subDays(new Date(), dias);

  const snapshots = await db.buyBoxSnapshot.findMany({
    where: {
      OR: [{ produtoId: id }, { sku: produto.sku }],
      capturadoEm: { gte: desde },
    },
    select: {
      capturadoEm: true,
      somosBuybox: true,
      precoNosso: true,
      precoBuybox: true,
      sellerBuybox: true,
    },
    orderBy: { capturadoEm: "asc" },
  });

  const totalSnapshots = snapshots.length;
  const ganhos = snapshots.filter((s) => s.somosBuybox).length;
  const percentualTempo =
    totalSnapshots > 0 ? Math.round((ganhos / totalSnapshots) * 1000) / 10 : 0;

  const precosBuybox = snapshots
    .map((s) => s.precoBuybox)
    .filter((p): p is number => p != null && p > 0);
  const mediaPrecoBuybox =
    precosBuybox.length > 0
      ? Math.round(precosBuybox.reduce((a, b) => a + b, 0) / precosBuybox.length)
      : null;

  return ok({
    snapshots,
    percentualTempo,
    mediaPrecoBuybox,
    totalSnapshots,
  });
});
