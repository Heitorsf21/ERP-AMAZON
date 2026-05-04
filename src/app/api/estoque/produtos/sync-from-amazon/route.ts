import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole, UsuarioRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await requireRole(UsuarioRole.ADMIN, UsuarioRole.OPERADOR);

  // Busca todos os SKUs distintos em VendaAmazon com titulo/asin mais recentes
  const vendas = await db.vendaAmazon.findMany({
    distinct: ["sku"],
    orderBy: { dataVenda: "desc" },
    select: { sku: true, asin: true, titulo: true },
  });

  // Busca todos os SKUs já cadastrados
  const skusExistentes = new Set(
    (await db.produto.findMany({ select: { sku: true } })).map((p) => p.sku),
  );

  const novos = vendas.filter((v) => !skusExistentes.has(v.sku));

  let criados = 0;
  const erros: string[] = [];

  for (const venda of novos) {
    try {
      await db.produto.upsert({
        where: { sku: venda.sku },
        create: {
          sku: venda.sku,
          nome: venda.titulo || venda.sku,
          asin: venda.asin ?? null,
          ativo: true,
          custoUnitario: null,
          estoqueAtual: 0,
          estoqueMinimo: 0,
          unidade: "un",
        },
        update: {},
      });
      criados++;
    } catch (err) {
      erros.push(venda.sku);
    }
  }

  return NextResponse.json({
    total: vendas.length,
    jaExistiam: skusExistentes.size,
    criados,
    erros,
  });
}
