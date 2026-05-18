/**
 * Vincula MFS-0026 ao mesmo custo histórico de MFS-0003 (mesmo produto,
 * SKU alternativo). Cria Produto MFS-0026 inativo + replica vigências do
 * MFS-0003 + reaplica custos nas vendas.
 */
import { db } from "@/lib/db";
import {
  ORIGEM_GESTOR_SELLER,
  inserirVigencia,
  reaplicarCustoEmVendas,
} from "@/modules/produtos/custo-historico";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL nao configurado");

  const pai = await db.produto.findUnique({
    where: { sku: "MFS-0003" },
    select: { id: true, nome: true, asin: true, custoUnitario: true },
  });
  if (!pai) throw new Error("MFS-0003 não encontrado");

  const vigencias = await db.produtoCustoHistorico.findMany({
    where: { produtoId: pai.id },
    orderBy: { vigenciaInicio: "asc" },
  });

  console.log(`MFS-0003: ${pai.nome.slice(0, 60)}`);
  console.log(`Vigências: ${vigencias.length}`);
  for (const v of vigencias) {
    console.log(
      `  ${v.vigenciaInicio.toISOString().slice(0, 10)} → ${v.vigenciaFim?.toISOString().slice(0, 10) ?? "—"}  R$ ${(v.custoCentavos / 100).toFixed(2)}`,
    );
  }

  const existente = await db.produto.findUnique({ where: { sku: "MFS-0026" } });
  let produto026Id: string;
  if (existente) {
    console.log(`\nMFS-0026 já existe (id=${existente.id}), apenas replicando vigências.`);
    produto026Id = existente.id;
  } else {
    const novo = await db.produto.create({
      data: {
        sku: "MFS-0026",
        nome: pai.nome,
        asin: pai.asin,
        custoUnitario: pai.custoUnitario,
        ativo: false,
        estoqueAtual: 0,
        estoqueMinimo: 0,
        unidade: "un",
        observacoes: `SKU alternativo de MFS-0003 (mesmo produto). Vinculado em ${new Date().toISOString().slice(0, 10)}.`,
      },
      select: { id: true },
    });
    produto026Id = novo.id;
    console.log(`\n✓ Produto MFS-0026 criado (id=${produto026Id}).`);
  }

  // Replica vigências
  for (const v of vigencias) {
    await inserirVigencia({
      produtoId: produto026Id,
      custoCentavos: v.custoCentavos,
      vigenciaInicio: v.vigenciaInicio,
      vigenciaFim: v.vigenciaFim,
      origem: ORIGEM_GESTOR_SELLER,
      observacao: `Vinculado a MFS-0003 (mesmo produto, SKU alternativo)`,
    });
  }
  console.log(`✓ ${vigencias.length} vigências replicadas em MFS-0026.`);

  const r = await reaplicarCustoEmVendas({ produtoId: produto026Id });
  console.log(`\n✓ ${r.atualizadas} vendas de MFS-0026 atualizadas.`);

  await db.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
