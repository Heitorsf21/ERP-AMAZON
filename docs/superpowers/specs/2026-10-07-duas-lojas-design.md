# Duas lojas juntas e troca rápida de loja

**Data:** 2026-10-07 · **Status:** visual aprovado pelo usuário no protótipo (canvas "Atlas: duas lojas juntas", https://claude.ai/artifact/9uimNbN3j3W7mfdem6LW5N, v2) · **Branch:** `feat/duas-lojas`

## 1. Objetivo

O usuário opera duas lojas Amazon no Atlas (MundoFS e UDN), cada uma com o próprio login, e usa as duas no mesmo celular. Hoje, para ver a outra loja, ele precisa sair e entrar de novo.

O que foi pedido:
- ver as duas lojas juntas;
- trocar de loja rápido, sem digitar senha a cada troca.

**Sucesso significa:**
1. Em Configurações → Lojas, a outra loja é vinculada **uma vez**, com e-mail, senha e, se houver, código 2FA da outra conta.
2. Tocar no nome da loja no topo e escolher a outra troca de loja **sem login**, em até ~1 s.
3. No Início, a aba **Todas** mostra as duas lojas somadas, com os mesmos números que cada loja mostra sozinha:
   - os KPIs;
   - o bloco "Por loja";
   - o top produtos das duas lojas, com o selo da loja em cada item.
4. Tocar em "Nova venda na UDN" com o app aberto na MundoFS abre o pedido já na UDN.

## 2. Decisões aprovadas (protótipo v2)

| # | Decisão |
|---|---|
| D1 | **Celular:** o nome da loja aberta, com ⌄, substitui "Atlas Seller" no topo. Tocar abre a folha "Trocar de loja", no padrão da folha "Mais". |
| D2 | **Início no celular:** abas `Todas · <loja 1> · <loja 2>` no mesmo estilo das abas de Configurações. A aba "Todas" acrescenta o bloco "Por loja" e o selo da loja no Top 15. |
| D3 | **Configurações:** nova aba "Lojas", com os cartões "Minhas lojas" e "Vincular outra loja". |
| D4 | **Computador:** um seletor na barra de cima, à esquerda da busca, com "Todas as lojas", as lojas e "Vincular outra loja…". Na visão "Todas", o Início ganha a tabela "Por loja". |
| D5 | A visão "Todas" vale **só para o Início**. Vendas, Produtos e as demais telas continuam na loja aberta. |

## 3. Modelo de dados

### 3.1 `VinculoLoja` (novo, modelo GLOBAL)

Liga duas contas (`Usuario`) de lojas diferentes. O par é guardado em ordem (`usuarioAId < usuarioBId`), então A↔B tem uma única linha.

```prisma
model VinculoLoja {
  id          String   @id @default(cuid())
  usuarioAId  String
  usuarioBId  String
  // sessionVersion de cada conta quando o vínculo foi criado. Trocar a senha ou
  // "encerrar todas as sessões" de qualquer lado desfaz o vínculo (fail-closed).
  versaoA     Int
  versaoB     Int
  criadoPorId String
  criadoEm    DateTime @default(now())

  usuarioA Usuario @relation("VinculoLojaA", fields: [usuarioAId], references: [id], onDelete: Cascade)
  usuarioB Usuario @relation("VinculoLojaB", fields: [usuarioBId], references: [id], onDelete: Cascade)

  @@unique([usuarioAId, usuarioBId])
  @@index([usuarioBId])
}
```

- Ele entra em `GLOBAL_MODELS` (`src/lib/db.ts`). O escopo é resolvido explicitamente pelo módulo `src/modules/lojas/` e nunca por auto-filtro de tenant.
- **Não é transitivo.** A↔B e B↔C **não** dão acesso de A a C, porque só quem provou a senha de C pode ver C. Com 3 lojas, cada par é vinculado.

Um vínculo só vale enquanto as 5 condições abaixo forem verdadeiras:
1. as duas contas estão `ativo`;
2. as duas empresas estão `ativa`;
3. as empresas são diferentes;
4. `versaoA` é igual ao `sessionVersion` atual de A;
5. `versaoB` é igual ao `sessionVersion` atual de B.

Um vínculo que deixa de valer é ignorado. Vincular de novo atualiza as versões (upsert).

### 3.2 `CodigoVerificacao2FA.finalidade` (coluna nova)

O tipo é `String @default("LOGIN")`, com os valores `"LOGIN"` ou `"VINCULO:<usuarioId de quem pediu>"`. Ela separa os dois fluxos:
- `/api/auth/2fa/verificar` passa a recusar um desafio que não seja `LOGIN`;
- a confirmação do vínculo recusa um desafio que não seja o seu `VINCULO:<uid>`.

Com isso, um código pedido para vincular não abre sessão, e um código de login não cria vínculo.

### 3.3 Migration

`prisma/migrations/20261007200000_vinculo_lojas/migration.sql` é manual, como manda o projeto. Ela faz duas coisas:
- `ALTER TABLE "CodigoVerificacao2FA" ADD COLUMN "finalidade" TEXT NOT NULL DEFAULT 'LOGIN'`;
- `CREATE TABLE "VinculoLoja"`, com os índices e as FKs `ON DELETE CASCADE`.

Ela só cria: zero risco para dados existentes. O schema SQLite (`prisma/schema.prisma`) recebe as mesmas mudanças.

## 4. Segurança

| Regra | Como |
|---|---|
| Vincular exige provar a outra conta | Mesmo caminho do login: bcrypt com dummy hash quando o e-mail não existe, `recordLoginFailureByKey` (rate limit por IP+e-mail, com chave própria `vinculo:`), auditoria e 2FA da outra conta quando ela tem. |
| Só a própria sessão confirma o 2FA do vínculo | O desafio guarda `VINCULO:<uid>` e a confirmação compara com `session.uid`. |
| Trocar de loja não amplia a sessão | O novo cookie mantém o `exp` da sessão atual: a troca não renova o prazo. |
| Trocar não pede o 2FA da outra conta | O 2FA já foi provado ao vincular, e a sessão atual passou pelo próprio login. A troca fica registrada em `AuditLog` (`LOJA_TROCADA`). |
| Visão "Todas" sem superadmin | As empresas vêm do banco a partir de `session.uid` (vínculos válidos). Cada loja roda em `runWithTenant({ empresaId, isSuperAdmin: false })`. Nada vem do cliente além de `lojas=todas`. |
| Troca de senha desfaz vínculos | §3.1, item 4. Alterar a senha, redefinir a senha ou "encerrar sessões" incrementa `sessionVersion`. |
| Mesma origem | `originViolationResponse` em `POST /api/lojas/vincular`, `/vincular/2fa`, `/api/auth/trocar-loja` e no `DELETE` de vínculo. |
| Abas abertas da loja antiga | Ao trocar, `BroadcastChannel("atlas-sessao")` avisa as outras abas, que recarregam. Isso evita a tela misturar o cabeçalho de uma loja com o cache da outra. |

Novos tipos de auditoria: `LOJA_VINCULADA`, `LOJA_DESVINCULADA`, `LOJA_TROCADA`.

## 5. APIs

| Rota | Quem | O que faz |
|---|---|---|
| `GET /api/lojas` | sessão | `{ atual: Loja, vinculadas: LojaVinculada[] }`. `Loja = { empresaId, nome, email, papel }` e `LojaVinculada = Loja & { vinculoId, vinculadaEm }`. As lojas vêm ordenadas por nome (pt-BR), ordem que também dá a cor de cada loja (§7.1). |
| `POST /api/lojas/vincular` `{ email, senha }` | sessão | Credenciais erradas → 401 `CREDENCIAIS_INVALIDAS`. Rate limit → 429 `MUITAS_TENTATIVAS`. Mesma empresa → 400 `MESMA_LOJA`. Com 2FA → `{ requires2FA, challengeId, metodo }`. Sem 2FA → cria o vínculo e devolve `{ loja }`. |
| `POST /api/lojas/vincular/2fa` `{ challengeId, codigo }` | sessão | Confere o desafio `VINCULO:<uid>`, com o mesmo limite de 5 tentativas do login, e cria o vínculo. |
| `DELETE /api/lojas/vinculos/[id]` | sessão | Desfaz o vínculo se a sessão for um dos dois lados. Caso contrário, devolve 404. |
| `POST /api/auth/trocar-loja` `{ empresaId }` | sessão | Acha a conta vinculada (válida) nessa empresa e reemite o cookie como essa conta, mantendo o `exp`. Sem vínculo → 404 `LOJA_NAO_VINCULADA`. |
| `GET /api/dashboard-ecommerce/{kpis,timeline,top-produtos}?lojas=todas` | sessão | O mesmo contrato de hoje, somado entre a loja aberta e as vinculadas (§6). Sem vínculo, devolve o mesmo resultado de uma loja só. |

## 6. Consolidação ("Todas")

O cálculo **por loja** continua o de hoje (`dashboardEcommerceService.obterKpis/obterTimeline/obterTopProdutos`), rodando dentro do tenant de cada loja. A soma é feita por funções **puras** em `src/modules/lojas/consolidado.ts`. Nunca se juntam as vendas cruas de lojas diferentes, porque imposto, ads e custos são configurados por loja.

### 6.1 KPIs

- **Somados:**
  - faturamento, frete, faturamento com frete;
  - reembolsado, faturamento com reembolsados;
  - líquido marketplace;
  - imposto Simples;
  - vendas, unidades;
  - ads, contas fixas;
  - sessões, page views, unidades pedidas, receita ordenada;
  - vendas sem custo, vendas com taxa estimada.
- **Lucro bruto, lucro pós-ads e custo total:** somados. Se **qualquer** loja vier `null` (custo incompleto), o total é `null`, como já acontece numa loja só.
- **Recalculados sobre as somas, nunca médias de percentuais:**

  | Indicador | Fórmula |
  |---|---|
  | margem | lucro ÷ faturamento |
  | ticket médio | faturamento ÷ vendas |
  | ROI | lucro ÷ custo |
  | TACoS | ads ÷ faturamento |
  | MPA | pós-ads ÷ faturamento |
  | MPA pós contas fixas | `calcularMpaPosContasFixas` |
  | ROI pós-ads | pós-ads ÷ custo |
  | conversão | unidades pedidas ÷ sessões |
  | buy box | média ponderada por sessões; média simples se não houver sessões; `null` se todas forem `null` |

- **Campos que não se somam:**
  - Imposto Simples (alíquota e ativo): vale o da loja aberta. O rótulo do card "Lucro" já fala da loja.
  - `valorAdsFonte`: igual entre as lojas → ele mesmo; diferente → a da loja com maior gasto. `valorAdsParcial` é `true` se qualquer loja for parcial.
  - `origemTaxas`: só `real` e/ou `nenhuma` → `real`; só `estimado` e/ou `nenhuma` → `estimado`; todas `nenhuma` → `nenhuma`; o resto → `misto`.
  - `categoriasTaxaEstimada`: juntadas pelo slug, com as vendas somadas.
- **`delta`:** a mesma regra de hoje (%, ou p.p. para percentuais), aplicada ao consolidado atual contra o consolidado do período anterior. A função `calcularDeltasKpis` sai da rota para o módulo e é usada nos dois casos.
- **`porLoja[]`**, para o bloco e a tabela "Por loja":
  - `{ empresaId, nome, atual, faturamentoCentavos, participacaoPercentual, lucroBrutoCentavos, margemPercentual, numeroVendas, mpaPercentual, vendasSemCusto }`;
  - `participacaoPercentual` = faturamento da loja ÷ faturamento somado. Com total 0, é `null`.

### 6.2 Timeline

Somada dia a dia, campo a campo. O lucro do dia é `null` se alguma loja vier `null`.

### 6.3 Top produtos

1. Cada loja devolve o seu top N.
2. O top N global está garantidamente dentro da união desses tops.
3. A chave é **(loja, sku)**: nunca se juntam SKUs de lojas diferentes.
4. A união é ordenada por faturado e cortada em N.
5. `representatividadePercentual` é recalculada sobre o faturamento **somado** das lojas. `obterTopProdutos` passa a expor o total que usa.
6. Cada item ganha `loja: { empresaId, nome, atual }`.
7. Nos itens de outra loja, `imagemUrl` vira `null`. A rota `/api/produtos/:id/imagem` é da loja aberta e daria 404, então a foto cai na imagem da Amazon (`amazonImagemUrl`/ASIN).

## 7. Interface

Tokens, classes e componentes são os do app, conforme o protótipo v2. Não há cor fora do tema, salvo as cores das lojas.

### 7.1 Cor de cada loja

A cor é fixa pela ordem das lojas por nome:
- 1ª: azul — ponto `bg-blue-500`, selo `bg-blue-100 text-blue-700 dark:bg-blue-900/55 dark:text-blue-300`;
- 2ª: violeta — ponto `bg-violet-500`, selo `bg-violet-100 text-violet-700 dark:bg-violet-900/55 dark:text-violet-300`;
- 3ª em diante: âmbar e depois verde-azulado, no mesmo padrão.

Como a ordem não depende de qual loja está aberta, a cor não troca entre as lojas.

### 7.2 Celular

- **Topo:** logo + nome da loja aberta + ⌄, num botão de ≥44 px de altura que abre a folha "Trocar de loja". Enquanto carrega, aparece a marca "Atlas Seller" de hoje.
- **Folha "Trocar de loja"** (`Sheet` inferior, no padrão da "Mais"):
  - título e subtítulo "Troca na hora, sem digitar senha.";
  - **Suas lojas:**
    - a aberta, com fundo `muted`, ✓ e "Aberta agora";
    - as outras com o e-mail e ›; tocar troca de loja e **mantém a seção aberta** (Vendas continua em Vendas; um produto ou pedido aberto volta para a lista, porque é da loja anterior). Isso foi decidido na implementação, porque troca rápida pede ficar onde se está.
  - **Visão:** "Ver as duas juntas" (ou "Ver todas juntas", com 3 ou mais), que abre o Início na aba Todas. Só aparece com vínculo.
  - **Vincular outra loja** → `/configuracoes?tab=lojas`.
- **Início:** as abas `Todas · Loja1 · Loja2` (`role="tablist"`) ficam entre o cabeçalho e o botão de período e só aparecem com vínculo.
  - **Todas:** muda para a visão consolidada. A escolha fica salva no aparelho (`localStorage`, chave `atlas:visao-inicio`).
  - **A loja aberta:** volta para a visão de uma loja.
  - **A outra loja:** troca de loja (§5) e abre o Início dela.
- **Bloco "Por loja"** (só em Todas), entre o MPA e o Top 15:
  - barra de participação;
  - uma linha por loja com ponto colorido, nome · participação, faturamento, "N vendas · lucro R$ X" e o selo de margem;
  - tocar numa linha abre aquela loja (troca, se for a outra).
- **Top 15 em Todas:**
  - subtítulo "por faturamento no período · Loja1 + Loja2";
  - selo da loja antes do "SKU · un · % do total";
  - tocar em produto de outra loja troca de loja e abre o produto.

### 7.3 Computador

- **Barra de cima:** à esquerda da busca, o botão do seletor.
  - No Início em Todas, mostra o ícone de camadas e "Todas as lojas"; fora disso, o ponto da loja e o nome dela.
  - O menu tem:
    - "Ver no dashboard";
    - "Todas as lojas", com ✓ quando ativa;
    - as lojas, com "aberta" na atual;
    - um separador;
    - "Vincular outra loja…".
  - "Todas as lojas" leva ao Início na visão consolidada.
  - Sem vínculo, o menu mostra só a loja e "Vincular outra loja…".
- **Início em Todas:**
  - os 8 KPIs e os 8 secundários consolidados;
  - a tabela "Por loja" (Loja · Faturamento · Lucro · Margem · Vendas · MPA, mais a linha **Total** em negrito) logo depois dos KPIs;
  - o gráfico e o Top 15 consolidados;
  - a coluna Produto do Top 15 mostra o selo da loja.

### 7.4 Configurações → Lojas

A aba aparece para **todos os papéis**, porque o vínculo é pessoal e cada login vincula o seu.

- **"Minhas lojas":**
  - a loja aberta ("Esta conta · <papel>");
  - as vinculadas, com e-mail e o botão "Desvincular", que pede confirmação.
- **"Vincular outra loja":**
  - campos de e-mail e senha;
  - quando a outra conta tem 2FA, o campo **Código de verificação** aparece **depois** do primeiro envio. Com 2FA por e-mail, o código só é enviado depois que a senha confere; por isso o campo não fica fixo na tela, como estava no protótipo;
  - botão "Vincular loja";
  - nota com cadeado: "Cada loja continua com o próprio login, avisos de venda e permissões. Dá para desvincular quando quiser.";
  - as mensagens de erro ficam perto do campo.

### 7.5 Aviso de venda de outra loja

Em `/vendas?pedido=…&loja=<empresaId>`:
- **Pedido de loja vinculada:** o app troca para ela uma vez só (guarda em `sessionStorage`) e volta para o mesmo endereço, sem pedir login.
- **Loja não vinculada:** continua o "Trocar de conta" de hoje.

## 8. Fora do escopo

- Consolidar Vendas, Produtos, DRE e o resto. Só o Início tem "Todas" (D5).
- Vínculo transitivo e grupos de lojas.
- Push e sino continuam por loja, como hoje: o aparelho já recebe as duas lojas.

## 9. Testes

- **Unitários, puros:**
  - `consolidarKpis`, `consolidarTimeline`, `consolidarTopProdutos`, `calcularDeltasKpis`;
  - regras de vínculo (ordem do par, validade, mesma loja);
  - ordem e cor das lojas.
- **Rotas (vitest, db mockado):**
  - `vincular`, `vincular/2fa` e `trocar-loja` (cookie com o `exp` mantido, 404 sem vínculo, finalidade errada recusada);
  - `2fa/verificar` recusando desafio de vínculo;
  - KPIs com `lojas=todas` rodando cada loja no próprio tenant.
- **E2E (Playwright, mobile):**
  - a folha "Trocar de loja" abre pelo topo;
  - as abas do Início aparecem com vínculo;
  - a aba "Lojas" mostra o formulário.
- **Conferência em produção (só leitura):** o consolidado de 30 dias = MundoFS + UDN (faturamento R$ 39.857,70 no protótipo, com os números do dia).

## 10. Implantação

1. `pg_dump` antes da migration.
2. Deploy normal: `prisma:migrate:deploy:pg` → `prisma:generate:pg` → build → `pm2 restart`.
3. A feature fica inerte até alguém vincular uma loja. Sem vínculo, só o nome da loja no topo muda.
