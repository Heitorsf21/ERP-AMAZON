# WhatsApp Diario De Estoque Via WAHA

## Objetivo

Criar um resumo diario de estoque do Atlas Seller enviado por WhatsApp, usando WAHA rodando na VPS junto do ERP. O resumo deve mostrar a situacao completa dos produtos elegiveis, agrupados por cobertura de estoque, para apoiar decisoes diarias de reposicao.

O envio sera feito apenas para o numero do proprietario. O modulo de tarefas sera implementado separadamente pelo Claude; esta spec define somente o contrato de integracao necessario para que tarefas possam ser criadas a partir dos produtos criticos.

## Decisoes Aprovadas

- Canal: WhatsApp via WAHA.
- Infra: WAHA rodando na VPS junto do ERP, preferencialmente em Docker.
- Agendamento: envio diario as 10:00 no fuso `America/Sao_Paulo`.
- Destinatario: um numero fixo do proprietario.
- UI: pagina dedicada em Configuracoes, nao toggle direto na lista de produtos.
- Produtos padrao: todos os produtos ativos com venda nos ultimos 30 dias.
- Excecoes: SKU pode ser desativado manualmente para nao aparecer no resumo.
- Mensagem: uma mensagem unica com todas as faixas completas.
- Ordenacao: menor cobertura de estoque primeiro dentro de cada faixa.
- Data/hora: cabecalho da mensagem deve informar a data e hora do envio.
- `Produto.estoqueMinimo`: nao entra nessa regra.

## Regra De Estoque

O resumo considera apenas produtos que:

- estejam ativos;
- tenham vendido pelo menos 1 unidade nos ultimos 30 dias;
- nao estejam marcados como desativados para o resumo WhatsApp.

Para cada produto:

```text
vendas30d = total vendido nos ultimos 30 dias
mediaDia = vendas30d / 30
diasEstoque = estoqueAtual / mediaDia
```

A classificacao e:

- `CRITICO`: ate 15 dias de estoque.
- `ATENCAO`: de 16 a 30 dias.
- `ESTAVEL`: de 31 a 59 dias.
- `SEGURO`: 60 dias ou mais.

Produtos sem venda nos ultimos 30 dias ficam fora do resumo, mesmo que tenham estoque atual baixo.

## Mensagem WhatsApp

Formato base:

```text
Resumo de estoque - 28/05/2026 10:00

Critico (3)
MFS-0032 - Kit organizador | Estoque: 18 | Vendeu 30d: 45 | Cobertura: 12d

Atencao (7)
...

Estavel (12)
...

Seguro (31)
...
```

Cada item deve conter:

- SKU;
- nome do produto;
- estoque atual;
- unidades vendidas nos ultimos 30 dias;
- cobertura estimada em dias.

O sistema deve tentar enviar como mensagem unica. Se o payload ficar maior que o limite pratico do WhatsApp/WAHA, o envio pode ser quebrado automaticamente em partes numeradas, mantendo o conteudo completo.

## Pagina De Configuracao

Criar uma pagina dedicada, sugerida como `Configuracoes > WhatsApp Estoque`, com:

- toggle de envio diario ativo/inativo;
- horario do envio, default `10:00`;
- URL interna do WAHA;
- nome da sessao WAHA;
- numero de WhatsApp destinatario;
- botao `Enviar teste agora`;
- status do ultimo envio, com data/hora, sucesso/erro e resumo do erro;
- tabela de produtos elegiveis com busca por SKU/nome;
- acao para desativar ou reativar SKU no resumo diario.

O botao de teste deve montar a mensagem com dados reais e enviar para o mesmo numero configurado.

## Worker E WAHA

Reusar o worker atual do ERP. O novo job diario deve:

1. Verificar se o envio diario esta ativo.
2. Montar o resumo de estoque.
3. Formatar a mensagem.
4. Chamar a API HTTP do WAHA pela URL interna configurada.
5. Registrar status/historico do envio.
6. Criar notificacao no sino em caso de falha.

Fluxo:

```text
Worker ERP
-> calcula resumo de estoque
-> formata mensagem
-> chama WAHA HTTP API
-> grava historico/status
-> em caso de erro, cria notificacao no sino
```

O WAHA nao deve ser exposto publicamente. O ERP deve chama-lo por endereco interno da VPS, por exemplo `http://127.0.0.1:3001`, ou pela rede Docker interna se a configuracao final usar containers.

Credenciais sensiveis, como token/API key do WAHA se houver, devem usar o mecanismo atual de criptografia via `ConfiguracaoSistema`.

## Falhas E Observabilidade

Falhas esperadas:

- WAHA fora do ar;
- sessao WhatsApp desconectada;
- numero invalido;
- erro HTTP ou timeout na chamada WAHA;
- mensagem grande demais.

Comportamento esperado:

- registrar status do erro no historico do envio;
- criar notificacao no sino com link para a configuracao;
- nao fazer retry agressivo no WhatsApp para evitar spam;
- permitir validacao manual pelo botao `Enviar teste agora`.

## Integracao Com Tarefas

O modulo de tarefas sera implementado pelo Claude. Para preparar a integracao, o resumo de estoque deve expor um contrato de evento ou funcao de dominio quando um produto for classificado como critico.

Evento sugerido:

```text
ESTOQUE_CRITICO_DETECTADO
```

Payload sugerido:

```json
{
  "produtoId": "string",
  "sku": "string",
  "nome": "string",
  "estoqueAtual": 18,
  "vendas30d": 45,
  "diasEstoque": 12
}
```

O modulo de tarefas podera consumir isso para criar ou atualizar tarefa deduplicada por SKU, por exemplo:

```text
Comprar reposicao do SKU MFS-0032
```

Sugestao de tarefa:

- vencimento: hoje;
- prioridade: alta;
- dedupe: uma tarefa aberta por SKU critico.

## Fora De Escopo Inicial

- Envio para multiplos destinatarios.
- SMS ou ligacao.
- Uso de `Produto.estoqueMinimo` na classificacao.
- Produtos sem venda nos ultimos 30 dias.
- Implementacao completa do modulo de tarefas.
- Regras diferentes por produto.

## Validacao

Validacoes recomendadas quando a implementacao for feita:

- teste unitario da classificacao por dias de cobertura;
- teste unitario da formatacao da mensagem;
- teste de service com produtos ativos, inativos, sem venda e desativados por excecao;
- teste do endpoint de envio de teste com WAHA mockado;
- lint nos arquivos alterados;
- verificacao manual da pagina de configuracao.
