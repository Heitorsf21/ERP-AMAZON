import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const de = searchParams.get("de");
    const ate = searchParams.get("ate");
    const sku = searchParams.get("sku");
    const status = searchParams.get("status");
    const pagina = Math.max(1, Number(searchParams.get("pagina") ?? "1"));
    const porPagina = 50;

    const where: Prisma.VendaFBAWhereInput = {};

    if (de || ate) {
      where.dataCompra = {};
      if (de) where.dataCompra.gte = new Date(de);
      if (ate) {
        const fim = new Date(ate);
        fim.setHours(23, 59, 59, 999);
        where.dataCompra.lte = fim;
      }
    }
    if (sku) {
      where.skuExterno = { contains: sku };
    }
    if (status && status !== "todos") {
      where.status = status;
    }

    const [total, vendas] = await Promise.all([
      db.vendaFBA.count({ where }),
      db.vendaFBA.findMany({
        where,
        orderBy: { dataCompra: "desc" },
        skip: (pagina - 1) * porPagina,
        take: porPagina,
        select: {
          id: true,
          numeroPedido: true,
          marketplace: true,
          status: true,
          dataCompra: true,
          skuExterno: true,
          titulo: true,
          quantidade: true,
          precoUnitarioCentavos: true,
          totalCentavos: true,
        },
      }),
    ]);

    return NextResponse.json({ vendas, total, pagina, porPagina });
  } catch (err) {
    console.error("[GET /api/vendas]", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
