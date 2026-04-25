/**
 * Audit: verifica estado real de cada funcionalidade-chave do ERP.
 * Não escreve nada, só reporta.
 */
import { db } from "@/lib/db";

async function main() {
  console.log("=".repeat(70));
  console.log("AUDIT DE FUNCIONALIDADES — ERP AMAZON");
  console.log("=".repeat(70));

  // 1. PRODUTOS — filtro MFS, ativos, imagens
  const produtosTotal = await db.produto.count();
  const produtosMfs = await db.produto.count({
    where: { sku: { startsWith: "MFS-" } },
  });
  const produtosNaoMfs = await db.produto.count({
    where: { NOT: { sku: { startsWith: "MFS-" } } },
  });
  const produtosAtivos = await db.produto.count({ where: { ativo: true } });
  const produtosInativos = await db.produto.count({ where: { ativo: false } });
  const produtosComImagemManual = await db.produto.count({
    where: { imagemUrl: { not: null } },
  });
  const produtosComImagemAmazon = await db.produto.count({
    where: { amazonImagemUrl: { not: null } },
  });
  console.log("\n[1] PRODUTOS");
  console.log(`    Total: ${produtosTotal}  (MFS: ${produtosMfs} · NAO-MFS: ${produtosNaoMfs})`);
  console.log(`    Ativos: ${produtosAtivos}  Inativos: ${produtosInativos}`);
  console.log(`    Com imagem manual: ${produtosComImagemManual}`);
  console.log(`    Com imagem Amazon: ${produtosComImagemAmazon}`);

  // 2. VENDAS — preços corrigidos
  const vendasTotal = await db.vendaAmazon.count();
  const vendasComPreco = await db.vendaAmazon.count({
    where: { precoUnitarioCentavos: { gt: 0 } },
  });
  const vendasComLiquido = await db.vendaAmazon.count({
    where: { liquidoMarketplaceCentavos: { not: null } },
  });
  console.log("\n[2] VENDAS");
  console.log(`    Total: ${vendasTotal}`);
  console.log(`    Com precoUnitario>0: ${vendasComPreco}`);
  console.log(`    Com liquidoMarketplace nao-null: ${vendasComLiquido}`);

  // 3. CONTAS A RECEBER — pipeline
  const crPendente = await db.contaReceber.count({ where: { status: "PENDENTE" } });
  const crRecebida = await db.contaReceber.count({ where: { status: "RECEBIDA" } });
  const crCancelada = await db.contaReceber.count({ where: { status: "CANCELADA" } });
  const crSomaPendente = await db.contaReceber.aggregate({
    where: { status: "PENDENTE" },
    _sum: { valor: true },
  });
  const crSomaRecebida = await db.contaReceber.aggregate({
    where: { status: "RECEBIDA" },
    _sum: { valor: true },
  });
  console.log("\n[3] CONTAS A RECEBER");
  console.log(`    PENDENTE: ${crPendente} (R$ ${(crSomaPendente._sum.valor ?? 0) / 100})`);
  console.log(`    RECEBIDA: ${crRecebida} (R$ ${(crSomaRecebida._sum.valor ?? 0) / 100})`);
  console.log(`    CANCELADA: ${crCancelada}`);

  // 4. SETTLEMENT REPORTS — automação
  const settTotal = await db.amazonSettlementReport.count();
  const settProcessadas = await db.amazonSettlementReport.count({
    where: { processadoEm: { not: null } },
  });
  console.log("\n[4] SETTLEMENT REPORTS");
  console.log(`    Total: ${settTotal}  Processados: ${settProcessadas}`);

  // 5. BUYBOX SNAPSHOTS
  const bbTotal = await db.buyBoxSnapshot.count();
  const bbHoje = await db.buyBoxSnapshot.count({
    where: { capturadoEm: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
  });
  const produtosBuyboxGanho = await db.produto.count({
    where: { buyboxGanho: true },
  });
  const produtosBuyboxPerdido = await db.produto.count({
    where: { buyboxGanho: false },
  });
  const produtosBuyboxNull = await db.produto.count({
    where: { buyboxGanho: null, ativo: true },
  });
  console.log("\n[5] BUYBOX");
  console.log(`    Snapshots total: ${bbTotal}  Ultimas 24h: ${bbHoje}`);
  console.log(`    Produtos ganhando buybox: ${produtosBuyboxGanho}`);
  console.log(`    Produtos perdendo buybox: ${produtosBuyboxPerdido}`);
  console.log(`    Produtos sem dado de buybox: ${produtosBuyboxNull}`);

  // 6. ADS
  const adsCampanhas = await db.adsCampanha.count();
  const adsManuais = await db.adsGastoManual.count();
  console.log("\n[6] ADS");
  console.log(`    Campanhas (CSV): ${adsCampanhas}  Gastos manuais: ${adsManuais}`);

  // 7. DOCUMENTOS FINANCEIROS
  const docs = await db.documentoFinanceiro.count();
  const docsBoleto = await db.documentoFinanceiro.count({ where: { tipo: "BOLETO" } });
  const docsNF = await db.documentoFinanceiro.count({ where: { tipo: "NOTA_FISCAL" } });
  const dossies = await db.dossieFinanceiro.count();
  const dossiesPendentes = await db.dossieFinanceiro.count({ where: { status: "PENDENTE" } });
  console.log("\n[7] NOTAS FISCAIS / BOLETOS");
  console.log(`    Documentos: ${docs} (Boletos: ${docsBoleto} · NFs: ${docsNF})`);
  console.log(`    Dossies: ${dossies} (Pendentes: ${dossiesPendentes})`);

  // 8. NOTIFICACOES
  const notifTotal = await db.notificacao.count();
  const notifNaoLidas = await db.notificacao.count({ where: { lida: false } });
  console.log("\n[8] NOTIFICACOES");
  console.log(`    Total: ${notifTotal}  Nao lidas: ${notifNaoLidas}`);

  // 9. WORKER + JOBS
  const jobsSucesso = await db.amazonSyncJob.count({ where: { status: "SUCCESS" } });
  const jobsFalha = await db.amazonSyncJob.count({ where: { status: "FAILED" } });
  const jobsFila = await db.amazonSyncJob.count({ where: { status: "QUEUED" } });
  const heartbeat = await db.configuracaoSistema.findUnique({
    where: { chave: "worker_heartbeat_at" },
  });
  const heartbeatSegs = heartbeat
    ? Math.floor((Date.now() - new Date(heartbeat.valor).getTime()) / 1000)
    : null;
  console.log("\n[9] WORKER + JOBS");
  console.log(`    Sucesso: ${jobsSucesso}  Falhas: ${jobsFalha}  Em fila: ${jobsFila}`);
  console.log(`    Heartbeat: ${heartbeatSegs !== null ? `ha ${heartbeatSegs}s` : "(nunca)"}`);

  // 10. DESTINACAO
  const destPercents = await db.configuracaoSistema.findMany({
    where: { chave: { startsWith: "destinacao_percent_" } },
  });
  console.log("\n[10] DESTINACAO DE CAIXA");
  console.log(`    Percentuais salvos: ${destPercents.length}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
