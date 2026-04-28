# APIs Amazon pendentes

Gerado em: 2026-04-27

## 1. Notifications API + SQS

API para receber eventos da Amazon em push, em vez de depender apenas de polling recorrente.

Eventos principais:

- `ORDER_CHANGE`: mudancas em pedidos.
- `FBA_INVENTORY_AVAILABILITY_CHANGES`: mudancas de estoque FBA.
- `REPORT_PROCESSING_FINISHED`: report finalizado e pronto para baixar.
- `ANY_OFFER_CHANGED`: alteracoes de ofertas/buybox.
- `LISTINGS_ITEM_STATUS_CHANGE`: mudancas de status de listing.

Uso no projeto:

- Reduzir latencia de sincronizacao.
- Diminuir consumo de quota SP-API.
- Enfileirar jobs internos em `AmazonSyncJob` conforme cada evento recebido.
- Finalizar o stub atual em `src/lib/amazon-sqs.ts`.

## 2. Listings Items API

API para gerenciar ofertas/listings da Amazon programaticamente.

Usos principais:

- Atualizar preco de SKU.
- Atualizar status e atributos de listing.
- Sincronizar alteracoes feitas na UI do ERP com a Amazon.
- Servir de base para repricer automatico no futuro.

Uso no projeto:

- Criar wrapper em `src/lib/amazon-sp-api.ts`.
- Criar job sob demanda `LISTING_UPDATE`.
- Adicionar botao "Sincronizar com Amazon" em produto.
- Preparar campo/toggle de repricing automatico, mas sem ativar escrita automatica sem auditoria e limites de preco.

## Observacao

Alem dessas duas APIs, ainda existem reports importantes que tambem faltam implementar:

- FBA Reimbursements.
- Returns Report.
- FBA Storage Fees.
- Sales & Traffic Report, condicionado a Brand Registry/Brand Analytics.

Esses reports nao sao "APIs novas" no mesmo sentido, porque usam principalmente a Reports API ja existente no projeto. Mesmo assim, eles sao prioridade alta para enriquecer DRE, devolucoes, custos FBA e inteligencia comercial.
