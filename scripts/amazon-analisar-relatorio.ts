import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { formatBRL } from "../src/lib/money";
import {
  parseAmazonUnifiedTransactionCsv,
  resumirAmazonUnifiedTransactions,
} from "../src/integrations/amazon/unified-transactions";

const arquivo = process.argv[2];

if (!arquivo) {
  console.error(
    "Uso: npm run amazon:analisar -- ./2026MarMonthlyUnifiedTransaction.csv",
  );
  process.exit(1);
}

const texto = readFileSync(arquivo, "utf8");
const parsed = parseAmazonUnifiedTransactionCsv(texto);
const resumo = resumirAmazonUnifiedTransactions(parsed.transactions);

console.log(`Relatorio Amazon: ${basename(arquivo)}`);
console.log(`Cabecalho encontrado na linha: ${parsed.headerLine}`);
console.log(`Linhas: ${resumo.totalLinhas}`);
console.log("");

console.log("Pedidos");
console.log(`- linhas: ${resumo.pedidos.linhas}`);
console.log(`- pedidos unicos: ${resumo.pedidos.pedidosUnicos}`);
console.log(`- SKUs unicos: ${resumo.pedidos.skusUnicos}`);
console.log(`- quantidade: ${resumo.pedidos.quantidade}`);
console.log(`- bruto: ${formatBRL(resumo.pedidos.brutoCentavos)}`);
console.log(
  `- descontos promocionais: ${formatBRL(
    resumo.pedidos.descontosPromocionaisCentavos,
  )}`,
);
console.log(
  `- tarifas de venda: ${formatBRL(resumo.pedidos.tarifasVendaCentavos)}`,
);
console.log(`- taxas FBA: ${formatBRL(resumo.pedidos.taxasFbaCentavos)}`);
console.log(`- liquido: ${formatBRL(resumo.pedidos.liquidoCentavos)}`);
console.log("");

console.log("Recebiveis / caixa");
console.log(
  `- atividade antes de transferencia: ${formatBRL(
    resumo.recebiveis.atividadeAntesTransferenciaCentavos,
  )}`,
);
console.log(
  `- diferido: ${formatBRL(resumo.recebiveis.diferidoCentavos)}`,
);
console.log(
  `- transferido para banco: ${formatBRL(
    resumo.recebiveis.transferidoBancoCentavos,
  )}`,
);
console.log(
  `- saldo do arquivo com transferencias: ${formatBRL(
    resumo.recebiveis.saldoRelatorioCentavos,
  )}`,
);
console.log("");

console.log("Tipos");
for (const [tipo, item] of Object.entries(resumo.porTipo).sort(
  ([, a], [, b]) => b.linhas - a.linhas,
)) {
  console.log(`- ${tipo}: ${item.linhas} linhas, ${formatBRL(item.totalCentavos)}`);
}
console.log("");

console.log("Top SKUs por liquido");
for (const sku of resumo.porSku.slice(0, 10)) {
  console.log(
    `- ${sku.sku}: qtd ${sku.quantidade}, bruto ${formatBRL(
      sku.brutoCentavos,
    )}, taxas/descontos ${formatBRL(sku.taxasCentavos)}, liquido ${formatBRL(
      sku.liquidoCentavos,
    )}`,
  );
}
