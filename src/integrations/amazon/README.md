# Integracao Amazon

Esta pasta agora guarda o primeiro passo real da integracao financeira Amazon:
ler o relatorio unificado de transacoes baixado no Seller Central e transformar
as linhas em dados confiaveis para conciliacao, recebiveis e, depois, SP-API.

## O arquivo de marco e util?

Sim. O arquivo `2026MarMonthlyUnifiedTransaction.csv` e o melhor ponto de
partida para o ERP porque tem:

- pedido, SKU, quantidade e marketplace;
- valor bruto, frete, descontos, tarifas de venda, taxas FBA e total liquido;
- `Status da transacao`, separando valores `Liberado` e `Diferido`;
- `Data de liberacao da transacao`, util para projetar caixa quando preenchida;
- linhas de `Transferir`, que mostram quanto ja foi enviado para o banco.

Resumo encontrado no arquivo atual:

- 329 linhas totais.
- 280 linhas de pedidos, 271 pedidos unicos e 15 SKUs.
- Pedidos: R$ 16.998,08 bruto (produto + frete/creditos) e R$ 12.976,17
  liquido.
- Transacoes diferidas: 2 pedidos, R$ 69,08. Essas sao o sinal mais direto de
  "contas a receber" dentro deste relatorio.
- Transferencias para banco: R$ 13.751,06.
- Saldo total do arquivo: -R$ 1.056,15, porque o relatorio mistura vendas,
  taxas, reembolsos e transferencias para banco. Para recebiveis, nao use esse
  saldo cru sem separar os tipos.

## Rodar a analise

```bash
npm run amazon:analisar -- ./2026MarMonthlyUnifiedTransaction.csv
```

O script usa `src/integrations/amazon/unified-transactions.ts`, que tambem
exporta:

- `parseAmazonUnifiedTransactionCsv`: parser do CSV com preambulo da Amazon.
- `resumirAmazonUnifiedTransactions`: totais por pedido, status, tipo e SKU.
- `converterParaVendasAmazon`: adapter para o contrato `VendaAmazon`.

## Caminho recomendado de automacao

1. **Agora: CSV manual + importador**
   Baixe o relatorio unificado no Seller Central, rode `amazon:analisar` e use
   o parser como base para importar recebiveis e vendas no ERP.

2. **Temporario: automacao de navegador**
   Se precisar automatizar antes da API, use Playwright ou `agent-browser` com
   perfil persistente. O fluxo deve reaproveitar uma sessao logada, entrar em
   Pagamentos > Repositorio de relatorios, selecionar "All / Unified Reports",
   solicitar relatorio de transacoes do periodo e baixar quando ficar pronto.
   Guarde cookies/estado fora do git e espere interferencia de 2FA.

3. **Definitivo: SP-API**
   Para o valor de "tenho a receber", o melhor caminho tecnico e a Finances API
   v2024-06-19 (`listTransactions`), filtrando `marketplaceId=A2Q3Y263D00KWC`
   e `transactionStatus=DEFERRED`/`RELEASED`. Para relatorios fechados, use a
   Reports API: os settlement reports V2 sao gerados automaticamente pela
   Amazon e encontrados com `getReports`; depois, o arquivo vem via
   `getReportDocument`.

## Passos para conseguir acesso SP-API

1. A conta precisa ser Professional Seller e o usuario principal deve iniciar o
   cadastro.
2. Registrar um Developer Profile no Solution Provider Portal.
3. Criar uma aplicacao privada para uso interno.
4. Solicitar o role **Finance and Accounting**.
5. Obter credenciais LWA e refresh token da propria conta.
6. Chamar a API North America (`https://sellingpartnerapi-na.amazon.com`) com o
   marketplace do Brasil: `A2Q3Y263D00KWC`.

Quando isso estiver aprovado, o ERP pode trocar a fonte: primeiro CSV, depois
Finances API/Reports API, mantendo o mesmo contrato interno.
