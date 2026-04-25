/**
 * Remove permanentemente os produtos cujo SKU não começa com "MFS-".
 * Antes de deletar, remove movimentações de estoque vinculadas (se houver).
 * Deixa intactos: VendaAmazon (vinculada por sku string, não por FK), AmazonReembolso (produtoId vira null por SetNull).
 *
 * Roda one-shot. Pode rodar de novo sem efeito (lista vazia).
 */
import { db } from "@/lib/db";

async function main() {
  const produtosLixo = await db.produto.findMany({
    where: { NOT: { sku: { startsWith: "MFS-" } } },
    select: { id: true, sku: true, nome: true, ativo: true },
  });

  if (produtosLixo.length === 0) {
    console.log("Nada a limpar. Todos os produtos seguem padrao MFS-.");
    process.exit(0);
  }

  console.log(`Encontrados ${produtosLixo.length} produtos nao-MFS:`);
  for (const p of produtosLixo) {
    console.log(`  - ${p.sku.padEnd(20)} ativo=${p.ativo} nome="${p.nome}"`);
  }

  const ids = produtosLixo.map((p) => p.id);

  // Conta o que vai ser apagado em cascata.
  const movs = await db.movimentacaoEstoque.count({
    where: { produtoId: { in: ids } },
  });
  const itensPedido = await db.itemPedidoCompra.count({
    where: { produtoId: { in: ids } },
  });

  console.log(
    `\nDependencias: ${movs} movimentacoes de estoque, ${itensPedido} itens de pedido.`,
  );

  if (itensPedido > 0) {
    console.error(
      `ABORTANDO: produtos lixo tem itens em pedidos de compra. Limpe manualmente antes.`,
    );
    process.exit(2);
  }

  // Transaction: deleta movs primeiro, depois produtos.
  const result = await db.$transaction(async (tx) => {
    const movsRes = await tx.movimentacaoEstoque.deleteMany({
      where: { produtoId: { in: ids } },
    });
    const prodRes = await tx.produto.deleteMany({
      where: { id: { in: ids } },
    });
    return { movs: movsRes.count, produtos: prodRes.count };
  });

  console.log(
    `\nFeito: ${result.produtos} produtos deletados, ${result.movs} movimentacoes removidas.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
