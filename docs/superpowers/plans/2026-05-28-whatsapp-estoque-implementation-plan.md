# Plano De Implementacao: WhatsApp Diario De Estoque Via WAHA

Origem: `docs/superpowers/specs/2026-05-28-whatsapp-estoque-design.md`

Este plano remove qualquer integracao com o modulo de tarefas. O escopo aqui e somente resumo diario de estoque por WhatsApp, configuracao no ERP, envio via WAHA e observabilidade.

## Escopo

Entregar:

- Calculo de cobertura de estoque por produto com base nas vendas dos ultimos 30 dias.
- Classificacao em `CRITICO`, `ATENCAO`, `ESTAVEL` e `SEGURO`.
- Mensagem unica diaria, com data/hora no cabecalho e lista completa por faixa.
- Pagina `Configuracoes > WhatsApp Estoque`.
- Botao `Enviar teste agora`.
- Job diario as 10:00 no fuso `America/Sao_Paulo`.
- Envio HTTP para WAHA rodando na VPS.
- Historico/status de envio e notificacao no sino em caso de erro.

Nao entregar neste plano:

- Modulo de tarefas.
- Criacao automatica de tarefas.
- Eventos internos para tarefas.
- Multiplos destinatarios.
- Uso de `Produto.estoqueMinimo`.
- Inclusao de produtos sem venda nos ultimos 30 dias.

## Fase 1: Modelo De Dados E Configuracao

1. Adicionar modelos Prisma nos dois schemas:
   - `prisma/schema.prisma`
   - `prisma/schema.postgresql.prisma`

2. Modelo sugerido para excecoes por produto:

```prisma
model WhatsAppEstoqueProdutoExcluido {
  produtoId String   @id
  sku       String
  criadoEm DateTime @default(now())
  updatedAt DateTime @updatedAt

  produto Produto @relation(fields: [produtoId], references: [id], onDelete: Cascade)

  @@index([sku])
}
```

3. Modelo sugerido para historico de envios:

```prisma
model WhatsAppEstoqueEnvio {
  id              String    @id @default(cuid())
  tipo            String
  status          String
  destino         String
  partes          Int       @default(1)
  totaisJson      String?
  mensagemPreview String?
  erro            String?
  iniciadoEm      DateTime  @default(now())
  concluidoEm     DateTime?
  createdAt       DateTime  @default(now())

  @@index([tipo])
  @@index([status])
  @@index([iniciadoEm])
}
```

4. Guardar configuracoes em `ConfiguracaoSistema`, usando o mecanismo atual de criptografia quando a chave for sensivel:
   - `whatsapp_estoque_ativo`
   - `whatsapp_estoque_horario`
   - `whatsapp_estoque_destinatario`
   - `whatsapp_estoque_waha_url`
   - `whatsapp_estoque_waha_session`
   - `whatsapp_estoque_waha_api_key` se o WAHA exigir token

5. Criar migration manual Postgres em `prisma/migrations/<timestamp>_whatsapp_estoque/migration.sql`.

6. Atualizar o schema SQLite e preparar comandos de validacao:
   - local: `npm run prisma:generate && npm run prisma:push`
   - prod: `npm run prisma:migrate:deploy:pg && npm run prisma:generate:pg`

## Fase 2: Dominio De Estoque WhatsApp

1. Criar modulo dedicado:
   - `src/modules/whatsapp-estoque/service.ts`
   - `src/modules/whatsapp-estoque/message.ts`
   - `src/modules/whatsapp-estoque/config.ts`
   - `src/modules/whatsapp-estoque/waha-client.ts`
   - `src/modules/whatsapp-estoque/schemas.ts`

2. Implementar `obterResumoEstoqueWhatsApp()`:
   - buscar produtos ativos;
   - buscar vendas contabilizaveis dos ultimos 30 dias via `VendaAmazon.groupBy({ by: ["sku"] })`;
   - usar `whereVendaAmazonContabilizavelEstrito()`;
   - remover produtos sem venda nos ultimos 30 dias;
   - remover SKUs em `WhatsAppEstoqueProdutoExcluido`;
   - calcular `mediaDia`, `diasEstoque` e faixa;
   - ordenar cada faixa por menor `diasEstoque`.

3. Regras de faixa:
   - `diasEstoque <= 15`: `CRITICO`
   - `diasEstoque <= 30`: `ATENCAO`
   - `diasEstoque < 60`: `ESTAVEL`
   - `diasEstoque >= 60`: `SEGURO`

4. Tratar arredondamento:
   - manter valor numerico interno com decimal;
   - exibir cobertura arredondada para baixo ou com uma casa decimal, escolhendo um padrao consistente;
   - evitar divisao por zero, embora produtos sem venda ja sejam filtrados.

5. Implementar `formatarMensagemResumoEstoque()`:
   - cabecalho `Resumo de estoque - dd/MM/yyyy HH:mm`;
   - secoes na ordem `Critico`, `Atencao`, `Estavel`, `Seguro`;
   - contagem por secao;
   - item no formato aprovado: `SKU - Nome | Estoque: X | Vendeu 30d: Y | Cobertura: Zd`.

6. Implementar quebra tecnica de mensagem:
   - tentar mensagem unica;
   - se exceder limite interno definido, quebrar em partes numeradas;
   - manter todas as faixas e todos os itens.

## Fase 3: Cliente WAHA

1. Criar wrapper isolado em `src/modules/whatsapp-estoque/waha-client.ts`.

2. Responsabilidades:
   - montar payload de envio de texto;
   - aplicar timeout;
   - anexar token/API key se configurado;
   - retornar resultado normalizado;
   - mascarar destino/token em logs e erros.

3. Antes da implementacao final, validar a versao do WAHA instalada na VPS e confirmar o endpoint exato de envio de texto.

4. O ERP deve chamar WAHA por URL interna, por exemplo:
   - `http://127.0.0.1:<porta>`
   - ou hostname interno Docker, se WAHA e ERP ficarem na mesma rede Docker.

5. Nao expor WAHA publicamente.

## Fase 4: APIs Do ERP

1. Criar endpoints autenticados para configuracao:
   - `GET /api/configuracoes/whatsapp-estoque`
   - `POST /api/configuracoes/whatsapp-estoque`

2. Criar endpoints para produtos monitorados:
   - `GET /api/configuracoes/whatsapp-estoque/produtos`
   - `POST /api/configuracoes/whatsapp-estoque/produtos/[produtoId]/excluir`
   - `DELETE /api/configuracoes/whatsapp-estoque/produtos/[produtoId]/excluir`

3. Criar endpoint de envio de teste:
   - `POST /api/configuracoes/whatsapp-estoque/enviar-teste`

4. Usar Zod em `schemas.ts` para validar:
   - horario `HH:mm`;
   - URL WAHA;
   - session;
   - numero destinatario;
   - toggle ativo/inativo.

5. Garantir padrao Next.js 16 para rotas dinamicas:

```ts
type Params = { params: Promise<{ produtoId: string }> };
const { produtoId } = await params;
```

6. Registrar erros com `logger` (`src/lib/logger.ts`), sem `console.log`.

## Fase 5: Pagina De Configuracao

1. Integrar na aba `Integracoes` de `src/app/configuracoes/page.tsx` ou criar subsecao dedicada dentro da pagina atual.

2. Criar componente:
   - `src/components/configuracoes/whatsapp-estoque-section.tsx`

3. Controles da UI:
   - switch de envio diario;
   - input de horario, default `10:00`;
   - input de URL WAHA;
   - input de session WAHA;
   - input de numero destinatario;
   - campo de API key/token se necessario;
   - botao `Enviar teste agora`;
   - status do ultimo envio;
   - busca por SKU/nome;
   - tabela/lista de produtos elegiveis com acao excluir/reativar.

4. UX:
   - mostrar estado salvando/enviando;
   - invalidar queries apos salvar;
   - toast de sucesso/erro;
   - nao criar blocos fixos redundantes;
   - manter layout incremental e consistente com as secoes atuais de Configuracoes.

## Fase 6: Job Diario No Worker

1. Adicionar novo tipo em `TipoAmazonSyncJob`:
   - `WHATSAPP_ESTOQUE_RESUMO`

2. Ajustar `processJob()` em `src/modules/amazon/worker.ts`:
   - esse job nao precisa de credenciais Amazon SP-API;
   - chamar `runWhatsappEstoqueResumo()`.

3. Implementar handler:
   - local sugerido: `src/modules/whatsapp-estoque/jobs.ts`
   - funcao: `runWhatsappEstoqueResumo({ tipo: "DIARIO" | "TESTE" })`

4. Agendamento:
   - nao usar somente `intervalMs: 24h`, porque isso nao garante 10:00 local;
   - criar gate diario por data local em `America/Sao_Paulo`;
   - enfileirar quando horario atual local for maior ou igual ao configurado;
   - dedupe por dia local: `WHATSAPP_ESTOQUE_RESUMO:YYYY-MM-DD`;
   - nao enfileirar se ja houver job `QUEUED/RUNNING/SUCCESS` com a mesma dedupeKey.

5. Resultado do job:
   - salvar `WhatsAppEstoqueEnvio` com `SUCESSO`, `ERRO` ou `SKIPPED`;
   - retornar totais por faixa;
   - em erro, criar notificacao no sino com link para `/configuracoes`.

6. Notificacao:
   - usar `TipoNotificacao.CONFIG_REVIEW` ou criar tipo especifico se fizer sentido;
   - dedupe por dia para evitar spam: `whatsapp_estoque_falha:YYYY-MM-DD`.

## Fase 7: WAHA Na VPS

1. Adicionar documentacao operacional em `docs/` ou `deploy/` com:
   - como subir WAHA em Docker;
   - porta interna;
   - volume/sessao persistente;
   - variaveis de ambiente;
   - como parear o WhatsApp;
   - como testar envio manualmente.

2. Se alterar deploy:
   - manter N8N atual intocado;
   - nao expor WAHA publicamente sem necessidade;
   - documentar como reiniciar WAHA sem afetar `erp-web`, `erp-worker` e `erp-sqs-consumer`.

3. Configurar no ERP:
   - `whatsapp_estoque_waha_url`;
   - `whatsapp_estoque_waha_session`;
   - `whatsapp_estoque_destinatario`;
   - token/API key se usado.

## Fase 8: Testes E Validacao

1. Testes unitarios:
   - classificacao por cobertura;
   - exclusao de produtos sem venda;
   - exclusao de SKUs desativados;
   - ordenacao por menor cobertura;
   - formatacao da mensagem com data/hora.

2. Testes de API/service:
   - salvar configuracao;
   - listar produtos elegiveis;
   - excluir/reativar SKU;
   - envio de teste com WAHA mockado;
   - registro de historico em sucesso e erro.

3. Validacao manual local:
   - abrir Configuracoes;
   - salvar config;
   - enviar teste;
   - confirmar historico/status;
   - confirmar que produtos sem venda 30d nao aparecem.

4. Comandos recomendados, somente nos arquivos alterados:
   - `npx eslint <arquivos>`
   - `npx vitest run <testes criados>`
   - `npx tsc --noEmit` se as mudancas atravessarem schema, worker e UI.

5. Antes de deploy:
   - `npm run prisma:migrate:deploy:pg`
   - `npm run prisma:generate:pg`
   - `npm run build`
   - reload separado dos tres processos PM2 conforme AGENTS.md.

## Ordem Recomendada De Implementacao

1. Criar modelos/migration e gerar Prisma local.
2. Implementar service puro de resumo e testes unitarios.
3. Implementar formatter de mensagem e testes.
4. Implementar config service e APIs.
5. Implementar cliente WAHA com mock nos testes.
6. Implementar pagina de configuracao.
7. Implementar envio de teste.
8. Implementar job diario e dedupe por data local.
9. Documentar WAHA na VPS.
10. Validar localmente e preparar deploy.

## Riscos

- Endpoint WAHA pode variar por versao: confirmar antes de codar o cliente final.
- Mensagem pode ficar longa em loja com muitos SKUs: manter quebra automatica por partes.
- Scheduler atual por intervalo nao garante 10:00: implementar gate por data/hora local.
- Schema duplo exige atualizar SQLite e Postgres em conjunto.
- Job novo nao pode depender de credenciais Amazon SP-API, apesar de morar na fila `AmazonSyncJob`.
