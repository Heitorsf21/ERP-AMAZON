# Duas lojas juntas — plano de implementação

> **Para quem executar:** use superpowers:executing-plans. As tarefas usam checkbox (`- [ ]`). Cada tarefa segue TDD: escrever o teste, ver o teste falhar, implementar, ver o teste passar e fazer o commit.

- **Objetivo:** vincular contas de lojas diferentes, trocar de loja sem login e ver o Início com as lojas somadas.
- **Arquitetura:**
  - O vínculo é par a par, num modelo GLOBAL (`VinculoLoja`).
  - A troca reemite o cookie de sessão como a conta vinculada, mantendo o `exp`.
  - O consolidado roda o service atual de cada loja em `runWithTenant` e soma com funções puras.
- **Stack:** Next.js 16 App Router, Prisma 5 (SQLite dev / Postgres prod), TanStack Query, Tailwind/shadcn, Vitest e Playwright.
- **Spec:** `docs/superpowers/specs/2026-10-07-duas-lojas-design.md`

## Restrições globais

- Dinheiro em centavos (`Int`). Fuso `America/Sao_Paulo`. Sem `console.log`: use o `pino` de `src/lib/logger.ts`.
- Next 16: `params` é `Promise` e sempre leva `await`.
- Migration Postgres feita à mão em `prisma/migrations/<ts>_<nome>/migration.sql`. O schema SQLite espelha.
- Todo modelo do schema está em `TENANT_MODELS` ou em `GLOBAL_MODELS`.
- Rotas que mudam estado chamam `originViolationResponse(req)` primeiro.
- Os textos da interface são em pt-BR, com acento.
- Validação só no que mudou: `npx eslint <arquivos>`, `npx tsc --noEmit` e `npx vitest run <arquivos>`.

## Foco da revisão (o que os testes não cobrem bem)

1. **Vínculo obsoleto:** depois de trocar a senha de qualquer lado, o vínculo deixa de aparecer e `trocar-loja` devolve 404.
2. **Período sem venda numa loja:** a participação dessa loja é 0%, a outra fica com 100% e a margem continua calculada.
3. **Custo incompleto em só uma loja:** lucro, margem e ROI de "Todas" ficam N/A, como numa loja só.
4. **Tocar duas vezes rápido em trocar:** a segunda troca não pode deixar o cliente com o cache misturado. A navegação é dura.
5. **Usuário sem vínculo:** o topo mostra o nome da loja, as abas não aparecem e `?lojas=todas` responde igual à visão de uma loja.

---

### Tarefa 1: schema, migration, modelo global e tipos de auditoria

**Arquivos:**
- `prisma/schema.prisma` e `prisma/schema.postgresql.prisma`: `VinculoLoja`, `CodigoVerificacao2FA.finalidade` e as relações em `Usuario`.
- `prisma/migrations/20261007200000_vinculo_lojas/migration.sql`.
- `src/lib/db.ts`: `"VinculoLoja"` em `GLOBAL_MODELS`.
- `src/modules/shared/domain.ts`: `LOJA_VINCULADA`, `LOJA_DESVINCULADA` e `LOJA_TROCADA`.

**Passos:**
- [ ] Teste em `src/lib/tenant-isolation.test.ts`: `GLOBAL_MODEL_NAMES.has("VinculoLoja")`. Deve falhar.
- [ ] Editar os schemas, criar a migration e mudar o `db.ts`. Rodar `npx prisma generate` nos dois schemas e depois o teste, que deve passar.
- [ ] Commit `feat(lojas): modelo VinculoLoja e finalidade do desafio 2FA`.

### Tarefa 2: regras puras de vínculo e de lojas

**Arquivos:** `src/modules/lojas/regras.ts` e `src/modules/lojas/regras.test.ts`.

**Produz:**
- `ordenarPar(a: string, b: string): { usuarioAId: string; usuarioBId: string }`
- `vinculoValido(v: { versaoA; versaoB }, a: ContaVinculo, b: ContaVinculo): boolean`, onde `ContaVinculo = { id; ativo; sessionVersion; empresaId; empresaAtiva }`
- `ordenarLojas<T extends { nome: string }>(lojas: T[]): T[]`, em ordem pt-BR e sem distinguir maiúsculas
- `CORES_LOJA` e `corDaLoja(indice: number)`, que devolve `{ ponto, selo }` com classes Tailwind

**Testes:**
- o par sai ordenado nos dois sentidos;
- `vinculoValido` é falso quando:
  - uma das contas está inativa;
  - uma das empresas está inativa;
  - as duas contas são da mesma empresa;
  - `versaoA` ou `versaoB` não bate com o `sessionVersion`;
- `vinculoValido` é verdadeiro quando tudo bate;
- `ordenarLojas` põe "MundoFS" antes de "UDN";
- `corDaLoja(0)` é azul e `corDaLoja(1)` é violeta;
- `corDaLoja(9)` não lança erro (as cores ciclam).

### Tarefa 3: consolidação pura

**Arquivos:** `src/modules/lojas/consolidado.ts` e `src/modules/lojas/consolidado.test.ts`.

**Produz:**
- `type KpisDashboard = Awaited<ReturnType<typeof dashboardEcommerceService.obterKpis>>`
- `calcularDeltasKpis(atual, anterior)`: a mesma saída do `delta` da rota de hoje, que sai da rota.
- `consolidarKpis(lojas: { loja: LojaRef; kpis: KpisDashboard }[], atualEmpresaId): KpisDashboard & { porLoja: PorLoja[] }`
- `consolidarTimeline(listas: TimelineItem[][]): TimelineItem[]`
- `consolidarTopProdutos(listas: { loja: LojaRef; produtos: TopProduto[]; totalFaturamentoCentavos: number }[], limit: number): (TopProduto & { loja: LojaRef & { atual: boolean } })[]`

**Testes:**
- a soma dos campos aditivos;
- a margem recalculada vem da soma e não da média;
- lucro `null` numa loja deixa o total `null` e a margem e o ROI `null`;
- `participacaoPercentual` (80,7/19,3 com 32172,26 e 7685,44);
- `participacao` `null` com faturamento total 0;
- `origemTaxas` (real+nenhuma → real, real+estimado → misto);
- `valorAdsFonte` igual → mantém;
- a buy box ponderada por sessões;
- a timeline somada por dia, com `null` se propagando;
- o top: chave (loja, sku), SKUs iguais de lojas diferentes não se fundem, corte em N, `representatividade` sobre o total somado e `imagemUrl` nula para a loja que não é a atual;
- `calcularDeltasKpis` com anterior 0 → `null`.

### Tarefa 4: desafio 2FA compartilhado

**Arquivos:**
- `src/modules/auth/desafio-2fa.ts` e o teste dele;
- `src/app/api/auth/login/route.ts` passa a usar o helper;
- `src/app/api/auth/2fa/verificar/route.ts` passa a usar o helper e recusa a finalidade errada.

**Produz:**
- `criarDesafio2FA(usuario: { id; email; nome; twoFactorEnabled; twoFactorMethod }, finalidade: string, assunto?: string): Promise<{ challengeId; metodo: "EMAIL" | "TOTP" } | null>`. Devolve `null` quando a conta não tem 2FA.
- `conferirDesafio2FA({ challengeId, codigo, finalidade, req }): Promise<{ ok: true; usuario: Usuario } | { ok: false; erro: string }>`. Os erros são `CODIGO_INVALIDO_OU_EXPIRADO`, `CHALLENGE_BLOQUEADO` e `CODIGO_INCORRETO`, e a contagem de tentativas e a auditoria seguem o que já existe.

**Testes:**
- sem 2FA → `null`;
- EMAIL cria o desafio com a `finalidade` e envia o e-mail;
- TOTP cria o desafio sem enviar e-mail;
- conferir com a finalidade diferente → `CODIGO_INVALIDO_OU_EXPIRADO` (sem gastar tentativa);
- código errado incrementa as tentativas;
- a 5ª tentativa bloqueia;
- o código certo marca `usadoEm`.

### Tarefa 5: serviço de vínculos (DB)

**Arquivos:** `src/modules/lojas/vinculos.ts` e o teste dele, com o db mockado.

**Produz:**
- `listarLojas(usuarioId): Promise<{ atual: Loja; vinculadas: LojaVinculada[] }>`
- `criarVinculo(solicitanteId: string, alvoId: string): Promise<LojaVinculada>`. Lança `ErroVinculo("MESMA_LOJA")`.
- `removerVinculo(usuarioId, vinculoId): Promise<boolean>`
- `contaVinculadaNaEmpresa(usuarioId, empresaId): Promise<Usuario | null>`

**Testes:**
- a lista ignora vínculos inválidos;
- aparece o lado oposto de cada vínculo;
- a lista sai ordenada por nome;
- `criarVinculo` faz upsert com as versões atuais;
- `criarVinculo` com a mesma empresa → `MESMA_LOJA`;
- `removerVinculo` de terceiro → `false`;
- `contaVinculadaNaEmpresa` sem vínculo válido → `null`.

### Tarefa 6: rotas de lojas

**Arquivos:**
- `src/app/api/lojas/route.ts` (GET);
- `src/app/api/lojas/vincular/route.ts` (POST);
- `src/app/api/lojas/vincular/2fa/route.ts` (POST);
- `src/app/api/lojas/vinculos/[id]/route.ts` (DELETE);
- os testes de cada uma.

**Testes:**
- senha errada → 401 e falha registrada;
- rate limit → 429;
- e-mail inexistente → 401 (com o dummy compare);
- alvo com 2FA → `requires2FA` com finalidade `VINCULO:<uid>`;
- alvo sem 2FA → 200 com a loja e auditoria `LOJA_VINCULADA`;
- 2FA de outra sessão → 401;
- DELETE de vínculo alheio → 404.

### Tarefa 7: trocar de loja

**Arquivos:** `src/app/api/auth/trocar-loja/route.ts` e o teste dele.

**Testes:**
- sem vínculo → 404 `LOJA_NAO_VINCULADA`;
- com vínculo → `Set-Cookie` com o uid da outra conta, o `empresaId` dela, `v` igual ao `sessionVersion` dela e o `exp` da sessão atual;
- cookie `maxAge` = `exp − agora`;
- auditoria `LOJA_TROCADA`;
- origem inválida → 403.

### Tarefa 8: dashboard com `?lojas=todas`

**Arquivos:**
- `src/modules/dashboard-ecommerce/service.ts`: `obterTopProdutosComTotal` (o `obterTopProdutos` atual vira um wrapper dele);
- `src/modules/lojas/visao-todas.ts`: `lojasDaVisaoTodas(session)` e `porLoja(lojas, fn)` com `runWithTenant`;
- as 3 rotas do dashboard;
- `src/app/api/dashboard-ecommerce/kpis/route.test.ts`.

**Testes:**
- com `lojas=todas` e um vínculo, o service é chamado uma vez por loja e período, e `getEmpresaId()` dentro de cada chamada é o da loja;
- a resposta traz `porLoja`;
- sem `lojas=todas`, só a loja da sessão;
- sem vínculo, `lojas=todas` dá o mesmo resultado de uma loja (sem `porLoja`, ou com uma só).

### Tarefa 9: infraestrutura do cliente

**Arquivos:**
- `src/components/lojas/use-lojas.ts`: `useLojas()` e `useTrocarLoja()`;
- `src/components/lojas/visao-inicio.ts`: store com `useSyncExternalStore` e `localStorage` protegido;
- `src/components/lojas/sessao-sync.tsx`: listener do `BroadcastChannel` que recarrega, montado no `Providers`.

**Testes:** `visao-inicio.test.ts` com as funções puras de leitura e gravação: valor inválido → `"loja"`, e o `localStorage` que lança erro não quebra.

### Tarefa 10: topo e folha de troca

**Arquivos:**
- `src/components/lojas/trocar-loja-sheet.tsx`;
- `src/components/lojas/seletor-loja.tsx`: `SeletorLojaMobile` e `SeletorLojaDesktop`;
- `src/components/topbar.tsx`.

Seguir o protótipo, com o fallback para a `BrandMark` enquanto carrega.

### Tarefa 11: Início ("Todas", "Por loja" e selo)

**Arquivos:**
- `src/components/lojas/abas-lojas.tsx`;
- `src/components/lojas/por-loja.tsx`: `PorLojaMobile` e `PorLojaTabela`;
- `src/components/lojas/selo-loja.tsx`;
- `src/components/dashboard-ecommerce/dashboard-mobile.tsx`;
- `src/app/dashboard-ecommerce/page.tsx`.

### Tarefa 12: Configurações → Lojas

**Arquivos:** `src/components/configuracoes/lojas-section.tsx` e `src/app/configuracoes/page.tsx` (aba `lojas` para todos os papéis).

### Tarefa 13: aviso de venda de outra loja

**Arquivos:**
- `src/modules/vendas/pedido-param.ts`: `deveTrocarParaLojaDoPedido`;
- `src/app/vendas/page.tsx`.

**Teste:** a função pura troca só quando a loja é vinculada e ainda não foi tentada.

### Tarefa 14: E2E, documentação e verificação final

- `tests/e2e/mobile-lojas.spec.ts`: com as APIs mockadas, a folha abre pelo topo, as abas aparecem e a aba Lojas mostra o formulário.
- `CLAUDE.md`: uma seção "Duas lojas".
- Rodar lint, tsc, vitest dos arquivos tocados e `npm run build`.
- Revisão final da branch por um revisor em contexto novo.
