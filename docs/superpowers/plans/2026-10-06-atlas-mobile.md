# Atlas Seller Mobile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o Atlas Seller instalável no celular (PWA), com menu personalizável por usuário, telas mobile para Dashboard/Vendas/Produtos, aviso de venda por push em segundos (sem nome de produto, com o nome da loja) e alteração de custo e de preço pelo celular.

**Architecture:** Next.js 16 App Router no mesmo app, sem app nativo. O menu vem de `nav-routes.ts` filtrado por uma preferência por usuário (`ConfiguracaoSistema`). O PWA usa `app/manifest.ts` + `public/sw.js` escrito à mão, **sem cache**. O push usa `web-push` com VAPID e dispara no consumidor SQS (`ORDER_CHANGE`), com o ORDERS_SYNC como reserva. A idempotência fica numa tabela `PushEnvio`. Para o preço, o anúncio é alterado via Listings Items API (`patchListingsItem`).

**Tech Stack:** Next.js 16.2 · React 18 · TypeScript · Prisma 5.22 (SQLite dev / Postgres prod) · TanStack Query 5 · Tailwind 3.4 · Radix/shadcn · lucide-react · sonner · zod · vitest · Playwright · `web-push` · `sharp`.

**Spec:** `docs/superpowers/specs/2026-10-06-atlas-mobile-pwa-design.md` (revisão 3). Protótipo visual aprovado: https://claude.ai/artifact/5wJonxEZqt2bua6JtDNky4

## Global Constraints

- **Workspace:** trabalhar numa worktree em `C:\Projects\ERP-AMAZON-mobile`, branch `feat/atlas-mobile` criada a partir de `origin/feat/multitenant-fase0-seguranca` (a trunk que a produção usa). Não tocar nas mudanças não commitadas de `src/modules/vendas/breakdown-parser*.ts` da worktree principal.
- **Next 16:** `params` é `Promise` nas rotas: `const { id } = await params;`. Nunca `params.id` direto.
- **Logs:** pino `logger` de `@/lib/logger`, nunca `console.log` em código novo.
- **Dinheiro:** centavos (`Int`). Fuso `America/Sao_Paulo`.
- **Campos sagrados:** NUNCA gravar estimativa em `VendaAmazon.taxasCentavos` / `fretesCentavos` / `liquidoMarketplaceCentavos`. O push só lê.
- **Tenant:** todo modelo novo entra em `TENANT_MODELS` ou `GLOBAL_MODELS` (`src/lib/db.ts`).
  - `PushDispositivo` → **GLOBAL**, com filtro explícito por `empresaId`/`usuarioId`.
  - `PushEnvio` → **TENANT**.
  - Em modelos TENANT, buscar por chave natural com `findFirst`, nunca `findUnique`.
- **Schema duplo:** mudanças em `prisma/schema.prisma` (SQLite) **e** `prisma/schema.postgresql.prisma`. JSON guardado como `String` nos dois.
  - Migration Postgres escrita à mão em `prisma/migrations/<YYYYMMDDhhmmss>_<nome>/migration.sql` (sem `migrate dev` no PG).
- **Testes:** vitest roda só `src/**/*.test.ts`, ambiente node. Mock de banco com `vi.mock("@/lib/db", () => ({ db: dbMock }))`.
  - Validar só o que mudou: `npx vitest run <arquivo>`, `npx eslint <arquivos>`, `npx tsc --noEmit`. Nunca `npm run test` cego.
- **Arquivos editados na VPS por outro processo:** `src/lib/amazon-sqs.ts` recebe só a chamada de push (mínimo). `src/lib/amazon-sp-api.ts` **não é editado**: código novo vai em arquivo novo.
- **Abas fixas** (não podem ser escondidas): `/dashboard-ecommerce`, `/vendas`, `/produtos`, `/configuracoes`.
- **Chave da preferência de menu:** `menu_abas_ocultas:u:<usuarioId>` em `ConfiguracaoSistema` (JSON `string[]` de hrefs).
- **Texto do push:**
  - título `Nova venda na <Empresa.nome>`;
  - corpo `Você teve uma nova venda de R$ 204,97.`; com `~R$` quando estimado; `Você teve uma nova venda.` sem valor;
  - agrupado `N novas vendas na <loja>` / `Total de R$ X.`;
  - **NUNCA** nome do produto, SKU ou quantidade.
- **Regras do push:**
  - recência de 2 h pelo `PurchaseDate`;
  - ignora `Canceled`;
  - agrupa quando houver **mais de 3** pedidos novos na mesma execução do ORDERS_SYNC;
  - dedupe `venda:<amazonOrderId>` por empresa.
- **Service worker:** sem handler de `fetch` e sem cache.
- **VAPID:** `VAPID_SUBJECT` padrão = `https://erp.mundofs.cloud` (não usar e-mail pessoal).
- **Textos de UI** em pt-BR com acentuação correta.
- **Deploy de produção** segue o CLAUDE.md com estas ressalvas:
  - `pm2 restart` (não `reload`) em `erp-web`, `erp-worker` e `erp-sqs-consumer`;
  - `prisma:generate:pg` antes do build;
  - stash dos arquivos que o n8n edita antes do pull;
  - backup `pg_dump` antes da migration.

## Review Focus

1. **Mesmo celular em duas lojas** (MundoFS e UDN): cada venda chega só pela inscrição da própria loja, com o nome certo. Remover o aparelho de uma loja não derruba a outra. → testes em Task 14 (`dispositivos`) e Task 13 (`entregar` filtra por `empresaId`).
2. **Mudança de status de pedido já avisado** (Pending → Unshipped → Shipped) e ORDERS_SYNC depois do SQS: nunca avisa duas vezes. → testes em Task 15 (`reservarEnvio` devolve `null` → nada é entregue).
3. **Primeira conexão / worker voltando de queda com pedidos antigos:** zero avisos para pedidos com mais de 2 h. Rajada de mais de 3 pedidos novos vira **um** aviso agrupado. → testes em Task 12 (`pedidoNotificavel`) e Task 15 (agrupamento).
4. **PUT forjado tentando esconder aba fixa ou href desconhecido:** é descartado. Aba escondida continua abrindo por URL e por link de notificação. → testes em Task 1 e Task 2.
5. **Preço digitado errado** (R$ 7,70 em vez de R$ 77,00): exige segunda confirmação. 403 da Amazon devolve mensagem clara e não atualiza o cache. → testes em Task 18 (`precisaConfirmarVariacao`, `ehErroPermissaoListing`) e na rota (Task 19).

---

## File Structure

**Fase 1: menu personalizável**

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/menu/preferencias.ts` (+ `.test.ts`) | regras puras: fixas, sanitização, filtro de grupos, sugestão |
| `src/modules/menu/service.ts` (+ `.test.ts`) | ler/gravar a preferência em `ConfiguracaoSistema` |
| `src/app/api/menu/preferencias/route.ts` | GET/PUT da preferência do usuário da sessão |
| `src/components/menu/use-menu-visivel.ts` | hooks React Query (`useMenuOcultas`, `useMenuVisivel`, `useSalvarMenu`) |
| `src/components/configuracoes/menu-section.tsx` | aba "Menu" em Configurações |
| Modificar: `src/components/nav-routes.ts` | exporta `HREFS_NAV` |
| Modificar: `src/components/sidebar.tsx` | consome o menu visível |
| Modificar: `src/components/command-palette.tsx` | consome o menu visível |
| Modificar: `src/app/configuracoes/page.tsx` | aba "Menu" + `?tab=menu` |
| Modificar: `src/modules/shared/domain.ts` | novos `TipoAuditLog` |

**Fase 2: PWA + shell + telas mobile**

| Arquivo | Responsabilidade |
|---|---|
| `scripts/gerar-icones-pwa.mjs` → `public/icons/*.png`, `src/app/apple-icon.png` | ícones do app instalável |
| `src/app/manifest.ts` | Web App Manifest |
| `public/sw.js` | service worker: push + clique, sem cache |
| `src/lib/pwa/plataforma.ts` (+ `.test.ts`) | detectar iOS/Android/standalone |
| `src/lib/pwa/refetch.ts` (+ `.test.ts`) | quais queries recarregar ao voltar ao app |
| `src/lib/use-media-query.ts` | hook de media query |
| `src/components/pwa/pwa-provider.tsx` | registra SW, captura `beforeinstallprompt`, expõe `usePwa()` |
| `src/components/pwa/instalar-sheet.tsx` | passo a passo de instalação (iPhone/Android) |
| `src/components/pwa/banner-instalar.tsx` | banner dispensável no dashboard mobile |
| `src/components/mobile/bottom-nav.tsx` | barra inferior (Início, Vendas, Produtos, Mais) |
| `src/components/mobile/mais-sheet.tsx` | folha "Mais" |
| `src/components/auth/use-logout.tsx` | logout compartilhado (topbar + Mais) |
| `src/components/ui/toaster-responsivo.tsx` | toasts no topo-centro no celular |
| `src/modules/dashboard-ecommerce/kpis-mobile.ts` (+ `.test.ts`) | 6 KPIs + MPA formatados |
| `src/components/dashboard-ecommerce/dashboard-mobile.tsx` | KPIs + Top 15 em cards |
| `src/modules/vendas/pedido-param.ts` (+ `.test.ts`) | valida `?pedido=` |
| `src/modules/produtos/resumo-mobile.ts` (+ `.test.ts`) | lucro por unidade e parse de valor BRL (puro, client-safe) |
| `src/modules/produtos/cobertura.ts` (+ `.test.ts`) | cobertura de estoque (server) |
| `src/app/api/produtos/[id]/resumo-mobile/route.ts` | dados do detalhe mobile |
| `src/components/produtos/produto-mobile.tsx` | detalhe do produto no celular |
| `src/components/produtos/alterar-custo-sheet.tsx` | folha "Alterar custo" |
| Modificar (Task 10B) | `lista-produtos.tsx` e `card-resumo-estoque.tsx` (cards e resumo compacto no celular); `whatsapp-estoque/schemas.ts` recebe `classificarFaixa` |
| Modificar | `layout.tsx`, `providers.tsx`, `app-shell.tsx`, `topbar.tsx`, `proxy.ts`, `next.config.mjs`, `dashboard-ecommerce/page.tsx`, `vendas/page.tsx`, `api/vendas/route.ts`, `components/vendas/order-card*.tsx`, `produtos/[id]/page.tsx`, `agenda-view.tsx`, `dre/page.tsx`, `notification-bell.tsx` |

**Fase 3: push de venda**

| Arquivo | Responsabilidade |
|---|---|
| Prisma | `PushDispositivo` (GLOBAL), `PushEnvio` (TENANT) + migration `20261007120000_push_mobile` |
| `src/modules/push/regras.ts` (+ `.test.ts`) | puro: payloads, recência, resumo do ORDER_CHANGE, agrupamento |
| `src/modules/push/envio.ts` (+ `.test.ts`) | VAPID, reserva idempotente, entrega, limpeza de inscrição morta |
| `src/modules/push/loja.ts` | nome da loja (`Empresa.nome`) com cache |
| `src/modules/push/dispositivos.ts` (+ `.test.ts`) | inscrever/listar/atualizar/remover aparelhos |
| `src/modules/push/vendas.ts` (+ `.test.ts`) | gatilhos SQS e ORDERS_SYNC |
| `src/app/api/push/config/route.ts`, `dispositivos/route.ts`, `teste/route.ts` | API |
| `src/lib/push/cliente.ts` (+ `.test.ts`) | helpers de browser + estado |
| `src/components/push/use-push.ts` | hook do celular |
| `src/components/configuracoes/neste-celular-section.tsx` | card "Neste celular" |
| `src/modules/amazon/sqs-cobertura.ts` (+ `.test.ts`) | empresa recebe ORDER_CHANGE? → intervalo do ORDERS_SYNC |
| Modificar | `amazon-sqs.ts` (1 chamada), `amazon/service.ts` (coleta das vendas criadas), `amazon/jobs.ts` (intervalo por empresa), `scripts/setup-sqs-subscriptions.ts` (`--empresa=`), `db.ts`, `tenant-isolation.test.ts`, `use-logout.tsx` (pergunta ao sair), `configuracoes/page.tsx` |

**Fase 4: preço na Amazon**

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/amazon/listings-preco.ts` (+ `.test.ts`) | patch do `purchasable_offer`, trava de variação, erro de permissão |
| `scripts/verificar-permissao-preco.ts` | teste `VALIDATION_PREVIEW` (sem efeito) |
| `src/app/api/produtos/[id]/preco-amazon/route.ts` | POST (ADMIN) |
| `src/components/produtos/alterar-preco-sheet.tsx` | folha "Alterar preço na Amazon" |
| Modificar | `src/lib/amazon-rate-limit.ts` (`LISTINGS_PATCH_ITEM`), `produto-mobile.tsx` |

**Fechamento**

| Arquivo | Responsabilidade |
|---|---|
| `tests/e2e/mobile-shell.spec.ts` + `playwright.config.ts` (project `mobile`) | e2e mobile |
| `CLAUDE.md` | documentação |

---

## Task 0: Workspace isolado

**Files:** nenhum arquivo de código.

- [ ] **Step 1: Criar a worktree a partir da trunk de produção**

```bash
cd /c/Projects/ERP-AMAZON
git fetch origin
git worktree add -b feat/atlas-mobile ../ERP-AMAZON-mobile origin/feat/multitenant-fase0-seguranca
cd ../ERP-AMAZON-mobile
git log --oneline -1
```
Expected: o último commit é `b8ef25e fix(amazon): 5 falhas recorrentes de sync…` (ou mais novo, se a trunk andou).

- [ ] **Step 2: Instalar dependências e gerar o client SQLite**

```bash
cd /c/Projects/ERP-AMAZON-mobile
cp ../ERP-AMAZON/.env .env 2>/dev/null || true
npm install --no-audit --no-fund
npm run prisma:generate
```
Expected: `✔ Generated Prisma Client`.

- [ ] **Step 3: Linha de base verde nos testes que esta feature vai tocar**

```bash
npx vitest run src/lib/tenant-isolation.test.ts src/modules/configuracao/imposto-simples.test.ts
```
Expected: PASS. Se falhar antes de qualquer mudança, parar e reportar, porque não é regressão desta feature.

- [ ] **Step 4: Levar spec e plano para a worktree (eles só existem, não commitados, na pasta principal)**

```bash
mkdir -p docs/superpowers/specs docs/superpowers/plans
mv ../ERP-AMAZON/docs/superpowers/specs/2026-10-06-atlas-mobile-pwa-design.md docs/superpowers/specs/
mv ../ERP-AMAZON/docs/superpowers/plans/2026-10-06-atlas-mobile.md docs/superpowers/plans/
git add docs/superpowers/specs/2026-10-06-atlas-mobile-pwa-design.md docs/superpowers/plans/2026-10-06-atlas-mobile.md
git commit -m "docs: spec e plano do Atlas mobile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Mover, não copiar: assim o `git pull` futuro da pasta principal não esbarra em arquivos não rastreados com o mesmo caminho.

> **A partir daqui, todos os caminhos são relativos a `C:\Projects\ERP-AMAZON-mobile`.**

---

# FASE 1 — Menu personalizável por usuário

## Task 1: Regras puras do menu

**Files:**
- Create: `src/modules/menu/preferencias.ts`
- Create: `src/modules/menu/preferencias.test.ts`
- Modify: `src/components/nav-routes.ts` (final do arquivo)

**Interfaces:**
- Produces:
  - `HREFS_FIXOS: readonly string[]`
  - `chaveMenuUsuario(usuarioId: string): string`
  - `ehFixo(href: string): boolean`
  - `parseOcultas(valor: string | null | undefined): string[]`
  - `sanitizarOcultas(ocultas: readonly string[], hrefsConhecidos: readonly string[]): string[]`
  - `ocultasDaSugestao(hrefsConhecidos: readonly string[]): string[]`
  - `filtrarGruposVisiveis<I extends { href: string }, G extends { items: readonly I[] }>(grupos: readonly G[], ocultas: readonly string[]): Array<G & { items: I[] }>`
  - `contarVisiveis(hrefsConhecidos: readonly string[], ocultas: readonly string[]): number`
  - `HREFS_NAV: string[]` (em `nav-routes.ts`)

- [ ] **Step 1: Escrever o teste que falha**

`src/modules/menu/preferencias.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  chaveMenuUsuario,
  contarVisiveis,
  ehFixo,
  filtrarGruposVisiveis,
  ocultasDaSugestao,
  parseOcultas,
  sanitizarOcultas,
} from "./preferencias";

const HREFS = [
  "/home",
  "/agenda",
  "/caixa",
  "/dashboard-ecommerce",
  "/produtos",
  "/vendas",
  "/perfil",
  "/configuracoes",
];

describe("menu personalizável por usuário", () => {
  it("chave da preferência é escopada pelo usuário", () => {
    expect(chaveMenuUsuario("u1")).toBe("menu_abas_ocultas:u:u1");
  });

  it("as 4 abas do núcleo são fixas", () => {
    expect(ehFixo("/dashboard-ecommerce")).toBe(true);
    expect(ehFixo("/vendas")).toBe(true);
    expect(ehFixo("/produtos")).toBe(true);
    expect(ehFixo("/configuracoes")).toBe(true);
    expect(ehFixo("/agenda")).toBe(false);
  });

  it("parse tolera vazio, lixo e tipos errados", () => {
    expect(parseOcultas(null)).toEqual([]);
    expect(parseOcultas("")).toEqual([]);
    expect(parseOcultas("nao-json")).toEqual([]);
    expect(parseOcultas('{"a":1}')).toEqual([]);
    expect(parseOcultas('["/caixa", 3, null]')).toEqual(["/caixa"]);
  });

  it("sanitiza: descarta desconhecidos, fixos e repetidos, na ordem do menu", () => {
    expect(
      sanitizarOcultas(["/vendas", "/caixa", "/xpto", "/agenda", "/caixa"], HREFS),
    ).toEqual(["/agenda", "/caixa"]);
  });

  it("PUT forjado não esconde aba fixa", () => {
    expect(
      sanitizarOcultas(
        ["/dashboard-ecommerce", "/vendas", "/produtos", "/configuracoes"],
        HREFS,
      ),
    ).toEqual([]);
  });

  it("sugestão esconde tudo que não é fixo", () => {
    expect(ocultasDaSugestao(HREFS)).toEqual(["/home", "/agenda", "/caixa", "/perfil"]);
  });

  it("filtra itens ocultos e remove grupo que ficou vazio", () => {
    const grupos = [
      { id: "fin", items: [{ href: "/agenda" }, { href: "/caixa" }] },
      { id: "eco", items: [{ href: "/dashboard-ecommerce" }, { href: "/vendas" }] },
    ];
    const r = filtrarGruposVisiveis(grupos, ["/agenda", "/caixa", "/vendas"]);
    expect(r.map((g) => g.id)).toEqual(["eco"]);
    // /vendas é fixa: continua mesmo pedida como oculta
    expect(r[0]?.items.map((i) => i.href)).toEqual(["/dashboard-ecommerce", "/vendas"]);
  });

  it("conta abas visíveis ignorando ocultas inválidas", () => {
    expect(contarVisiveis(HREFS, ["/agenda", "/vendas"])).toBe(7);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/menu/preferencias.test.ts`
Expected: FAIL com `Failed to resolve import "./preferencias"`.

- [ ] **Step 3: Implementar**

`src/modules/menu/preferencias.ts`:
```ts
// Regras puras do menu personalizável por usuário (Atlas mobile, Fase 1).
// Sem React/ícones: recebe e devolve hrefs, para valer igual no servidor
// (validação do PUT) e no cliente (filtro da sidebar, busca e folha "Mais").

/** Abas que nunca saem do menu. Configurações fica para sempre poder reativar o resto. */
export const HREFS_FIXOS: readonly string[] = [
  "/dashboard-ecommerce",
  "/vendas",
  "/produtos",
  "/configuracoes",
];

const FIXOS = new Set<string>(HREFS_FIXOS);

export function chaveMenuUsuario(usuarioId: string): string {
  return `menu_abas_ocultas:u:${usuarioId}`;
}

export function ehFixo(href: string): boolean {
  return FIXOS.has(href);
}

/** Lê o valor salvo (JSON de string[]). Qualquer coisa inválida vira []. */
export function parseOcultas(valor: string | null | undefined): string[] {
  if (!valor) return [];
  try {
    const parsed: unknown = JSON.parse(valor);
    return Array.isArray(parsed)
      ? parsed.filter((h): h is string => typeof h === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Normaliza as abas ocultas: só hrefs conhecidos, nunca as fixas, sem repetição
 * e na ordem do menu (estável para comparar e salvar).
 */
export function sanitizarOcultas(
  ocultas: readonly string[],
  hrefsConhecidos: readonly string[],
): string[] {
  const pedidas = new Set(ocultas);
  return hrefsConhecidos.filter((href) => pedidas.has(href) && !FIXOS.has(href));
}

/** O que o atalho "Usar sugestão" esconde: tudo que não é fixo. */
export function ocultasDaSugestao(hrefsConhecidos: readonly string[]): string[] {
  return hrefsConhecidos.filter((href) => !FIXOS.has(href));
}

/** Remove itens ocultos dos grupos (fixos nunca saem) e descarta grupos vazios. */
export function filtrarGruposVisiveis<
  I extends { href: string },
  G extends { items: readonly I[] },
>(grupos: readonly G[], ocultas: readonly string[]): Array<G & { items: I[] }> {
  const set = new Set(ocultas);
  return grupos
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !set.has(i.href) || FIXOS.has(i.href)),
    }))
    .filter((g) => g.items.length > 0);
}

export function contarVisiveis(
  hrefsConhecidos: readonly string[],
  ocultas: readonly string[],
): number {
  const set = new Set(sanitizarOcultas(ocultas, hrefsConhecidos));
  return hrefsConhecidos.filter((h) => !set.has(h)).length;
}
```

No final de `src/components/nav-routes.ts`, acrescentar:
```ts

/** Todos os hrefs do menu (Home + grupos), na ordem da sidebar. */
export const HREFS_NAV: string[] = ALL_NAV_ITEMS.map((item) => item.href);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/menu/preferencias.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/menu/preferencias.ts src/modules/menu/preferencias.test.ts src/components/nav-routes.ts
git commit -m "feat(menu): regras puras do menu personalizável por usuário

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Serviço e API da preferência de menu

**Files:**
- Create: `src/modules/menu/service.ts`
- Create: `src/modules/menu/service.test.ts`
- Create: `src/app/api/menu/preferencias/route.ts`
- Modify: `src/modules/shared/domain.ts` (objeto `TipoAuditLog`, ~L247-260)

**Interfaces:**
- Consumes: Task 1 (`chaveMenuUsuario`, `parseOcultas`, `sanitizarOcultas`, `HREFS_NAV`).
- Produces:
  - `lerOcultas(usuarioId: string): Promise<string[]>`
  - `salvarOcultas(usuarioId: string, ocultas: readonly string[]): Promise<string[]>`
  - `GET /api/menu/preferencias` → `{ ocultas: string[] }`
  - `PUT /api/menu/preferencias` body `{ ocultas: string[] }` → `{ ocultas: string[] }`
  - `TipoAuditLog.MENU_ATUALIZADO`, `PRECO_AMAZON_ALTERADO`, `PUSH_DISPOSITIVO_ATIVADO`, `PUSH_DISPOSITIVO_REMOVIDO`

- [ ] **Step 1: Escrever o teste que falha**

`src/modules/menu/service.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    configuracaoSistema: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import { lerOcultas, salvarOcultas } from "./service";

describe("preferência de menu no banco", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.configuracaoSistema.upsert.mockResolvedValue({});
  });

  it("sem linha salva, nada fica oculto", async () => {
    dbMock.configuracaoSistema.findUnique.mockResolvedValue(null);
    expect(await lerOcultas("u1")).toEqual([]);
    expect(dbMock.configuracaoSistema.findUnique).toHaveBeenCalledWith({
      where: { chave: "menu_abas_ocultas:u:u1" },
    });
  });

  it("ao ler, descarta hrefs que saíram do menu e abas fixas", async () => {
    dbMock.configuracaoSistema.findUnique.mockResolvedValue({
      valor: JSON.stringify(["/caixa", "/aba-removida", "/vendas"]),
    });
    expect(await lerOcultas("u1")).toEqual(["/caixa"]);
  });

  it("ao salvar, grava só o que é válido e devolve a lista limpa", async () => {
    const r = await salvarOcultas("u2", ["/vendas", "/dre", "/agenda", "/dre", "/x"]);
    expect(r).toEqual(["/agenda", "/dre"]);
    expect(dbMock.configuracaoSistema.upsert).toHaveBeenCalledWith({
      where: { chave: "menu_abas_ocultas:u:u2" },
      create: { chave: "menu_abas_ocultas:u:u2", valor: '["/agenda","/dre"]' },
      update: { valor: '["/agenda","/dre"]' },
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/menu/service.test.ts`
Expected: FAIL com `Failed to resolve import "./service"`.

- [ ] **Step 3: Implementar o serviço**

`src/modules/menu/service.ts`:
```ts
import { db } from "@/lib/db";
import { HREFS_NAV } from "@/components/nav-routes";
import { chaveMenuUsuario, parseOcultas, sanitizarOcultas } from "./preferencias";

// ConfiguracaoSistema é GLOBAL; a chave carrega o id do usuário (único entre
// empresas), então não há como um usuário ler o menu de outro.
export async function lerOcultas(usuarioId: string): Promise<string[]> {
  const row = await db.configuracaoSistema.findUnique({
    where: { chave: chaveMenuUsuario(usuarioId) },
  });
  return sanitizarOcultas(parseOcultas(row?.valor), HREFS_NAV);
}

export async function salvarOcultas(
  usuarioId: string,
  ocultas: readonly string[],
): Promise<string[]> {
  const limpas = sanitizarOcultas(ocultas, HREFS_NAV);
  const chave = chaveMenuUsuario(usuarioId);
  const valor = JSON.stringify(limpas);
  await db.configuracaoSistema.upsert({
    where: { chave },
    create: { chave, valor },
    update: { valor },
  });
  return limpas;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/menu/service.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Novos tipos de auditoria**

Em `src/modules/shared/domain.ts`, dentro de `export const TipoAuditLog = {`, logo depois de `FBM_PICKING_ATUALIZADO: "FBM_PICKING_ATUALIZADO",`:
```ts
  MENU_ATUALIZADO: "MENU_ATUALIZADO",
  PRECO_AMAZON_ALTERADO: "PRECO_AMAZON_ALTERADO",
  PUSH_DISPOSITIVO_ATIVADO: "PUSH_DISPOSITIVO_ATIVADO",
  PUSH_DISPOSITIVO_REMOVIDO: "PUSH_DISPOSITIVO_REMOVIDO",
```

- [ ] **Step 6: Rota**

`src/app/api/menu/preferencias/route.ts`:
```ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { TipoAuditLog } from "@/modules/shared/domain";
import { lerOcultas, salvarOcultas } from "@/modules/menu/service";

export const dynamic = "force-dynamic";

const putSchema = z.object({
  ocultas: z.array(z.string().max(100)).max(50),
});

// Preferência pessoal: qualquer usuário logado lê e grava SÓ a própria.
export const GET = handle(async () => {
  const session = await requireSession();
  return ok({ ocultas: await lerOcultas(session.uid) });
});

export const PUT = handle(async (req: NextRequest) => {
  const session = await requireSession();
  const body = putSchema.parse(await req.json());
  const antes = await lerOcultas(session.uid);
  const ocultas = await salvarOcultas(session.uid, body.ocultas);
  await auditLog({
    session,
    req,
    acao: TipoAuditLog.MENU_ATUALIZADO,
    entidade: "Usuario",
    entidadeId: session.uid,
    antes: { ocultas: antes },
    depois: { ocultas },
  });
  return ok({ ocultas });
});
```

- [ ] **Step 7: Lint e typecheck dos arquivos tocados**

Run: `npx eslint src/modules/menu src/app/api/menu src/modules/shared/domain.ts && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add src/modules/menu/service.ts src/modules/menu/service.test.ts src/app/api/menu/preferencias/route.ts src/modules/shared/domain.ts
git commit -m "feat(menu): API da preferência de menu por usuário

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Menu filtrado na sidebar e na busca

**Files:**
- Create: `src/components/menu/use-menu-visivel.ts`
- Modify: `src/components/sidebar.tsx` (`SidebarContent`, ~L250-310)
- Modify: `src/components/command-palette.tsx` (`CommandPaletteDialog`, memo `flat` ~L205-270)

**Interfaces:**
- Consumes: Task 1 (`filtrarGruposVisiveis`), Task 2 (`GET/PUT /api/menu/preferencias`).
- Produces:
  - `MENU_QUERY_KEY = ["menu-preferencias"]`
  - `useMenuOcultas(): UseQueryResult<{ ocultas: string[] }>`
  - `useMenuVisivel(): { ocultas: string[]; homeVisivel: boolean; grupos: Array<NavGroup & { items: NavLeaf[] }>; itens: Array<NavLeaf & { group: string }> }`
  - `useSalvarMenu(): UseMutationResult<{ ocultas: string[] }, Error, string[]>`, com update otimista

- [ ] **Step 1: Hook**

`src/components/menu/use-menu-visivel.ts`:
```ts
"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJSON } from "@/lib/fetcher";
import { ALL_NAV_ITEMS, HOME_ITEM, NAV_GROUPS } from "@/components/nav-routes";
import { filtrarGruposVisiveis } from "@/modules/menu/preferencias";

export const MENU_QUERY_KEY = ["menu-preferencias"] as const;

type RespostaMenu = { ocultas: string[] };

export function useMenuOcultas() {
  return useQuery<RespostaMenu>({
    queryKey: MENU_QUERY_KEY,
    queryFn: () => fetchJSON<RespostaMenu>("/api/menu/preferencias"),
    staleTime: Infinity,
  });
}

/** Menu do usuário: grupos/itens já sem as abas que ele escondeu. */
export function useMenuVisivel() {
  const { data } = useMenuOcultas();
  const ocultas = React.useMemo(() => data?.ocultas ?? [], [data]);
  return React.useMemo(() => {
    const set = new Set(ocultas);
    return {
      ocultas,
      homeVisivel: !set.has(HOME_ITEM.href),
      grupos: filtrarGruposVisiveis(NAV_GROUPS, ocultas),
      itens: ALL_NAV_ITEMS.filter((item) => !set.has(item.href)),
    };
  }, [ocultas]);
}

export function useSalvarMenu() {
  const qc = useQueryClient();
  return useMutation<RespostaMenu, Error, string[], { anterior?: RespostaMenu }>({
    mutationFn: (ocultas) =>
      fetchJSON<RespostaMenu>("/api/menu/preferencias", {
        method: "PUT",
        body: JSON.stringify({ ocultas }),
      }),
    // Otimista: o menu muda na hora; se o PUT falhar, volta ao estado anterior.
    onMutate: async (ocultas) => {
      await qc.cancelQueries({ queryKey: MENU_QUERY_KEY });
      const anterior = qc.getQueryData<RespostaMenu>(MENU_QUERY_KEY);
      qc.setQueryData<RespostaMenu>(MENU_QUERY_KEY, { ocultas });
      return { anterior };
    },
    onError: (_erro, _vars, ctx) => {
      if (ctx?.anterior) qc.setQueryData(MENU_QUERY_KEY, ctx.anterior);
    },
    onSuccess: (data) => qc.setQueryData(MENU_QUERY_KEY, data),
  });
}
```

- [ ] **Step 2: Sidebar usa o menu visível**

Em `src/components/sidebar.tsx`:
1. Adicionar o import: `import { useMenuVisivel } from "@/components/menu/use-menu-visivel";`
2. Em `SidebarContent`, logo depois de `const { state: groupsExpanded, toggle } = useGroupsState(pathname ?? "");`, acrescentar:
```tsx
  const { grupos, homeVisivel } = useMenuVisivel();
```
3. Trocar o bloco `{/* Home destacada */} <div className="mb-3">…</div>` + o divisor `{!collapsed && (<div className="mb-2 h-px …" />)}` por:
```tsx
          {homeVisivel && (
            <>
              {/* Home destacada */}
              <div className="mb-3">
                <NavLeaf
                  item={homeItem}
                  active={isActive(pathname, homeItem.href)}
                  collapsed={collapsed}
                />
              </div>

              {!collapsed && (
                <div className="mb-2 h-px bg-gradient-to-r from-transparent via-[hsl(var(--sidebar-border))] to-transparent" />
              )}
            </>
          )}
```
4. Trocar `{groups.map((group, idx) => (` por `{grupos.map((group, idx) => (`.

O `useGroupsState` continua usando `NAV_GROUPS` completo (`groups`), sem mudança. Expandir um grupo que ficou escondido não tem efeito visual.

- [ ] **Step 3: Busca (CommandPalette) usa o menu visível**

Em `src/components/command-palette.tsx`:
1. Trocar `import { ALL_NAV_ITEMS } from "./nav-routes";` por `import { useMenuVisivel } from "@/components/menu/use-menu-visivel";`.
2. Dentro de `function CommandPaletteDialog(`, junto dos outros hooks do topo (antes de `const acoesRapidas = React.useMemo`), acrescentar:
```tsx
  const { itens: paginasMenu } = useMenuVisivel();
```
3. No memo `flat`, trocar as duas ocorrências de `ALL_NAV_ITEMS` por `paginasMenu`.
4. No array de dependências desse memo, trocar `[modo, queryAjustada, dadosRemotos, acoesRapidas, router, onClose]` por `[modo, queryAjustada, dadosRemotos, acoesRapidas, router, onClose, paginasMenu]`.

- [ ] **Step 4: Verificar**

Run: `npx eslint src/components/menu src/components/sidebar.tsx src/components/command-palette.tsx && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/components/menu/use-menu-visivel.ts src/components/sidebar.tsx src/components/command-palette.tsx
git commit -m "feat(menu): sidebar e busca respeitam as abas escolhidas pelo usuário

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Aba "Menu" em Configurações

**Files:**
- Create: `src/components/configuracoes/menu-section.tsx`
- Modify: `src/app/configuracoes/page.tsx`

**Interfaces:**
- Consumes: Task 1 (`contarVisiveis`, `ehFixo`, `ocultasDaSugestao`, `HREFS_NAV`), Task 3 (`useMenuOcultas`, `useSalvarMenu`).
- Produces: `MenuSection` (sem props). Deep-link `/configuracoes?tab=menu`, usado pela folha "Mais" na Task 7.

- [ ] **Step 1: Componente**

`src/components/configuracoes/menu-section.tsx`:
```tsx
"use client";

import * as React from "react";
import { CheckCheck, Lock, Menu as MenuIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { HOME_ITEM, HREFS_NAV, NAV_GROUPS, type NavLeaf } from "@/components/nav-routes";
import {
  contarVisiveis,
  ehFixo,
  ocultasDaSugestao,
} from "@/modules/menu/preferencias";
import { useMenuOcultas, useSalvarMenu } from "@/components/menu/use-menu-visivel";

type Secao = { id: string; label: string; itens: NavLeaf[] };

const SECOES: Secao[] = [
  ...NAV_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    itens: g.items.filter((item) => !ehFixo(item.href)),
  })),
  { id: "outros", label: "Outros", itens: [HOME_ITEM] },
].filter((secao) => secao.itens.length > 0);

const FIXAS: NavLeaf[] = NAV_GROUPS.flatMap((g) => g.items).filter((item) =>
  ehFixo(item.href),
);

const ROTULO_SECAO =
  "px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

export function MenuSection() {
  const { data, isLoading } = useMenuOcultas();
  const salvar = useSalvarMenu();
  const ocultas = data?.ocultas ?? [];
  const ocultasSet = new Set(ocultas);

  function aplicar(novas: string[], mensagem: string) {
    salvar.mutate(novas, {
      onSuccess: () => toast.success(mensagem),
      onError: (e) => toast.error(e.message || "Não foi possível salvar o menu."),
    });
  }

  function alternar(href: string) {
    const novas = ocultasSet.has(href)
      ? ocultas.filter((h) => h !== href)
      : [...ocultas, href];
    aplicar(novas, "Menu atualizado.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Abas do menu</CardTitle>
        <CardDescription>
          Escolha o que aparece no seu menu. Vale no celular e no computador, só
          para você.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-sm text-primary">
              <MenuIcon className="h-4 w-4" aria-hidden />
              <span>
                Seu menu tem <strong>{contarVisiveis(HREFS_NAV, ocultas)}</strong> de{" "}
                {HREFS_NAV.length} abas.
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={salvar.isPending}
                onClick={() =>
                  aplicar(
                    ocultasDaSugestao(HREFS_NAV),
                    "Sugestão aplicada: Dashboard, Vendas, Produtos e Configurações.",
                  )
                }
              >
                <CheckCheck className="mr-2 h-4 w-4" aria-hidden />
                Usar sugestão
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={salvar.isPending}
                onClick={() => aplicar([], "Todas as abas voltaram ao menu.")}
              >
                Mostrar tudo
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Sugestão: deixar só Dashboard, Vendas, Produtos e Configurações, as
              abas mais usadas. Esconder uma aba não desliga nada do que roda por
              trás.
            </p>

            <div className="overflow-hidden rounded-lg border">
              <p className={ROTULO_SECAO}>Sempre no menu</p>
              {FIXAS.map((item) => (
                <div
                  key={item.href}
                  className="flex min-h-[52px] items-center gap-3 border-t px-4"
                >
                  <item.icon className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 text-sm font-medium">{item.label}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" aria-hidden />
                    fixa
                  </span>
                </div>
              ))}
            </div>

            {SECOES.map((secao) => (
              <div key={secao.id} className="overflow-hidden rounded-lg border">
                <p className={ROTULO_SECAO}>{secao.label}</p>
                {secao.itens.map((item) => {
                  const ligado = !ocultasSet.has(item.href);
                  const id = `menu-aba${item.href.replace(/[^a-z0-9]+/gi, "-")}`;
                  return (
                    <label
                      key={item.href}
                      htmlFor={id}
                      className="flex min-h-[52px] cursor-pointer items-center gap-3 border-t px-4"
                    >
                      <item.icon
                        className={cn(
                          "h-4 w-4",
                          ligado ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      <span
                        className={cn(
                          "flex-1 text-sm font-medium",
                          !ligado && "text-muted-foreground",
                        )}
                      >
                        {item.label}
                      </span>
                      <Switch
                        id={id}
                        checked={ligado}
                        disabled={salvar.isPending}
                        onCheckedChange={() => alternar(item.href)}
                        aria-label={`Mostrar ${item.label} no menu`}
                      />
                    </label>
                  );
                })}
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Aba na página de Configurações**

Em `src/app/configuracoes/page.tsx`:
1. Import: trocar `import { Bell, Plug, SlidersHorizontal } from "lucide-react";` por `import { Bell, LayoutList, Plug, SlidersHorizontal } from "lucide-react";` e acrescentar `import { MenuSection } from "@/components/configuracoes/menu-section";`.
2. `const TABS_VALIDAS = new Set(["geral", "integracoes", "notificacoes"]);` → `const TABS_VALIDAS = new Set(["geral", "integracoes", "notificacoes", "menu"]);`
3. Depois do `TabsTrigger value="notificacoes"`, acrescentar:
```tsx
        <TabsTrigger value="menu" className="gap-2">
          <LayoutList className="h-4 w-4" />
          Menu
        </TabsTrigger>
```
4. Depois do `TabsContent value="notificacoes"`, acrescentar:
```tsx
      {/* ---- Menu ---- */}
      <TabsContent value="menu" className="space-y-4">
        <MenuSection />
      </TabsContent>
```
5. Na descrição do `PageHeader`, trocar por `"Preferências gerais, integrações, notificações e menu."`.

- [ ] **Step 3: Verificar**

Run: `npx eslint src/components/configuracoes/menu-section.tsx src/app/configuracoes/page.tsx && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/components/configuracoes/menu-section.tsx src/app/configuracoes/page.tsx
git commit -m "feat(menu): aba Menu em Configurações para ligar e desligar abas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# FASE 2 — App instalável (PWA), shell e telas mobile

## Task 5: Ícones do app instalável

**Files:**
- Create: `scripts/gerar-icones-pwa.mjs`
- Create (gerados): `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/maskable-512.png`, `public/icons/badge-96.png`
- Modify (gerado): `src/app/apple-icon.png` (180×180, fundo navy, já que o iOS pinta transparência de preto)

**Interfaces:**
- Produces: caminhos `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/maskable-512.png`, `/icons/badge-96.png` (usados por Task 6 e Task 13).

- [ ] **Step 1: Script**

`scripts/gerar-icones-pwa.mjs`:
```js
// Gera os ícones do app instalável (PWA) a partir do símbolo do Atlas.
// Uso: node scripts/gerar-icones-pwa.mjs (rodar de novo só se o logo mudar).
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const ORIGEM = "src/app/icon.png"; // 512x512, símbolo sobre fundo transparente
const DESTINO = "public/icons";
const FUNDO = "#030712"; // navy da sidebar/tema
const TRANSPARENTE = { r: 0, g: 0, b: 0, alpha: 0 };

async function iconeSobreFundo(tamanho, escala, saida) {
  const lado = Math.round(tamanho * escala);
  const simbolo = await sharp(ORIGEM)
    .resize(lado, lado, { fit: "contain", background: TRANSPARENTE })
    .png()
    .toBuffer();
  await sharp({
    create: { width: tamanho, height: tamanho, channels: 4, background: FUNDO },
  })
    .composite([{ input: simbolo, gravity: "center" }])
    .png()
    .toFile(saida);
}

// Ícone pequeno da barra de status do Android: silhueta branca sobre transparente.
async function badgeMonocromatico(tamanho, saida) {
  const miolo = Math.round(tamanho * 0.75);
  const margem = Math.floor((tamanho - miolo) / 2);
  const alpha = await sharp(ORIGEM)
    .resize(miolo, miolo, { fit: "contain", background: TRANSPARENTE })
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer();
  await sharp({
    create: { width: miolo, height: miolo, channels: 3, background: "#ffffff" },
  })
    .joinChannel(alpha, { raw: { width: miolo, height: miolo, channels: 1 } })
    .extend({
      top: margem,
      bottom: tamanho - miolo - margem,
      left: margem,
      right: tamanho - miolo - margem,
      background: TRANSPARENTE,
    })
    .png()
    .toFile(saida);
}

await mkdir(DESTINO, { recursive: true });
await iconeSobreFundo(192, 0.78, `${DESTINO}/icon-192.png`);
await iconeSobreFundo(512, 0.78, `${DESTINO}/icon-512.png`);
// maskable: o Android recorta em círculo/squircle → símbolo dentro da zona segura (~60%).
await iconeSobreFundo(512, 0.6, `${DESTINO}/maskable-512.png`);
await iconeSobreFundo(180, 0.78, "src/app/apple-icon.png");
await badgeMonocromatico(96, `${DESTINO}/badge-96.png`);
console.log("Ícones gerados em", DESTINO, "e src/app/apple-icon.png");
```

- [ ] **Step 2: Gerar e conferir dimensões**

Run:
```bash
node scripts/gerar-icones-pwa.mjs
node -e "const s=require('sharp');Promise.all(['public/icons/icon-192.png','public/icons/icon-512.png','public/icons/maskable-512.png','public/icons/badge-96.png','src/app/apple-icon.png'].map(f=>s(f).metadata().then(m=>f+' '+m.width+'x'+m.height))).then(r=>console.log(r.join('\n')))"
```
Expected: `192x192`, `512x512`, `512x512`, `96x96`, `180x180`.

- [ ] **Step 3: Conferir visualmente**

Abrir `public/icons/maskable-512.png` e `public/icons/badge-96.png` (ferramenta Read de imagem):
- o maskable deve mostrar o símbolo inteiro, centralizado no fundo navy;
- o badge deve mostrar uma silhueta branca.

Se o símbolo ficar cortado, reduzir a escala do maskable para `0.55` e gerar de novo.

- [ ] **Step 4: Commit**

```bash
git add scripts/gerar-icones-pwa.mjs public/icons src/app/apple-icon.png
git commit -m "feat(pwa): ícones do app instalável (192/512/maskable/badge/apple)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: Manifest, service worker, proxy e provider do PWA

**Files:**
- Create: `src/app/manifest.ts`
- Create: `public/sw.js`
- Create: `src/lib/pwa/plataforma.ts`, `src/lib/pwa/plataforma.test.ts`
- Create: `src/lib/pwa/refetch.ts`, `src/lib/pwa/refetch.test.ts`
- Create: `src/components/pwa/pwa-provider.tsx`
- Modify: `src/app/layout.tsx`, `src/components/providers.tsx`, `src/proxy.ts` (`PUBLIC_PATHS`), `next.config.mjs`

**Interfaces:**
- Consumes: ícones da Task 5.
- Produces:
  - `type Plataforma = { ios: boolean; android: boolean; standalone: boolean; iosSemSafari: boolean }`
  - `detectarPlataforma(userAgent: string, standalone: boolean, maxTouchPoints?: number): Plataforma`
  - `precisaInstalarParaPush(p: Plataforma): boolean`
  - `deveRecarregarAoVoltar(queryKey: readonly unknown[]): boolean`
  - `usePwa(): { plataforma: Plataforma | null; podeInstalarDireto: boolean; instalar: () => Promise<boolean>; registro: ServiceWorkerRegistration | null }`
  - SW: trata `push` (payload `{ title, body, tag, url, icon, badge }`) e `notificationclick` (abre `data.url`).

- [ ] **Step 1: Testes que falham**

`src/lib/pwa/plataforma.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { detectarPlataforma, precisaInstalarParaPush } from "./plataforma";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1";
const IPAD_COMO_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";

describe("detectarPlataforma", () => {
  it("iPhone no Safari, fora do app: precisa instalar para receber push", () => {
    const p = detectarPlataforma(IPHONE_SAFARI, false, 5);
    expect(p).toMatchObject({ ios: true, android: false, standalone: false, iosSemSafari: false });
    expect(precisaInstalarParaPush(p)).toBe(true);
  });

  it("iPhone com o app instalado: push liberado", () => {
    expect(precisaInstalarParaPush(detectarPlataforma(IPHONE_SAFARI, true, 5))).toBe(false);
  });

  it("Chrome no iPhone é marcado (instalação só pelo Safari)", () => {
    expect(detectarPlataforma(IPHONE_CHROME, false, 5).iosSemSafari).toBe(true);
  });

  it("iPad se anuncia como Mac, mas tem toque", () => {
    expect(detectarPlataforma(IPAD_COMO_MAC, false, 5).ios).toBe(true);
    expect(detectarPlataforma(IPAD_COMO_MAC, false, 0).ios).toBe(false);
  });

  it("Android e desktop não precisam instalar para push", () => {
    expect(detectarPlataforma(ANDROID, false).android).toBe(true);
    expect(precisaInstalarParaPush(detectarPlataforma(ANDROID, false))).toBe(false);
    expect(precisaInstalarParaPush(detectarPlataforma(WINDOWS, false))).toBe(false);
  });
});
```

`src/lib/pwa/refetch.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { deveRecarregarAoVoltar } from "./refetch";

describe("deveRecarregarAoVoltar", () => {
  it("recarrega dashboard, vendas, detalhe de produto e contador do sino", () => {
    expect(deveRecarregarAoVoltar(["dashboard-ecommerce-kpis", {}])).toBe(true);
    expect(deveRecarregarAoVoltar(["dashboard-ecommerce-top-produtos", {}])).toBe(true);
    expect(deveRecarregarAoVoltar(["vendas", {}, 1, "principal"])).toBe(true);
    expect(deveRecarregarAoVoltar(["vendas-totais", {}])).toBe(true);
    expect(deveRecarregarAoVoltar(["produto-resumo-mobile", "p1"])).toBe(true);
    expect(deveRecarregarAoVoltar(["notificacoes-count"])).toBe(true);
  });

  it("não recarrega o resto (menu, config, auth)", () => {
    expect(deveRecarregarAoVoltar(["menu-preferencias"])).toBe(false);
    expect(deveRecarregarAoVoltar(["auth-me"])).toBe(false);
    expect(deveRecarregarAoVoltar([42])).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/pwa`
Expected: FAIL (`Failed to resolve import "./plataforma"` / `"./refetch"`).

- [ ] **Step 3: Implementar os helpers**

`src/lib/pwa/plataforma.ts`:
```ts
export type Plataforma = {
  ios: boolean;
  android: boolean;
  standalone: boolean;
  /** iPhone/iPad fora do Safari (Chrome/Firefox/Edge iOS): instalação só pelo Safari. */
  iosSemSafari: boolean;
};

export function detectarPlataforma(
  userAgent: string,
  standalone: boolean,
  maxTouchPoints = 0,
): Plataforma {
  const ua = userAgent.toLowerCase();
  // iPadOS 13+ se anuncia como Mac; o toque denuncia.
  const ipadComoMac = ua.includes("macintosh") && maxTouchPoints > 1;
  const ios = /iphone|ipad|ipod/.test(ua) || ipadComoMac;
  const android = ua.includes("android");
  const iosSemSafari = ios && /crios|fxios|edgios/.test(ua);
  return { ios, android, standalone, iosSemSafari };
}

/** No iOS o push só existe para o app instalado na Tela de Início (16.4+). */
export function precisaInstalarParaPush(p: Plataforma): boolean {
  return p.ios && !p.standalone;
}
```

`src/lib/pwa/refetch.ts`:
```ts
// O app instalado não tem botão de recarregar: ao voltar para o primeiro plano,
// as telas de números do dia são atualizadas. O resto fica no cache normal.
const EXATAS = new Set(["vendas", "vendas-totais", "produto-resumo-mobile", "notificacoes-count"]);

export function deveRecarregarAoVoltar(queryKey: readonly unknown[]): boolean {
  const chave = typeof queryKey[0] === "string" ? queryKey[0] : "";
  return EXATAS.has(chave) || chave.startsWith("dashboard-ecommerce-");
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/pwa`
Expected: PASS (7 testes).

- [ ] **Step 5: Manifest**

`src/app/manifest.ts`:
```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Atlas Seller",
    short_name: "Atlas",
    description: "Vendas, estoque e lucro da sua loja Amazon no celular.",
    start_url: "/dashboard-ecommerce?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fafafa",
    theme_color: "#030712",
    lang: "pt-BR",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Vendas", url: "/vendas", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Produtos", url: "/produtos", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
```

- [ ] **Step 6: Service worker**

`public/sw.js`:
```js
/* Atlas Seller — service worker.
 * SEM handler de fetch e SEM cache: dados financeiros nunca ficam velhos e não há
 * risco de cache cruzado entre contas. Só cuida de notificações push. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = { body: event.data ? event.data.text() : "" };
  }
  const titulo = dados.title || "Atlas Seller";
  // iOS cancela a inscrição de quem recebe push sem exibir notificação:
  // SEMPRE chamar showNotification.
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: dados.body || "",
      icon: dados.icon || "/icons/icon-192.png",
      badge: dados.badge || "/icons/badge-96.png",
      tag: dados.tag || undefined,
      renotify: Boolean(dados.tag),
      data: { url: dados.url || "/vendas" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = new URL(
    (event.notification.data && event.notification.data.url) || "/",
    self.location.origin,
  ).href;
  event.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const janela of janelas) {
        if ("focus" in janela) {
          await janela.focus();
          if ("navigate" in janela) await janela.navigate(destino);
          return;
        }
      }
      await self.clients.openWindow(destino);
    })(),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  // O navegador trocou a inscrição: re-inscreve com a mesma chave pública e
  // registra de novo para a loja da sessão atual (cookie vai junto, mesma origem).
  event.waitUntil(
    (async () => {
      const resp = await fetch("/api/push/config", { credentials: "same-origin" });
      if (!resp.ok) return;
      const { enabled, publicKey } = await resp.json();
      if (!enabled || !publicKey) return;
      const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
      const bruto = atob((publicKey + padding).replace(/-/g, "+").replace(/_/g, "/"));
      const chave = Uint8Array.from(bruto, (c) => c.charCodeAt(0));
      const nova = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: chave,
      });
      const json = nova.toJSON();
      await fetch("/api/push/dispositivos", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: nova.endpoint, keys: json.keys }),
      });
    })(),
  );
});
```

- [ ] **Step 7: Provider do PWA**

`src/components/pwa/pwa-provider.tsx`:
```tsx
"use client";

import * as React from "react";
import { detectarPlataforma, type Plataforma } from "@/lib/pwa/plataforma";

type EventoInstalacao = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type ContextoPwa = {
  plataforma: Plataforma | null;
  /** Android/Chrome com `beforeinstallprompt`: dá para instalar com um toque. */
  podeInstalarDireto: boolean;
  instalar: () => Promise<boolean>;
  registro: ServiceWorkerRegistration | null;
};

const PwaContext = React.createContext<ContextoPwa>({
  plataforma: null,
  podeInstalarDireto: false,
  instalar: async () => false,
  registro: null,
});

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const [plataforma, setPlataforma] = React.useState<Plataforma | null>(null);
  const [evento, setEvento] = React.useState<EventoInstalacao | null>(null);
  const [registro, setRegistro] = React.useState<ServiceWorkerRegistration | null>(null);

  React.useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
    setPlataforma(detectarPlataforma(nav.userAgent, standalone, nav.maxTouchPoints ?? 0));

    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(setRegistro)
      .catch(() => setRegistro(null));
  }, []);

  React.useEffect(() => {
    function capturar(e: Event) {
      e.preventDefault();
      setEvento(e as EventoInstalacao);
    }
    window.addEventListener("beforeinstallprompt", capturar);
    return () => window.removeEventListener("beforeinstallprompt", capturar);
  }, []);

  const instalar = React.useCallback(async () => {
    if (!evento) return false;
    await evento.prompt();
    const escolha = await evento.userChoice;
    setEvento(null);
    return escolha.outcome === "accepted";
  }, [evento]);

  const valor = React.useMemo<ContextoPwa>(
    () => ({ plataforma, podeInstalarDireto: !!evento, instalar, registro }),
    [plataforma, evento, instalar, registro],
  );

  return <PwaContext.Provider value={valor}>{children}</PwaContext.Provider>;
}

export function usePwa(): ContextoPwa {
  return React.useContext(PwaContext);
}
```

- [ ] **Step 8: Providers: PwaProvider + recarregar ao voltar ao app**

Em `src/components/providers.tsx`:
1. Imports: `import { PwaProvider } from "@/components/pwa/pwa-provider";` e `import { deveRecarregarAoVoltar } from "@/lib/pwa/refetch";`
2. Depois do `React.useState(() => new QueryClient(...))`, acrescentar:
```tsx
  // App instalado não tem "recarregar": ao voltar ao primeiro plano, atualiza
  // os números do dia (dashboard, vendas, produto, sino).
  React.useEffect(() => {
    function aoVoltar() {
      if (document.visibilityState !== "visible") return;
      void client.invalidateQueries({
        predicate: (q) => deveRecarregarAoVoltar(q.queryKey),
      });
    }
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [client]);
```
3. Trocar `<QueryClientProvider client={client}>{children}</QueryClientProvider>` por:
```tsx
      <QueryClientProvider client={client}>
        <PwaProvider>{children}</PwaProvider>
      </QueryClientProvider>
```

- [ ] **Step 9: Layout: viewport e metadata do app**

Em `src/app/layout.tsx`:
1. `import type { Metadata } from "next";` → `import type { Metadata, Viewport } from "next";`
2. No objeto `metadata`, depois de `applicationName: "Atlas Seller",`, acrescentar:
```ts
  appleWebApp: {
    capable: true,
    title: "Atlas",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
```
3. Depois do `metadata`, acrescentar:
```ts
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#030712" },
  ],
};
```

- [ ] **Step 10: Proxy deixa manifest e SW públicos**

Em `src/proxy.ts`, no array `PUBLIC_PATHS`, depois de `"/privacidade",`, acrescentar:
```ts
  // PWA: o navegador busca manifest e service worker SEM cookie (manifest) ou
  // segue redirect como erro (SW). Ambos são estáticos e não vazam dados.
  "/manifest.webmanifest",
  "/sw.js",
```

- [ ] **Step 11: Headers do SW**

Em `next.config.mjs`, dentro de `const nextConfig = {`, depois de `poweredByHeader: false,`, acrescentar:
```js
  // Service worker sempre fresco (sem cache HTTP) e com CSP mínima própria.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
```

- [ ] **Step 12: Verificar**

Run: `npx eslint src/lib/pwa src/components/pwa src/components/providers.tsx src/app/layout.tsx src/app/manifest.ts src/proxy.ts && npx tsc --noEmit && npx vitest run src/lib/pwa`
Expected: sem erros; 7 testes PASS.

- [ ] **Step 13: Commit**

```bash
git add src/app/manifest.ts public/sw.js src/lib/pwa src/components/pwa/pwa-provider.tsx src/components/providers.tsx src/app/layout.tsx src/proxy.ts next.config.mjs
git commit -m "feat(pwa): manifest, service worker de push e provider de instalação

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: Shell mobile (barra inferior, Mais, instalar, logout, toasts)

**Files:**
- Create: `src/lib/use-media-query.ts`
- Create: `src/components/ui/toaster-responsivo.tsx`
- Create: `src/components/auth/use-logout.tsx`
- Create: `src/components/pwa/instalar-sheet.tsx`
- Create: `src/components/pwa/banner-instalar.tsx`
- Create: `src/components/mobile/mais-sheet.tsx`
- Create: `src/components/mobile/bottom-nav.tsx`
- Modify: `src/components/app-shell.tsx`, `src/components/topbar.tsx`, `src/app/layout.tsx`

**Interfaces:**
- Consumes: Task 3 (`useMenuVisivel`), Task 6 (`usePwa`).
- Produces:
  - `useMediaQuery(query: string): boolean`
  - `useLogout(): ControleLogout`, com `type ControleLogout = { sair: () => Promise<void>; saindo: boolean }` (a Task 16 estende)
  - `<InstalarSheet aberto onAbertoChange />`
  - `<BannerInstalar />`
  - `<MaisSheet aberto onAbertoChange />`
  - `<BottomNav />`

- [ ] **Step 1: Hook de media query e toaster responsivo**

`src/lib/use-media-query.ts`:
```ts
"use client";

import * as React from "react";

/** true enquanto a media query casar. No SSR e no 1º render: false. */
export function useMediaQuery(query: string): boolean {
  const [casa, setCasa] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(query);
    const atualizar = () => setCasa(mq.matches);
    atualizar();
    mq.addEventListener("change", atualizar);
    return () => mq.removeEventListener("change", atualizar);
  }, [query]);
  return casa;
}
```

`src/components/ui/toaster-responsivo.tsx`:
```tsx
"use client";

import { Toaster } from "@/components/ui/sonner";
import { useMediaQuery } from "@/lib/use-media-query";

/** No celular o toast desce do topo-centro (o canto direito some atrás do dedo). */
export function ToasterResponsivo() {
  const celular = useMediaQuery("(max-width: 767px)");
  return <Toaster richColors position={celular ? "top-center" : "top-right"} />;
}
```

Em `src/app/layout.tsx`: trocar `import { Toaster } from "@/components/ui/sonner";` por `import { ToasterResponsivo } from "@/components/ui/toaster-responsivo";` e `<Toaster richColors position="top-right" />` por `<ToasterResponsivo />`.

- [ ] **Step 2: Logout compartilhado**

`src/components/auth/use-logout.tsx`:
```tsx
"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export type ControleLogout = {
  sair: () => Promise<void>;
  saindo: boolean;
};

export function useLogout(): ControleLogout {
  const qc = useQueryClient();
  const [saindo, setSaindo] = React.useState(false);

  const encerrar = React.useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Mesmo com erro, seguimos: o cookie é revalidado no próximo load.
    }
    qc.clear();
    toast.success("Sessão encerrada.");
    // Navegação "dura": descarta todo estado de cliente da conta anterior.
    window.location.href = "/login";
  }, [qc]);

  const sair = React.useCallback(async () => {
    if (saindo) return;
    setSaindo(true);
    await encerrar();
  }, [saindo, encerrar]);

  return { sair, saindo };
}
```

Em `src/components/topbar.tsx`, no `ProfileMenu`:
1. Remover `const router = useRouter();`, `const qc = useQueryClient();`, `const [saindo, setSaindo] = React.useState(false);` e a função `fazerLogout` inteira.
2. Acrescentar `const logout = useLogout();` e o import `import { useLogout } from "@/components/auth/use-logout";`.
3. No `DropdownMenuItem` de "Sair": `fazerLogout();` → `void logout.sair();`, `disabled={saindo}` → `disabled={logout.saindo}`, `{saindo ? (` → `{logout.saindo ? (`.
4. Remover imports que ficaram sem uso (`useRouter`, `useQueryClient`, `toast`).

- [ ] **Step 3: Folha "Instalar o Atlas"**

`src/components/pwa/instalar-sheet.tsx`:
```tsx
"use client";

import * as React from "react";
import Image from "next/image";
import { Download, Share, SquarePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { usePwa } from "@/components/pwa/pwa-provider";

function Passo({
  n,
  children,
  icone,
}: {
  n: number;
  children: React.ReactNode;
  icone?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
        {n}
      </span>
      <span className="flex-1 text-[15px] leading-snug">{children}</span>
      {icone && (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
          {icone}
        </span>
      )}
    </li>
  );
}

export function InstalarSheet({
  aberto,
  onAbertoChange,
}: {
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
}) {
  const { plataforma, podeInstalarDireto, instalar } = usePwa();

  async function instalarAgora() {
    const aceitou = await instalar();
    if (aceitou) {
      toast.success("Atlas instalado. Abra pelo ícone na tela inicial.");
      onAbertoChange(false);
    }
  }

  return (
    <Sheet open={aberto} onOpenChange={onAbertoChange}>
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto rounded-t-2xl px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <SheetTitle className="text-lg">
          Instalar o Atlas{plataforma?.ios ? " no iPhone" : ""}
        </SheetTitle>
        <SheetDescription>Leva 20 segundos e não passa pela loja de apps.</SheetDescription>

        {podeInstalarDireto ? (
          <Button className="mt-4 h-12 w-full text-base" onClick={instalarAgora}>
            <Download className="mr-2 h-5 w-5" aria-hidden />
            Instalar agora
          </Button>
        ) : plataforma?.ios ? (
          <ol className="mt-4 space-y-3.5">
            {plataforma.iosSemSafari && (
              <li className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                No iPhone a instalação é feita pelo <strong>Safari</strong>. Abra
                erp.mundofs.cloud nele.
              </li>
            )}
            <Passo n={1}>
              Abra <strong>erp.mundofs.cloud</strong> no Safari
            </Passo>
            <Passo n={2} icone={<Share className="h-5 w-5" aria-hidden />}>
              Toque em <strong>Compartilhar</strong>
            </Passo>
            <Passo n={3} icone={<SquarePlus className="h-5 w-5" aria-hidden />}>
              Escolha <strong>Adicionar à Tela de Início</strong>
            </Passo>
            <Passo n={4}>Abra o Atlas pelo ícone e entre com sua conta</Passo>
          </ol>
        ) : (
          <p className="mt-4 text-[15px] leading-relaxed">
            No menu do navegador, toque em <strong>Instalar app</strong> ou{" "}
            <strong>Adicionar à tela inicial</strong>.
          </p>
        )}

        <div className="mt-4 flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
          <Image
            src="/icons/icon-192.png"
            alt="Ícone do Atlas"
            width={56}
            height={56}
            className="rounded-xl"
          />
          <p className="text-sm text-muted-foreground">
            Depois de abrir pelo ícone, ative o aviso de venda em{" "}
            <strong className="text-foreground">Mais → Notificações deste celular</strong>.
          </p>
        </div>

        <Button
          variant="outline"
          className="mt-4 h-12 w-full"
          onClick={() => onAbertoChange(false)}
        >
          Entendi
        </Button>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Banner de instalação (só celular, dispensável)**

`src/components/pwa/banner-instalar.tsx`:
```tsx
"use client";

import * as React from "react";
import { Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePwa } from "@/components/pwa/pwa-provider";
import { InstalarSheet } from "@/components/pwa/instalar-sheet";

const CHAVE_DISPENSADO = "atlas-banner-instalar-dispensado";

export function BannerInstalar() {
  const { plataforma } = usePwa();
  const [dispensado, setDispensado] = React.useState(true);
  const [instalarAberto, setInstalarAberto] = React.useState(false);

  React.useEffect(() => {
    try {
      setDispensado(localStorage.getItem(CHAVE_DISPENSADO) === "1");
    } catch {
      setDispensado(false);
    }
  }, []);

  const celular = !!plataforma && (plataforma.ios || plataforma.android);
  if (!plataforma || plataforma.standalone || dispensado || !celular) return null;

  function dispensar() {
    setDispensado(true);
    try {
      localStorage.setItem(CHAVE_DISPENSADO, "1");
    } catch {
      // modo privado: o banner volta na próxima visita, sem problema
    }
  }

  return (
    <>
      <section
        aria-label="Instalar o app"
        className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 py-3 pl-3 pr-1 dark:border-blue-900 dark:bg-blue-950/40"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Smartphone className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
            Use o Atlas como app
          </p>
          <p className="text-[13px] leading-snug text-blue-800 dark:text-blue-200">
            Instale na tela inicial e receba um aviso a cada venda.
          </p>
        </div>
        <Button size="sm" className="h-11" onClick={() => setInstalarAberto(true)}>
          Instalar
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-11 w-10 text-blue-800 dark:text-blue-200"
          onClick={dispensar}
          aria-label="Dispensar"
        >
          <X className="h-4 w-4" />
        </Button>
      </section>
      <InstalarSheet aberto={instalarAberto} onAbertoChange={setInstalarAberto} />
    </>
  );
}
```

- [ ] **Step 5: Folha "Mais"**

`src/components/mobile/mais-sheet.tsx`:
```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  Bell,
  ChevronRight,
  Download,
  LogOut,
  Settings,
  SlidersHorizontal,
  UserCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { HOME_ITEM } from "@/components/nav-routes";
import { useMenuVisivel } from "@/components/menu/use-menu-visivel";
import { usePwa } from "@/components/pwa/pwa-provider";
import { InstalarSheet } from "@/components/pwa/instalar-sheet";
import { useLogout } from "@/components/auth/use-logout";

// Já estão na barra inferior ou na seção "Conta e app".
const FORA_DA_LISTA = new Set([
  "/dashboard-ecommerce",
  "/vendas",
  "/produtos",
  "/configuracoes",
  "/perfil",
]);

type Icone = React.ComponentType<{ className?: string }>;

function Linha({
  icone: Icone,
  rotulo,
  sub,
  tom = "normal",
}: {
  icone: Icone;
  rotulo: string;
  sub?: string;
  tom?: "normal" | "destaque" | "perigo";
}) {
  return (
    <>
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          tom === "destaque" && "bg-primary/10 text-primary",
          tom === "perigo" && "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300",
          tom === "normal" && "bg-muted text-foreground/80",
        )}
      >
        <Icone className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{rotulo}</span>
        {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
    </>
  );
}

const CLASSE_LINHA =
  "flex min-h-[52px] w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left active:bg-muted";

const ROTULO_SECAO =
  "px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

export function MaisSheet({
  aberto,
  onAbertoChange,
}: {
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
}) {
  const { grupos, homeVisivel } = useMenuVisivel();
  const { plataforma } = usePwa();
  const logout = useLogout();
  const [instalarAberto, setInstalarAberto] = React.useState(false);

  const extras = grupos
    .map((g) => ({ ...g, items: g.items.filter((i) => !FORA_DA_LISTA.has(i.href)) }))
    .filter((g) => g.items.length > 0);
  const semExtras = extras.length === 0 && !homeVisivel;
  const mostrarInstalar = !!plataforma && !plataforma.standalone;
  const fechar = () => onAbertoChange(false);

  return (
    <>
      <Sheet open={aberto} onOpenChange={onAbertoChange}>
        <SheetContent
          side="bottom"
          className="max-h-[88dvh] overflow-y-auto rounded-t-2xl px-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4"
        >
          <SheetTitle className="px-2 text-lg">Mais</SheetTitle>
          <SheetDescription className="sr-only">
            Outras abas do seu menu, ajustes do app e conta.
          </SheetDescription>

          {semExtras && (
            <p className="mx-2 mt-3 rounded-xl border border-dashed bg-muted/40 p-3 text-[13px] leading-relaxed text-muted-foreground">
              Seu menu está enxuto: só Início, Vendas e Produtos. Para trazer outras
              abas, toque em <strong className="text-primary">Personalizar menu</strong>.
            </p>
          )}

          {extras.map((g) => (
            <section key={g.id}>
              <p className={ROTULO_SECAO}>{g.label}</p>
              {g.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={fechar}
                  className={CLASSE_LINHA}
                >
                  <Linha icone={item.icon} rotulo={item.label} />
                </Link>
              ))}
            </section>
          ))}
          {homeVisivel && (
            <section>
              <p className={ROTULO_SECAO}>Outros</p>
              <Link href={HOME_ITEM.href} onClick={fechar} className={CLASSE_LINHA}>
                <Linha icone={HOME_ITEM.icon} rotulo={HOME_ITEM.label} />
              </Link>
            </section>
          )}

          <div className="mx-2 my-2 h-px bg-border" />
          <p className={ROTULO_SECAO}>Conta e app</p>
          <Link
            href={"/configuracoes?tab=menu" as Route}
            onClick={fechar}
            className={CLASSE_LINHA}
          >
            <Linha
              icone={SlidersHorizontal}
              rotulo="Personalizar menu"
              sub="Escolha o que aparece no seu menu"
              tom="destaque"
            />
          </Link>
          <Link
            href={"/configuracoes?tab=notificacoes" as Route}
            onClick={fechar}
            className={CLASSE_LINHA}
          >
            <Linha icone={Bell} rotulo="Notificações deste celular" sub="Aviso a cada venda" />
          </Link>
          {mostrarInstalar && (
            <button
              type="button"
              className={CLASSE_LINHA}
              onClick={() => {
                fechar();
                setInstalarAberto(true);
              }}
            >
              <Linha
                icone={Download}
                rotulo="Instalar app"
                sub="Abrir como app na tela inicial"
              />
            </button>
          )}
          <Link href={"/configuracoes" as Route} onClick={fechar} className={CLASSE_LINHA}>
            <Linha icone={Settings} rotulo="Configurações" />
          </Link>
          <Link href={"/perfil" as Route} onClick={fechar} className={CLASSE_LINHA}>
            <Linha icone={UserCircle} rotulo="Meu perfil" />
          </Link>
          <button
            type="button"
            className={cn(CLASSE_LINHA, "text-red-700 dark:text-red-300")}
            disabled={logout.saindo}
            onClick={() => {
              fechar();
              void logout.sair();
            }}
          >
            <Linha icone={LogOut} rotulo="Sair" tom="perigo" />
          </button>
        </SheetContent>
      </Sheet>
      <InstalarSheet aberto={instalarAberto} onAbertoChange={setInstalarAberto} />
    </>
  );
}
```

- [ ] **Step 6: Barra inferior**

`src/components/mobile/bottom-nav.tsx`:
```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Menu, Package, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import { MaisSheet } from "@/components/mobile/mais-sheet";

const ITENS = [
  { href: "/dashboard-ecommerce", rotulo: "Início", icone: LayoutDashboard },
  { href: "/vendas", rotulo: "Vendas", icone: ShoppingBag },
  { href: "/produtos", rotulo: "Produtos", icone: Package },
] as const;

function ativo(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Navegação do celular (< lg). Substitui o hamburguer/drawer da sidebar. */
export function BottomNav() {
  const pathname = usePathname() ?? "";
  const [maisAberto, setMaisAberto] = React.useState(false);

  React.useEffect(() => setMaisAberto(false), [pathname]);

  const maisAtivo = maisAberto || !ITENS.some((i) => ativo(pathname, i.href));

  return (
    <>
      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-4">
          {ITENS.map(({ href, rotulo, icone: Icone }) => {
            const selecionado = ativo(pathname, href);
            return (
              <Link
                key={href}
                href={href as Route}
                aria-current={selecionado ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                  selecionado ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-14 items-center justify-center rounded-full transition-colors",
                    selecionado && "bg-primary/10",
                  )}
                >
                  <Icone className="h-5 w-5" aria-hidden />
                </span>
                {rotulo}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMaisAberto(true)}
            aria-haspopup="dialog"
            aria-expanded={maisAberto}
            className={cn(
              "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
              maisAtivo ? "text-primary" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "flex h-8 w-14 items-center justify-center rounded-full transition-colors",
                maisAtivo && "bg-primary/10",
              )}
            >
              <Menu className="h-5 w-5" aria-hidden />
            </span>
            Mais
          </button>
        </div>
      </nav>
      <MaisSheet aberto={maisAberto} onAbertoChange={setMaisAberto} />
    </>
  );
}
```

- [ ] **Step 7: AppShell e topbar**

Em `src/components/app-shell.tsx`:
1. Import: `import { BottomNav } from "@/components/mobile/bottom-nav";`
2. Trocar o bloco `return ( <CommandPaletteProvider> … </CommandPaletteProvider> );` final por:
```tsx
  return (
    <CommandPaletteProvider>
      <div className="flex h-dvh overflow-hidden bg-background">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar />
          <main className="flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto max-w-6xl px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-6 lg:p-8">
              {children}
            </div>
          </main>
        </div>
      </div>
      <BottomNav />
    </CommandPaletteProvider>
  );
```

Em `src/components/topbar.tsx`: remover `<SidebarMobileSheet />` (dentro de `{/* Mobile: menu + logo */}`) e o import `import { SidebarMobileSheet } from "@/components/sidebar";`. A barra inferior substitui o hamburguer; a logo continua. `SidebarMobileSheet` fica exportado em `sidebar.tsx`, sem uso, para não mexer além do necessário.

- [ ] **Step 8: Verificar**

Run: `npx eslint src/lib/use-media-query.ts src/components/ui/toaster-responsivo.tsx src/components/auth src/components/pwa src/components/mobile src/components/app-shell.tsx src/components/topbar.tsx src/app/layout.tsx && npx tsc --noEmit`
Expected: sem erros.

Conferência visual (dev server em `http://localhost:3000`, DevTools em 390×844, logado):
- a barra inferior aparece;
- "Mais" abre a folha;
- "Personalizar menu" leva para `/configuracoes?tab=menu`;
- nada fica escondido atrás da barra ao rolar até o fim.

- [ ] **Step 9: Commit**

```bash
git add src/lib/use-media-query.ts src/components/ui/toaster-responsivo.tsx src/components/auth/use-logout.tsx src/components/pwa src/components/mobile src/components/app-shell.tsx src/components/topbar.tsx src/app/layout.tsx
git commit -m "feat(mobile): barra inferior, folha Mais, instalação e logout compartilhado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: Dashboard no celular (6 KPIs + MPA + Top 15)

**Files:**
- Create: `src/modules/dashboard-ecommerce/kpis-mobile.ts`, `src/modules/dashboard-ecommerce/kpis-mobile.test.ts`
- Create: `src/components/dashboard-ecommerce/dashboard-mobile.tsx`
- Modify: `src/app/dashboard-ecommerce/page.tsx`

**Interfaces:**
- Consumes: Task 7 (`BannerInstalar`); `formatBRL` de `@/lib/money`; `MarginBadge`, `MPA_THRESHOLDS`, `ProductThumb`, `TrendIndicator`, `resolverImagemProduto`.
- Produces:
  - `type KpisMobileEntrada`
  - `formatarPercentual(v: number | null | undefined): string`
  - `montarKpisMobile(k: KpisMobileEntrada): { cards: KpiMobile[]; mpa: { valor: string; lucroPosAds: string; delta: DeltaKpi } }`
  - `<DashboardMobile … />`

- [ ] **Step 1: Teste que falha**

`src/modules/dashboard-ecommerce/kpis-mobile.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatBRL } from "@/lib/money";
import { formatarPercentual, montarKpisMobile, type KpisMobileEntrada } from "./kpis-mobile";

const base: KpisMobileEntrada = {
  faturamentoCentavos: 3_894_017,
  lucroBrutoCentavos: 529_626,
  margemPercentual: 13.6,
  numeroVendas: 431,
  roiPercentual: 21.4,
  valorAdsCentavos: 146_832,
  lucroPosAdsCentavos: 382_794,
  mpaPercentual: 9.83,
  delta: {
    faturamento: 12.4,
    lucroBruto: 8.1,
    margem: -0.6,
    numeroVendas: 9,
    roi: 1.8,
    valorAds: 4.2,
    lucroPosAds: -2,
  },
};

describe("KPIs do dashboard no celular", () => {
  it("mostra só os 6 escolhidos, nesta ordem", () => {
    const { cards } = montarKpisMobile(base);
    expect(cards.map((c) => c.rotulo)).toEqual([
      "Faturamento",
      "Lucro",
      "Margem",
      "Vendas",
      "ROI",
      "Gasto em anúncios",
    ]);
  });

  it("formata dinheiro, percentual e contagem", () => {
    const { cards, mpa } = montarKpisMobile(base);
    expect(cards[0]?.valor).toBe(formatBRL(3_894_017));
    expect(cards[2]?.valor).toBe("13,6%");
    expect(cards[3]?.valor).toBe("431");
    expect(mpa.valor).toBe("9,8%");
    expect(mpa.lucroPosAds).toBe(formatBRL(382_794));
  });

  it("gasto em anúncios subir é ruim (delta inverso); margem e ROI são pp", () => {
    const { cards } = montarKpisMobile(base);
    expect(cards.find((c) => c.chave === "ads")?.delta).toEqual({
      valor: 4.2,
      tipo: "percent",
      inverso: true,
    });
    expect(cards.find((c) => c.chave === "margem")?.delta.tipo).toBe("pp");
    expect(cards.find((c) => c.chave === "roi")?.delta.tipo).toBe("pp");
  });

  it("sem custo cadastrado: lucro, margem, ROI e MPA viram N/A", () => {
    const { cards, mpa } = montarKpisMobile({
      ...base,
      lucroBrutoCentavos: null,
      margemPercentual: null,
      roiPercentual: null,
      lucroPosAdsCentavos: null,
      mpaPercentual: null,
    });
    expect(cards.find((c) => c.chave === "lucro")?.valor).toBe("N/A");
    expect(cards.find((c) => c.chave === "margem")?.valor).toBe("N/A");
    expect(cards.find((c) => c.chave === "roi")?.valor).toBe("N/A");
    expect(mpa.valor).toBe("N/A");
    expect(mpa.lucroPosAds).toBe("N/A");
  });

  it("formatarPercentual trata NaN e infinito", () => {
    expect(formatarPercentual(Number.NaN)).toBe("N/A");
    expect(formatarPercentual(Number.POSITIVE_INFINITY)).toBe("N/A");
    expect(formatarPercentual(undefined)).toBe("N/A");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/dashboard-ecommerce/kpis-mobile.test.ts`
Expected: FAIL (`Failed to resolve import "./kpis-mobile"`).

- [ ] **Step 3: Implementar**

`src/modules/dashboard-ecommerce/kpis-mobile.ts`:
```ts
import { formatBRL } from "@/lib/money";

export type DeltaKpi = { valor: number | null; tipo: "percent" | "pp"; inverso?: boolean };
export type CategoriaKpiMobile = "receita" | "operacao" | "ads";
export type KpiMobile = {
  chave: "faturamento" | "lucro" | "margem" | "vendas" | "roi" | "ads";
  rotulo: string;
  valor: string;
  categoria: CategoriaKpiMobile;
  delta: DeltaKpi;
};

/** Subconjunto do `Kpis` do dashboard (mesmos nomes da API /kpis). */
export type KpisMobileEntrada = {
  faturamentoCentavos: number;
  lucroBrutoCentavos: number | null;
  margemPercentual: number | null;
  numeroVendas: number;
  roiPercentual: number | null;
  valorAdsCentavos: number;
  lucroPosAdsCentavos: number | null;
  mpaPercentual: number | null;
  delta: {
    faturamento: number | null;
    lucroBruto: number | null;
    margem: number | null;
    numeroVendas: number | null;
    roi: number | null;
    valorAds: number | null;
    lucroPosAds: number | null;
  };
};

export function formatarPercentual(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function dinheiroOuNA(centavos: number | null): string {
  return centavos == null ? "N/A" : formatBRL(centavos);
}

/** Os 6 KPIs + MPA escolhidos para o celular (o desktop continua com todos). */
export function montarKpisMobile(k: KpisMobileEntrada): {
  cards: KpiMobile[];
  mpa: { valor: string; lucroPosAds: string; delta: DeltaKpi };
} {
  const d = k.delta;
  return {
    cards: [
      { chave: "faturamento", rotulo: "Faturamento", valor: formatBRL(k.faturamentoCentavos), categoria: "receita", delta: { valor: d.faturamento, tipo: "percent" } },
      { chave: "lucro", rotulo: "Lucro", valor: dinheiroOuNA(k.lucroBrutoCentavos), categoria: "operacao", delta: { valor: d.lucroBruto, tipo: "percent" } },
      { chave: "margem", rotulo: "Margem", valor: formatarPercentual(k.margemPercentual), categoria: "operacao", delta: { valor: d.margem, tipo: "pp" } },
      { chave: "vendas", rotulo: "Vendas", valor: k.numeroVendas.toLocaleString("pt-BR"), categoria: "operacao", delta: { valor: d.numeroVendas, tipo: "percent" } },
      { chave: "roi", rotulo: "ROI", valor: formatarPercentual(k.roiPercentual), categoria: "operacao", delta: { valor: d.roi, tipo: "pp" } },
      { chave: "ads", rotulo: "Gasto em anúncios", valor: formatBRL(k.valorAdsCentavos), categoria: "ads", delta: { valor: d.valorAds, tipo: "percent", inverso: true } },
    ],
    mpa: {
      valor: formatarPercentual(k.mpaPercentual),
      lucroPosAds: dinheiroOuNA(k.lucroPosAdsCentavos),
      delta: { valor: d.lucroPosAds, tipo: "percent" },
    },
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/dashboard-ecommerce/kpis-mobile.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Componente mobile**

`src/components/dashboard-ecommerce/dashboard-mobile.tsx`:
```tsx
"use client";

import Link from "next/link";
import type { Route } from "next";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarginBadge, MPA_THRESHOLDS } from "@/components/ui/margin-badge";
import { ProductThumb } from "@/components/ui/product-thumb";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { resolverImagemProduto } from "@/lib/amazon-images";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  formatarPercentual,
  montarKpisMobile,
  type CategoriaKpiMobile,
  type KpisMobileEntrada,
} from "@/modules/dashboard-ecommerce/kpis-mobile";

/** Mesmos campos do TopProduto da página (API /top-produtos). */
export type TopProdutoMobile = {
  sku: string;
  produtoId: string | null;
  nome: string;
  imagemUrl: string | null;
  amazonImagemUrl: string | null;
  asin: string | null;
  precoMedioCentavos: number;
  custoUnitarioCentavos: number | null;
  unidades: number;
  faturadoCentavos: number;
  representatividadePercentual: number | null;
  lucroCentavos: number | null;
  margemPercentual: number | null;
  custoAdsCentavos: number;
  lucroPosAdsCentavos: number | null;
  mpaPercentual: number | null;
};

const BORDA: Record<CategoriaKpiMobile, string> = {
  receita: "border-l-emerald-500",
  operacao: "border-l-blue-500",
  ads: "border-l-amber-500",
};

const ROTULO_KPI =
  "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

function Metrica({
  rotulo,
  valor,
  children,
}: {
  rotulo: string;
  valor: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{rotulo}</span>
      <span className="truncate text-[13px] font-semibold tabular-nums">{valor}</span>
      {children}
    </div>
  );
}

function ItemTopProduto({ produto, posicao }: { produto: TopProdutoMobile; posicao: number }) {
  const thumb =
    produto.imagemUrl && produto.produtoId
      ? `/api/produtos/${produto.produtoId}/imagem`
      : resolverImagemProduto(produto.amazonImagemUrl, produto.asin, null);

  const conteudo = (
    <>
      <div className="flex items-start gap-3">
        <span className="w-5 shrink-0 pt-3.5 text-right text-xs font-bold text-muted-foreground">
          {posicao}
        </span>
        <ProductThumb src={thumb} alt={produto.nome} size={48} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium leading-snug">{produto.nome}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {produto.sku} · {produto.unidades} un ·{" "}
            {formatarPercentual(produto.representatividadePercentual)} do total
          </p>
        </div>
        <span className="shrink-0 text-sm font-bold tabular-nums">
          {formatBRL(produto.faturadoCentavos)}
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2 pl-8">
        <Metrica
          rotulo="Lucro"
          valor={produto.lucroCentavos == null ? "N/A" : formatBRL(produto.lucroCentavos)}
        >
          <MarginBadge value={produto.margemPercentual} />
        </Metrica>
        <Metrica
          rotulo="Custo Ads"
          valor={produto.custoAdsCentavos > 0 ? formatBRL(produto.custoAdsCentavos) : "—"}
        />
        <Metrica
          rotulo="Pós-Ads"
          valor={
            produto.lucroPosAdsCentavos == null ? "N/A" : formatBRL(produto.lucroPosAdsCentavos)
          }
        >
          <MarginBadge value={produto.mpaPercentual} thresholds={MPA_THRESHOLDS} />
        </Metrica>
      </div>
      <p className="mt-1.5 pl-8 text-xs text-muted-foreground">
        Preço médio {formatBRL(produto.precoMedioCentavos)} · Custo{" "}
        {produto.custoUnitarioCentavos == null
          ? "N/A"
          : formatBRL(produto.custoUnitarioCentavos)}
      </p>
    </>
  );

  return (
    <li className="border-t">
      {produto.produtoId ? (
        <Link
          href={`/produtos/${produto.produtoId}` as Route}
          className="block px-4 py-3 active:bg-muted/60"
        >
          {conteudo}
        </Link>
      ) : (
        <div className="px-4 py-3">{conteudo}</div>
      )}
    </li>
  );
}

export function DashboardMobile({
  kpis,
  carregandoKpis,
  produtos,
  carregandoTop,
  ordem,
  onAlternarOrdem,
}: {
  kpis: KpisMobileEntrada | undefined;
  carregandoKpis: boolean;
  produtos: TopProdutoMobile[];
  carregandoTop: boolean;
  ordem: "desc" | "asc";
  onAlternarOrdem: () => void;
}) {
  const resumo = kpis ? montarKpisMobile(kpis) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        {carregandoKpis || !resumo
          ? Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[88px] rounded-xl" />
            ))
          : resumo.cards.map((card) => (
              <div
                key={card.chave}
                className={cn(
                  "min-w-0 rounded-xl border border-l-[3px] bg-card p-3",
                  BORDA[card.categoria],
                )}
              >
                <p className={ROTULO_KPI}>{card.rotulo}</p>
                <p className="mt-1 truncate text-lg font-bold tabular-nums">{card.valor}</p>
                <TrendIndicator
                  value={card.delta.valor}
                  unit={card.delta.tipo}
                  inverso={card.delta.inverso}
                  className="mt-0.5"
                />
              </div>
            ))}
      </div>

      {resumo && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-l-[3px] border-l-amber-500 bg-card px-4 py-3">
          <div className="min-w-0">
            <p className={ROTULO_KPI}>MPA · margem pós-anúncios</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Lucro pós-Ads{" "}
              <strong className="text-foreground">{resumo.mpa.lucroPosAds}</strong>
            </p>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-2xl font-bold tabular-nums">{resumo.mpa.valor}</span>
            <TrendIndicator value={resumo.mpa.delta.valor} unit={resumo.mpa.delta.tipo} />
          </div>
        </div>
      )}

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
          <div>
            <h2 className="text-base font-semibold">Top 15 produtos</h2>
            <p className="text-xs text-muted-foreground">por faturamento no período</p>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-10" onClick={onAlternarOrdem}>
            <ArrowUpDown className="mr-1.5 h-4 w-4" aria-hidden />
            {ordem === "desc" ? "Maior" : "Menor"} faturamento
          </Button>
        </div>
        {carregandoTop ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : produtos.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Sem vendas no período.
          </p>
        ) : (
          <ol>
            {produtos.map((p, idx) => (
              <ItemTopProduto key={p.sku} produto={p} posicao={idx + 1} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 6: Integrar na página (desktop intocado)**

Em `src/app/dashboard-ecommerce/page.tsx`:
1. Imports:
```tsx
import { DashboardMobile } from "@/components/dashboard-ecommerce/dashboard-mobile";
import { BannerInstalar } from "@/components/pwa/banner-instalar";
```
2. Imediatamente ANTES de `<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">` (grade `heroes`), inserir:
```tsx
      <div className="space-y-4 md:hidden" data-testid="dashboard-mobile">
        <BannerInstalar />
        <DashboardMobile
          kpis={kpis}
          carregandoKpis={loadingKpis}
          produtos={produtosOrdenados}
          carregandoTop={loadingTop}
          ordem={sortProdutos}
          onAlternarOrdem={() =>
            setSortProdutos((s) => (s === "desc" ? "asc" : "desc"))
          }
        />
      </div>

      <div className="hidden space-y-6 md:block">
```
3. Fechar esse `<div>` imediatamente DEPOIS do `</ErrorBoundary>` do card "Top 15 produtos" (o que vem logo antes de `<Dialog open={!!produtoDetalhe}`), acrescentando `      </div>`.

Os avisos de custo ausente e de taxa estimada ficam fora do wrapper (aparecem nos dois).

- [ ] **Step 7: Verificar**

Run: `npx eslint src/modules/dashboard-ecommerce/kpis-mobile.ts src/components/dashboard-ecommerce/dashboard-mobile.tsx src/app/dashboard-ecommerce/page.tsx && npx tsc --noEmit && npx vitest run src/modules/dashboard-ecommerce/kpis-mobile.test.ts`
Expected: sem erros; PASS.

Visual em 390 px: 6 cards + MPA + Top 15; nenhum gráfico. Em ≥ 768 px: layout antigo idêntico.

- [ ] **Step 8: Commit**

```bash
git add src/modules/dashboard-ecommerce/kpis-mobile.ts src/modules/dashboard-ecommerce/kpis-mobile.test.ts src/components/dashboard-ecommerce/dashboard-mobile.tsx src/app/dashboard-ecommerce/page.tsx
git commit -m "feat(mobile): dashboard enxuto no celular (6 KPIs, MPA e Top 15 com foto)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: Vendas — abrir o pedido do aviso e reembolsos em cards

**Files:**
- Create: `src/modules/vendas/pedido-param.ts`, `src/modules/vendas/pedido-param.test.ts`
- Modify: `src/app/api/vendas/route.ts` (bloco de filtros, ~L56-75)
- Modify: `src/app/vendas/page.tsx`
- Modify: `src/components/vendas/order-card-list.tsx`, `src/components/vendas/order-card.tsx`

**Interfaces:**
- Produces:
  - `normalizarPedidoParam(valor: string | null | undefined): string | null` (formato `NNN-NNNNNNN-NNNNNNN`)
  - `GET /api/vendas?pedido=…` filtra por `amazonOrderId`
  - `OrderCardList` prop `destacarPedidoId?: string | null`
  - `OrderCard` prop `destacado?: boolean`
  - URL `/vendas?pedido=<id>`, usada pelo push na Task 12

- [ ] **Step 1: Teste que falha**

`src/modules/vendas/pedido-param.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { normalizarPedidoParam } from "./pedido-param";

describe("normalizarPedidoParam", () => {
  it("aceita o formato de pedido da Amazon (com espaços em volta)", () => {
    expect(normalizarPedidoParam("702-4417820-3391045")).toBe("702-4417820-3391045");
    expect(normalizarPedidoParam("  702-4417820-3391045 ")).toBe("702-4417820-3391045");
  });

  it("rejeita vazio, lixo e tentativa de injeção", () => {
    expect(normalizarPedidoParam(null)).toBeNull();
    expect(normalizarPedidoParam("")).toBeNull();
    expect(normalizarPedidoParam("702-441")).toBeNull();
    expect(normalizarPedidoParam("702-4417820-3391045' OR 1=1")).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/vendas/pedido-param.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`src/modules/vendas/pedido-param.ts`:
```ts
const FORMATO_PEDIDO_AMAZON = /^\d{3}-\d{7}-\d{7}$/;

/** `?pedido=` vindo do aviso no celular: só o formato de pedido Amazon passa. */
export function normalizarPedidoParam(valor: string | null | undefined): string | null {
  const v = (valor ?? "").trim();
  return FORMATO_PEDIDO_AMAZON.test(v) ? v : null;
}
```

Run: `npx vitest run src/modules/vendas/pedido-param.test.ts` → Expected: PASS (2 testes).

- [ ] **Step 4: Filtro na API**

Em `src/app/api/vendas/route.ts`:
1. Import: `import { normalizarPedidoParam } from "@/modules/vendas/pedido-param";`
2. Logo antes de `const where = whereVendaAmazonPorVisao(visao, filtros);`, acrescentar:
```ts
    const pedido = normalizarPedidoParam(searchParams.get("pedido"));
    if (pedido) {
      filtros.amazonOrderId = pedido;
    }
```

- [ ] **Step 5: Card destacado**

Em `src/components/vendas/order-card.tsx`:
1. Assinatura: acrescentar `destacado = false,` nos parâmetros e `destacado?: boolean;` no tipo.
2. Depois de `const [expanded, setExpanded] = React.useState(defaultExpanded);`:
```tsx
  const ref = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    if (destacado) ref.current?.scrollIntoView({ block: "center" });
  }, [destacado]);
```
3. No `<article`: acrescentar `ref={ref}` e, no `cn(...)`, a classe `destacado && "ring-2 ring-primary"`.

Em `src/components/vendas/order-card-list.tsx`:
1. Props: acrescentar `destacarPedidoId,` e `destacarPedidoId?: string | null;`.
2. Trocar `<OrderCard key={venda.id} venda={venda} defaultExpanded={idx === 0} />` por:
```tsx
        <OrderCard
          key={venda.id}
          venda={venda}
          defaultExpanded={idx === 0 || venda.amazonOrderId === destacarPedidoId}
          destacado={!!destacarPedidoId && venda.amazonOrderId === destacarPedidoId}
        />
```

- [ ] **Step 6: Página lê `?pedido=` e mostra o chip**

Em `src/app/vendas/page.tsx`:
1. Imports: `import { normalizarPedidoParam } from "@/modules/vendas/pedido-param";` e acrescentar `X` ao import de `lucide-react`.
2. Em `VendasPage`, depois de `const visaoVendas = …`:
```tsx
  // Aberto pelo aviso de venda no celular: /vendas?pedido=702-…
  const [pedidoDestaque, setPedidoDestaque] = React.useState<string | null>(null);
  React.useEffect(() => {
    const pedido = normalizarPedidoParam(
      new URLSearchParams(window.location.search).get("pedido"),
    );
    if (pedido) {
      setPedidoDestaque(pedido);
      setFiltros((f) => ({ ...f, periodo: { preset: PeriodoPreset.VITALICIO } }));
    }
  }, []);

  function limparPedidoDestaque() {
    setPedidoDestaque(null);
    setFiltros(filtrosIniciais);
    window.history.replaceState(null, "", "/vendas");
  }
```
3. No memo `params`, antes de `p.set("visao", visaoVendas);`: `if (pedidoDestaque) p.set("pedido", pedidoDestaque);` e acrescentar `pedidoDestaque` ao array de dependências.
4. `queryKey: ["vendas", filtros, pagina, visaoVendas],` → `queryKey: ["vendas", filtros, pagina, visaoVendas, pedidoDestaque],`.
5. Logo antes do PRIMEIRO `<OrderCardList` (aba principal, ~L459), inserir:
```tsx
          {pedidoDestaque && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
              <span>
                Mostrando o pedido <strong className="font-mono">{pedidoDestaque}</strong>
              </span>
              <Button variant="ghost" size="sm" className="h-9" onClick={limparPedidoDestaque}>
                <X className="mr-1 h-4 w-4" aria-hidden />
                Ver todos
              </Button>
            </div>
          )}
```
6. Nos dois `<OrderCardList`, acrescentar `destacarPedidoId={pedidoDestaque}`. No da aba principal, também `emptyHint={pedidoDestaque ? "Este pedido não está nesta conta. Se ele é da outra loja, entre na conta dela." : undefined}`. Se já houver `emptyHint`, compor com o operador ternário mantendo o texto atual como alternativa.

- [ ] **Step 7: Reembolsos em cards no celular**

Ainda em `src/app/vendas/page.tsx`, na aba "Reembolsados", na PRIMEIRA tabela (a que tem `<TableHead>SKU</TableHead>` e `<TableHead className="text-right">Vendidos</TableHead>`):
1. No `<div className="overflow-hidden rounded-md border">` que envolve essa tabela, trocar a classe por `"hidden overflow-hidden rounded-md border md:block"`.
2. Imediatamente antes desse `<div>`, inserir:
```tsx
              <div className="space-y-2 md:hidden">
                {(reembolsos?.produtos ?? []).map((produto) => (
                  <div key={produto.sku} className="rounded-xl border bg-card p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm font-medium">{produto.nome}</p>
                        <p className="text-xs text-muted-foreground">{produto.sku}</p>
                      </div>
                      <span className="shrink-0 text-sm font-bold tabular-nums">
                        {fmtPercentual(produto.taxaReembolso)}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Pedidos</p>
                        <p className="font-medium tabular-nums">
                          {produto.pedidosReembolsados}/{produto.pedidosVendidos}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Unidades</p>
                        <p className="font-medium tabular-nums">
                          {produto.unidadesReembolsadas}/{produto.unidadesVendidas}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Reembolsado</p>
                        <p className="font-medium tabular-nums">
                          {formatBRL(produto.valorReembolsadoCentavos)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
```

- [ ] **Step 8: Verificar**

Run: `npx eslint src/modules/vendas/pedido-param.ts src/app/api/vendas/route.ts src/app/vendas/page.tsx src/components/vendas/order-card.tsx src/components/vendas/order-card-list.tsx && npx tsc --noEmit`
Expected: sem erros.

Visual: `/vendas?pedido=<um amazonOrderId real do dev>` → período vitalício, só aquele pedido, aberto e com anel azul; "Ver todos" volta ao normal.

- [ ] **Step 9: Commit**

```bash
git add src/modules/vendas/pedido-param.ts src/modules/vendas/pedido-param.test.ts src/app/api/vendas/route.ts src/app/vendas/page.tsx src/components/vendas/order-card.tsx src/components/vendas/order-card-list.tsx
git commit -m "feat(vendas): abrir pedido do aviso (?pedido=) e reembolsos em cards no celular

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 10: Produto no celular — estoque, lucro por unidade e "Alterar custo"

**Files:**
- Create: `src/modules/produtos/resumo-mobile.ts`, `src/modules/produtos/resumo-mobile.test.ts` (puro, client-safe)
- Create: `src/modules/produtos/cobertura.ts`, `src/modules/produtos/cobertura.test.ts` (server)
- Create: `src/app/api/produtos/[id]/resumo-mobile/route.ts`
- Create: `src/components/produtos/alterar-custo-sheet.tsx`
- Create: `src/components/produtos/produto-mobile.tsx`
- Modify: `src/app/produtos/[id]/page.tsx`

**Interfaces:**
- Consumes:
  - `classificarFaixa`, `JANELA_VENDAS_DIAS` (`@/modules/whatsapp-estoque/service`)
  - `calcularFeesLocal`, `loadFeeEstimatorConfig` (`@/modules/produtos/fee-estimator`)
  - `resolverCustoUnitario` (`@/modules/produtos/custo-historico`)
  - `getConfigImpostoSimples`
  - `whereVendaAmazonContabilizavelEstrito`
  - `POST /api/produtos/[id]/custo-historico` `{ modo, custoCentavos, de?, ate? }`
- Produces:
  - `calcularUnidadeEstimada(...)`, `parseValorBRL(texto): number | null`, `reprojetarParaPreco(base, novoPreco, impostoBps)`
  - `type UnidadeEstimada`, `type ResumoMobileProduto`
  - `calcularCobertura(...)`
  - `GET /api/produtos/[id]/resumo-mobile` → `ResumoMobileProduto`
  - `<ProdutoMobile produtoId />`, com o slot `acaoPreco?: React.ReactNode` usado na Task 19

- [ ] **Step 1: Testes que falham**

`src/modules/produtos/resumo-mobile.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { calcularUnidadeEstimada, parseValorBRL, reprojetarParaPreco } from "./resumo-mobile";

describe("lucro por unidade (estimado)", () => {
  it("Kit Marinex: R$ 77,00, custo R$ 47,58 → R$ 8,40 (10,9%)", () => {
    const u = calcularUnidadeEstimada({
      precoCentavos: 7700,
      custoCentavos: 4758,
      comissaoCentavos: 924,
      fbaCentavos: 600,
      impostoBps: 600,
    });
    expect(u.parcelamentoCentavos).toBe(116); // 1,5% de 77,00 (≥ R$ 40)
    expect(u.impostoCentavos).toBe(462);
    expect(u.lucroCentavos).toBe(840);
    expect(u.margemPercentual).toBe(10.9);
  });

  it("abaixo de R$ 40 não há parcelamento", () => {
    const u = calcularUnidadeEstimada({
      precoCentavos: 3597,
      custoCentavos: 1788,
      comissaoCentavos: 432,
      fbaCentavos: 600,
      impostoBps: 600,
    });
    expect(u.parcelamentoCentavos).toBe(0);
  });

  it("sem custo cadastrado, lucro e margem ficam nulos", () => {
    const u = calcularUnidadeEstimada({
      precoCentavos: 7700,
      custoCentavos: null,
      comissaoCentavos: 924,
      fbaCentavos: 600,
      impostoBps: 600,
    });
    expect(u.lucroCentavos).toBeNull();
    expect(u.margemPercentual).toBeNull();
  });

  it("reprojetar para outro preço escala a comissão e mantém FBA", () => {
    const base = calcularUnidadeEstimada({
      precoCentavos: 7700,
      custoCentavos: 4758,
      comissaoCentavos: 924,
      fbaCentavos: 600,
      impostoBps: 600,
    });
    const novo = reprojetarParaPreco(base, 7990, 600);
    expect(novo.comissaoCentavos).toBe(959); // 924 × 7990/7700
    expect(novo.fbaCentavos).toBe(600);
    expect(novo.precoCentavos).toBe(7990);
  });
});

describe("parseValorBRL", () => {
  it("aceita formatos comuns de digitação", () => {
    expect(parseValorBRL("47,58")).toBe(4758);
    expect(parseValorBRL("R$ 1.234,56")).toBe(123456);
    expect(parseValorBRL("47.58")).toBe(4758);
    expect(parseValorBRL("1.234")).toBe(123400);
    expect(parseValorBRL("77")).toBe(7700);
  });

  it("rejeita vazio, zero, negativo e texto", () => {
    expect(parseValorBRL("")).toBeNull();
    expect(parseValorBRL("0")).toBeNull();
    expect(parseValorBRL("-5")).toBeNull();
    expect(parseValorBRL("abc")).toBeNull();
  });
});
```

`src/modules/produtos/cobertura.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { calcularCobertura } from "./cobertura";

const HOJE = new Date("2026-10-06T15:00:00Z");

describe("cobertura de estoque", () => {
  it("142 un com 65 vendas em 30 d → 65 dias, Seguro", () => {
    const c = calcularCobertura({ estoque: 142, vendas30d: 65, hoje: HOJE });
    expect(c.dias).toBe(65);
    expect(c.faixa).toBe("SEGURO");
    expect(c.rupturaEm).toBe("2026-12-10");
  });

  it("21 un com 74 vendas → 8 dias, Crítico", () => {
    const c = calcularCobertura({ estoque: 21, vendas30d: 74, hoje: HOJE });
    expect(c.dias).toBe(8);
    expect(c.faixa).toBe("CRITICO");
  });

  it("sem vendas em 30 d não há como estimar", () => {
    expect(calcularCobertura({ estoque: 50, vendas30d: 0, hoje: HOJE })).toEqual({
      vendas30d: 0,
      dias: null,
      faixa: null,
      rupturaEm: null,
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/produtos/resumo-mobile.test.ts src/modules/produtos/cobertura.test.ts`
Expected: FAIL (imports inexistentes).

- [ ] **Step 3: Implementar os helpers**

`src/modules/produtos/resumo-mobile.ts`:
```ts
// Contas do detalhe de produto no celular. PURO (sem db): roda também no
// cliente, para a prévia ao vivo do "Alterar custo/preço".

/** Parcelamento Amazon (AmazonForAllFee): 1,5% em vendas a partir de R$ 40. */
export const PARCELAMENTO_BPS = 150;
export const PARCELAMENTO_MINIMO_CENTAVOS = 4000;

export type UnidadeEstimada = {
  precoCentavos: number;
  comissaoCentavos: number;
  fbaCentavos: number;
  parcelamentoCentavos: number;
  impostoCentavos: number;
  custoCentavos: number | null;
  lucroCentavos: number | null;
  margemPercentual: number | null;
};

export type ResumoMobileProduto = {
  produto: {
    id: string;
    sku: string;
    asin: string | null;
    nome: string;
    imagem: string | null;
    ativo: boolean;
  };
  estoque: {
    disponivel: number;
    chegando: number;
    reservado: number;
    vendas30d: number;
    coberturaDias: number | null;
    faixa: string | null;
    rupturaEm: string | null;
  };
  preco: { centavos: number | null; sincronizadoEm: string | null };
  custo: { centavos: number | null; vigenteDesde: string | null };
  impostoBps: number;
  unidade: UnidadeEstimada | null;
};

export function calcularUnidadeEstimada(input: {
  precoCentavos: number;
  custoCentavos: number | null;
  comissaoCentavos: number;
  fbaCentavos: number;
  impostoBps: number;
}): UnidadeEstimada {
  const preco = Math.max(0, Math.round(input.precoCentavos));
  const parcelamento =
    preco >= PARCELAMENTO_MINIMO_CENTAVOS
      ? Math.round((preco * PARCELAMENTO_BPS) / 10_000)
      : 0;
  const imposto = Math.round((preco * input.impostoBps) / 10_000);
  const base = {
    precoCentavos: preco,
    comissaoCentavos: input.comissaoCentavos,
    fbaCentavos: input.fbaCentavos,
    parcelamentoCentavos: parcelamento,
    impostoCentavos: imposto,
    custoCentavos: input.custoCentavos,
  };
  if (input.custoCentavos == null || preco === 0) {
    return { ...base, lucroCentavos: null, margemPercentual: null };
  }
  const lucro =
    preco - input.comissaoCentavos - input.fbaCentavos - parcelamento - imposto - input.custoCentavos;
  return { ...base, lucroCentavos: lucro, margemPercentual: Math.round((lucro / preco) * 1000) / 10 };
}

/** Prévia com outro preço: comissão proporcional ao preço, FBA igual. */
export function reprojetarParaPreco(
  base: UnidadeEstimada,
  novoPrecoCentavos: number,
  impostoBps: number,
): UnidadeEstimada {
  const fator = base.precoCentavos > 0 ? novoPrecoCentavos / base.precoCentavos : 0;
  return calcularUnidadeEstimada({
    precoCentavos: novoPrecoCentavos,
    custoCentavos: base.custoCentavos,
    comissaoCentavos: Math.round(base.comissaoCentavos * fator),
    fbaCentavos: base.fbaCentavos,
    impostoBps,
  });
}

/** "47,58" | "R$ 1.234,56" | "47.58" | "77" → centavos; inválido ou ≤ 0 → null. */
export function parseValorBRL(texto: string): number | null {
  const limpo = texto.replace(/R\$|\s/g, "");
  if (!limpo) return null;
  let normalizado: string;
  if (limpo.includes(",")) normalizado = limpo.replace(/\./g, "").replace(",", ".");
  else if (/^\d+\.\d{1,2}$/.test(limpo)) normalizado = limpo;
  else normalizado = limpo.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(normalizado)) return null;
  const centavos = Math.round(Number(normalizado) * 100);
  return Number.isFinite(centavos) && centavos > 0 ? centavos : null;
}
```

`src/modules/produtos/cobertura.ts`:
```ts
import { classificarFaixa, JANELA_VENDAS_DIAS } from "@/modules/whatsapp-estoque/service";
import type { FaixaEstoque } from "@/modules/whatsapp-estoque/schemas";

export type Cobertura = {
  vendas30d: number;
  dias: number | null;
  faixa: FaixaEstoque | null;
  /** YYYY-MM-DD (America/Sao_Paulo) em que o estoque acaba no ritmo atual. */
  rupturaEm: string | null;
};

/** Mesma régua do resumo de estoque do WhatsApp (estoque / média de 30 d). */
export function calcularCobertura(input: {
  estoque: number;
  vendas30d: number;
  hoje: Date;
}): Cobertura {
  if (input.vendas30d <= 0) return { vendas30d: 0, dias: null, faixa: null, rupturaEm: null };
  const mediaDia = input.vendas30d / JANELA_VENDAS_DIAS;
  const dias = Math.floor(Math.max(0, input.estoque) / mediaDia);
  const rupturaEm = new Date(input.hoje.getTime() + dias * 86_400_000).toLocaleDateString(
    "en-CA",
    { timeZone: "America/Sao_Paulo" },
  );
  return { vendas30d: input.vendas30d, dias, faixa: classificarFaixa(dias), rupturaEm };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/produtos/resumo-mobile.test.ts src/modules/produtos/cobertura.test.ts`
Expected: PASS (6 + 3 testes). Se `classificarFaixa(65)` não der `"SEGURO"`, conferir as constantes em `whatsapp-estoque/schemas.ts` (crítico ≤ 15, atenção ≤ 30, seguro ≥ 60) antes de mexer no teste.

- [ ] **Step 5: Rota do detalhe mobile**

`src/app/api/produtos/[id]/resumo-mobile/route.ts`:
```ts
import { handle, ok, erro } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolverImagemProduto } from "@/lib/amazon-images";
import { getConfigImpostoSimples } from "@/modules/configuracao/imposto-simples";
import { resolverCustoUnitario } from "@/modules/produtos/custo-historico";
import { calcularFeesLocal, loadFeeEstimatorConfig } from "@/modules/produtos/fee-estimator";
import { calcularCobertura } from "@/modules/produtos/cobertura";
import {
  calcularUnidadeEstimada,
  type ResumoMobileProduto,
} from "@/modules/produtos/resumo-mobile";
import { whereVendaAmazonContabilizavelEstrito } from "@/modules/vendas/filtros";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Params) => {
  await requireSession();
  const { id } = await params;
  // findFirst: Produto é TENANT — auto-escopado à empresa da sessão.
  const produto = await db.produto.findFirst({
    where: { id },
    select: {
      id: true,
      sku: true,
      asin: true,
      nome: true,
      ativo: true,
      imagemUrl: true,
      amazonImagemUrl: true,
      estoqueAtual: true,
      amazonEstoqueDisponivel: true,
      amazonEstoqueInbound: true,
      amazonEstoqueReservado: true,
      amazonPrecoListagemCentavos: true,
      amazonPrecoListagemSyncEm: true,
      amazonCategoriaFee: true,
      custoUnitario: true,
    },
  });
  if (!produto) return erro(404, "produto não encontrado");

  const hoje = new Date();
  const [vendas, custoVigente, vigencia, cfgFees, imposto] = await Promise.all([
    db.vendaAmazon.aggregate({
      where: whereVendaAmazonContabilizavelEstrito({
        sku: produto.sku,
        dataVenda: { gte: new Date(hoje.getTime() - 30 * 86_400_000) },
      }),
      _sum: { quantidade: true },
    }),
    resolverCustoUnitario(produto.id, hoje),
    db.produtoCustoHistorico.findFirst({
      where: { produtoId: produto.id, vigenciaInicio: { lte: hoje } },
      orderBy: { vigenciaInicio: "desc" },
      select: { vigenciaInicio: true },
    }),
    loadFeeEstimatorConfig(),
    getConfigImpostoSimples(),
  ]);

  const disponivel = produto.amazonEstoqueDisponivel ?? produto.estoqueAtual;
  const cobertura = calcularCobertura({
    estoque: disponivel,
    vendas30d: vendas._sum.quantidade ?? 0,
    hoje,
  });
  const custoCentavos = custoVigente ?? produto.custoUnitario ?? null;
  const impostoBps = imposto.ativo ? imposto.aliquotaBps : 0;
  const preco = produto.amazonPrecoListagemCentavos;
  const fees =
    preco && preco > 0
      ? calcularFeesLocal(preco, 1, cfgFees, { categoriaSlug: produto.amazonCategoriaFee })
      : null;

  const resposta: ResumoMobileProduto = {
    produto: {
      id: produto.id,
      sku: produto.sku,
      asin: produto.asin,
      nome: produto.nome,
      ativo: produto.ativo,
      imagem: produto.imagemUrl
        ? `/api/produtos/${produto.id}/imagem`
        : resolverImagemProduto(produto.amazonImagemUrl, produto.asin),
    },
    estoque: {
      disponivel,
      chegando: produto.amazonEstoqueInbound ?? 0,
      reservado: produto.amazonEstoqueReservado ?? 0,
      vendas30d: cobertura.vendas30d,
      coberturaDias: cobertura.dias,
      faixa: cobertura.faixa,
      rupturaEm: cobertura.rupturaEm,
    },
    preco: {
      centavos: preco,
      sincronizadoEm: produto.amazonPrecoListagemSyncEm?.toISOString() ?? null,
    },
    custo: {
      centavos: custoCentavos,
      vigenteDesde: vigencia?.vigenciaInicio.toISOString() ?? null,
    },
    impostoBps,
    unidade:
      preco && fees
        ? calcularUnidadeEstimada({
            precoCentavos: preco,
            custoCentavos,
            comissaoCentavos: fees.comissaoCentavos + fees.closingFeeCentavos,
            fbaCentavos: fees.fbaCentavos,
            impostoBps,
          })
        : null,
  };
  return ok(resposta);
});
```
Se `tsc` reclamar do tipo de `classificarFaixa` devolver `FaixaEstoque` × `string | null`, a atribuição a `faixa: string | null` já é compatível. Não usar cast.

- [ ] **Step 6: Folha "Alterar custo"**

`src/components/produtos/alterar-custo-sheet.tsx`:
```tsx
"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { MarginBadge } from "@/components/ui/margin-badge";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  calcularUnidadeEstimada,
  parseValorBRL,
  type ResumoMobileProduto,
} from "@/modules/produtos/resumo-mobile";

type Modo = "A_PARTIR_DE_HOJE" | "PERIODO" | "HISTORICO_COMPLETO";

const MODOS: Array<{ valor: Modo; rotulo: string; ajuda: string }> = [
  { valor: "A_PARTIR_DE_HOJE", rotulo: "A partir de hoje", ajuda: "Vendas antigas mantêm o custo da época. Use para uma compra nova." },
  { valor: "PERIODO", rotulo: "Período", ajuda: "O custo vale só entre as duas datas." },
  { valor: "HISTORICO_COMPLETO", rotulo: "Todo histórico", ajuda: "Recalcula o lucro de todas as vendas deste produto." },
];

function hojeSP() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function centavosParaTexto(c: number | null) {
  return c == null ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

export function AlterarCustoSheet({
  aberto,
  onAbertoChange,
  resumo,
}: {
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
  resumo: ResumoMobileProduto;
}) {
  const qc = useQueryClient();
  const [texto, setTexto] = React.useState(centavosParaTexto(resumo.custo.centavos));
  const [modo, setModo] = React.useState<Modo>("A_PARTIR_DE_HOJE");
  const [de, setDe] = React.useState(hojeSP());
  const [ate, setAte] = React.useState(hojeSP());

  React.useEffect(() => {
    if (aberto) setTexto(centavosParaTexto(resumo.custo.centavos));
  }, [aberto, resumo.custo.centavos]);

  const novoCusto = parseValorBRL(texto);
  const u = resumo.unidade;
  const depois =
    u && novoCusto
      ? calcularUnidadeEstimada({
          precoCentavos: u.precoCentavos,
          custoCentavos: novoCusto,
          comissaoCentavos: u.comissaoCentavos,
          fbaCentavos: u.fbaCentavos,
          impostoBps: resumo.impostoBps,
        })
      : null;

  const salvar = useMutation({
    mutationFn: () =>
      fetchJSON<{ ok: true; vendasAtualizadas: number }>(
        `/api/produtos/${resumo.produto.id}/custo-historico`,
        {
          method: "POST",
          body: JSON.stringify({
            modo,
            custoCentavos: novoCusto,
            ...(modo === "PERIODO" ? { de, ate } : {}),
          }),
        },
      ),
    onSuccess: (r) => {
      toast.success(
        `Custo ${formatBRL(novoCusto ?? 0)} salvo. ${r.vendasAtualizadas} venda(s) recalculada(s).`,
      );
      void qc.invalidateQueries({ queryKey: ["produto-resumo-mobile", resumo.produto.id] });
      void qc.invalidateQueries({ queryKey: ["estoque-produto", resumo.produto.id] });
      onAbertoChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível salvar o custo."),
  });

  const ajuda = MODOS.find((m) => m.valor === modo)?.ajuda;
  const podeSalvar = !!novoCusto && (modo !== "PERIODO" || (!!de && !!ate && de <= ate));

  return (
    <Sheet open={aberto} onOpenChange={onAbertoChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] overflow-y-auto rounded-t-2xl px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <SheetTitle className="text-lg">Alterar custo</SheetTitle>
        <SheetDescription className="line-clamp-1">
          {resumo.produto.sku} · {resumo.produto.nome}
        </SheetDescription>

        <div className="mt-4 space-y-1.5">
          <Label htmlFor="novo-custo">Novo custo unitário</Label>
          <div className="flex h-12 items-center gap-2 rounded-xl border-2 border-primary px-3">
            <span className="text-lg font-semibold text-muted-foreground">R$</span>
            <Input
              id="novo-custo"
              inputMode="decimal"
              autoComplete="off"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="h-auto border-0 p-0 text-xl font-bold shadow-none focus-visible:ring-0"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Atual: {resumo.custo.centavos == null ? "sem custo" : formatBRL(resumo.custo.centavos)}
          </p>
        </div>

        <div className="mt-4 space-y-1.5">
          <p className="text-sm font-medium">Vale para</p>
          <div role="radiogroup" aria-label="Vale para" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
            {MODOS.map((m) => (
              <button
                key={m.valor}
                type="button"
                role="radio"
                aria-checked={modo === m.valor}
                onClick={() => setModo(m.valor)}
                className={cn(
                  "h-10 rounded-md text-[13px] font-medium",
                  modo === m.valor ? "bg-background shadow-sm" : "text-muted-foreground",
                )}
              >
                {m.rotulo}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{ajuda}</p>
          {modo === "PERIODO" && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="space-y-1">
                <Label htmlFor="custo-de">De</Label>
                <Input id="custo-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} className="h-11" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="custo-ate">Até</Label>
                <Input id="custo-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="h-11" />
              </div>
            </div>
          )}
        </div>

        {u && depois && (
          <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3 py-3 text-sm">
            <span className="text-muted-foreground">Lucro por unidade</span>
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground">
                {u.lucroCentavos == null ? "—" : formatBRL(u.lucroCentavos)}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <strong className={cn((depois.lucroCentavos ?? 0) < 0 && "text-red-600")}>
                {formatBRL(depois.lucroCentavos ?? 0)}
              </strong>
              <MarginBadge value={depois.margemPercentual} />
            </span>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-12" onClick={() => onAbertoChange(false)}>
            Cancelar
          </Button>
          <Button className="h-12" disabled={!podeSalvar || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? "Salvando…" : "Salvar custo"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 7: Componente do detalhe**

`src/components/produtos/produto-mobile.tsx`:
```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { MarginBadge } from "@/components/ui/margin-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DialogCustoHistorico } from "@/components/produtos/dialog-custo-historico";
import { AlterarCustoSheet } from "@/components/produtos/alterar-custo-sheet";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ResumoMobileProduto } from "@/modules/produtos/resumo-mobile";

const FAIXA_UI: Record<string, { rotulo: string; classe: string }> = {
  CRITICO: { rotulo: "Crítico", classe: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200" },
  ATENCAO: { rotulo: "Atenção", classe: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200" },
  ESTAVEL: { rotulo: "Estável", classe: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200" },
  SEGURO: { rotulo: "Seguro", classe: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200" },
};

const ROTULO =
  "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

function diaMes(iso: string | null): string {
  if (!iso) return "—";
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

function dataCurta(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function Linha({ rotulo, valor, negativo }: { rotulo: string; valor: number; negativo?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className={cn("tabular-nums", negativo && "text-red-700 dark:text-red-400")}>
        {negativo ? `−${formatBRL(valor)}` : formatBRL(valor)}
      </span>
    </div>
  );
}

export function ProdutoMobile({
  produtoId,
  acaoPreco,
}: {
  produtoId: string;
  /** Botão "Alterar" do preço (Fase 4). */
  acaoPreco?: (resumo: ResumoMobileProduto) => React.ReactNode;
}) {
  const { data, isLoading, isError } = useQuery<ResumoMobileProduto>({
    queryKey: ["produto-resumo-mobile", produtoId],
    queryFn: () => fetchJSON<ResumoMobileProduto>(`/api/produtos/${produtoId}/resumo-mobile`),
  });
  const [custoAberto, setCustoAberto] = React.useState(false);
  const [historicoAberto, setHistoricoAberto] = React.useState(false);

  const voltar = (
    <Link
      href={"/produtos" as Route}
      className="-ml-2 flex h-11 w-fit items-center gap-1 rounded-lg px-2 text-[15px] font-medium text-muted-foreground"
    >
      <ArrowLeft className="h-5 w-5" aria-hidden />
      Produtos
    </Link>
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {voltar}
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="space-y-3">
        {voltar}
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Não foi possível carregar este produto.
        </p>
      </div>
    );
  }

  const { produto, estoque, preco, custo, unidade } = data;
  const faixa = estoque.faixa ? FAIXA_UI[estoque.faixa] : null;

  return (
    <div className="space-y-3.5">
      {voltar}

      <div className="flex items-start gap-3.5">
        {produto.imagem ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={produto.imagem}
            alt={produto.nome}
            className="h-[88px] w-[88px] shrink-0 rounded-xl border bg-white object-contain"
          />
        ) : (
          <div className="h-[88px] w-[88px] shrink-0 rounded-xl border bg-muted" />
        )}
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-[17px] font-bold leading-snug">{produto.nome}</h1>
          <p className="text-xs text-muted-foreground">
            {produto.sku}
            {produto.asin ? ` · ${produto.asin}` : ""}
          </p>
          <span
            className={cn(
              "inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold",
              produto.ativo
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                : "bg-muted text-muted-foreground",
            )}
          >
            {produto.ativo ? "Ativo" : "Inativo"}
          </span>
        </div>
      </div>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className={ROTULO}>Estoque</p>
            <p className="text-[26px] font-bold leading-tight tabular-nums">{estoque.disponivel} un</p>
            <p className="text-xs text-muted-foreground">disponíveis na Amazon (FBA)</p>
          </div>
          {faixa && estoque.coberturaDias != null && (
            <span className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", faixa.classe)}>
              {estoque.coberturaDias} dias · {faixa.rotulo}
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 border-t pt-3">
          <div>
            <p className="text-[11px] text-muted-foreground">Chegando</p>
            <p className="text-[15px] font-semibold tabular-nums">{estoque.chegando} un</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Reservado</p>
            <p className="text-[15px] font-semibold tabular-nums">{estoque.reservado} un</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Vendas 30 dias</p>
            <p className="text-[15px] font-semibold tabular-nums">{estoque.vendas30d} un</p>
          </div>
        </div>
        {estoque.rupturaEm && (
          <p className="text-xs text-muted-foreground">
            No ritmo atual, o estoque dura até ~{diaMes(estoque.rupturaEm)}.
          </p>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Preço na Amazon</p>
            <p className="text-xl font-bold tabular-nums">
              {preco.centavos == null ? "—" : formatBRL(preco.centavos)}
            </p>
            <p className="text-xs text-muted-foreground">
              Lido da Amazon em {dataCurta(preco.sincronizadoEm)}
            </p>
          </div>
          {acaoPreco?.(data)}
        </div>
        <div className="flex items-center gap-3 border-t px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Custo unitário</p>
            <p className="text-xl font-bold tabular-nums">
              {custo.centavos == null ? "Sem custo" : formatBRL(custo.centavos)}
            </p>
            <p className="text-xs text-muted-foreground">
              {custo.vigenteDesde ? `Vigente desde ${dataCurta(custo.vigenteDesde)}` : "Sem vigência cadastrada"}
            </p>
          </div>
          <Button variant="outline" className="h-11 border-primary/40 text-primary" onClick={() => setCustoAberto(true)}>
            Alterar
          </Button>
        </div>
      </section>

      {unidade && (
        <section className="space-y-2 rounded-xl border bg-card p-4">
          <p className={ROTULO}>Por unidade vendida (estimado)</p>
          <Linha rotulo="Preço" valor={unidade.precoCentavos} />
          <Linha rotulo="Comissão Amazon" valor={unidade.comissaoCentavos} negativo />
          <Linha rotulo="Tarifa FBA" valor={unidade.fbaCentavos} negativo />
          {unidade.parcelamentoCentavos > 0 && (
            <Linha rotulo="Parcelamento" valor={unidade.parcelamentoCentavos} negativo />
          )}
          {unidade.impostoCentavos > 0 && (
            <Linha rotulo="Imposto Simples" valor={unidade.impostoCentavos} negativo />
          )}
          {unidade.custoCentavos != null && (
            <Linha rotulo="Custo do produto" valor={unidade.custoCentavos} negativo />
          )}
          <div className="flex items-center justify-between border-t border-dashed pt-2 text-[15px] font-bold">
            <span>Lucro por unidade</span>
            <span className="flex items-center gap-2">
              <span className={cn((unidade.lucroCentavos ?? 0) < 0 ? "text-red-600" : "text-emerald-700 dark:text-emerald-400")}>
                {unidade.lucroCentavos == null ? "—" : formatBRL(unidade.lucroCentavos)}
              </span>
              <MarginBadge value={unidade.margemPercentual} />
            </span>
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => setHistoricoAberto(true)}
        className="flex min-h-[52px] w-full items-center gap-3 rounded-xl border bg-card px-4 text-left"
      >
        <span className="flex-1 text-[15px] font-medium">Histórico de custo</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
      </button>

      <AlterarCustoSheet aberto={custoAberto} onAbertoChange={setCustoAberto} resumo={data} />
      <DialogCustoHistorico
        produtoId={produto.id}
        aberto={historicoAberto}
        onOpenChange={setHistoricoAberto}
        valorInicialCentavos={custo.centavos}
        onAplicado={() => setHistoricoAberto(false)}
      />
    </div>
  );
}
```
Antes de fechar o Step, conferir as props de `DialogCustoHistorico` (`src/components/produtos/dialog-custo-historico.tsx` L50-68). Se `valorInicialCentavos`/`onAplicado` tiverem outro tipo (ex.: `number | undefined`), ajustar a chamada (`custo.centavos ?? undefined`).

- [ ] **Step 8: Página do produto**

Em `src/app/produtos/[id]/page.tsx`:
1. Import: `import { ProdutoMobile } from "@/components/produtos/produto-mobile";`
2. No `return (`, trocar o `<div className="space-y-6">` raiz por:
```tsx
    <>
      <div className="md:hidden">
        <ProdutoMobile produtoId={id} />
      </div>
      <div className="hidden space-y-6 md:block">
```
3. Fechar com `</div></>` no lugar do `</div>` final do `return`.

- [ ] **Step 9: Verificar**

Run: `npx eslint src/modules/produtos/resumo-mobile.ts src/modules/produtos/cobertura.ts "src/app/api/produtos/[id]/resumo-mobile/route.ts" src/components/produtos/alterar-custo-sheet.tsx src/components/produtos/produto-mobile.tsx "src/app/produtos/[id]/page.tsx" && npx tsc --noEmit && npx vitest run src/modules/produtos/resumo-mobile.test.ts src/modules/produtos/cobertura.test.ts`
Expected: sem erros; PASS.

- [ ] **Step 10: Commit**

```bash
git add src/modules/produtos/resumo-mobile.ts src/modules/produtos/resumo-mobile.test.ts src/modules/produtos/cobertura.ts src/modules/produtos/cobertura.test.ts "src/app/api/produtos/[id]/resumo-mobile" src/components/produtos/alterar-custo-sheet.tsx src/components/produtos/produto-mobile.tsx "src/app/produtos/[id]/page.tsx"
git commit -m "feat(mobile): detalhe do produto no celular com estoque, lucro por unidade e alterar custo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 10B: Lista de Produtos em cards no celular

**Files:**
- Modify: `src/modules/whatsapp-estoque/schemas.ts` (recebe `classificarFaixa`, pura)
- Modify: `src/modules/whatsapp-estoque/service.ts` (L45-56: passa a reexportar)
- Modify: `src/components/produtos/lista-produtos.tsx` (render da tabela ~L1218)
- Modify: `src/components/produtos/card-resumo-estoque.tsx` (return final ~L122)

**Interfaces:**
- Produces:
  - `classificarFaixa(diasEstoque: number): FaixaEstoque` passa a viver em `@/modules/whatsapp-estoque/schemas` (client-safe); continua exportada por `service.ts`
  - cards mobile em `/produtos` linkando para `/produtos/[id]` (Task 10)

- [ ] **Step 1: `classificarFaixa` vira pura (sem db)**

Em `src/modules/whatsapp-estoque/schemas.ts`, no fim do bloco das constantes `FAIXA_*`, acrescentar (mesmo corpo que está hoje em `service.ts`):
```ts
/**
 * Classifica a cobertura de estoque em faixa. Opera sobre o valor arredondado
 * para baixo (mesma logica da cobertura exibida) para alinhar mensagem e faixa.
 * Pura (sem db): usada no servidor (resumo WhatsApp) e no cliente (cards).
 */
export function classificarFaixa(diasEstoque: number): FaixaEstoque {
  const dias = Math.floor(diasEstoque);
  if (dias <= FAIXA_CRITICO_MAX_DIAS) return FaixaEstoque.CRITICO;
  if (dias <= FAIXA_ATENCAO_MAX_DIAS) return FaixaEstoque.ATENCAO;
  if (dias < FAIXA_SEGURO_MIN_DIAS) return FaixaEstoque.ESTAVEL;
  return FaixaEstoque.SEGURO;
}
```
Em `src/modules/whatsapp-estoque/service.ts`:
1. Apagar a função `classificarFaixa` (e o comentário dela).
2. No import de `./schemas`, acrescentar `classificarFaixa,`.
3. Logo depois dos imports: `export { classificarFaixa };`, para os chamadores atuais continuarem funcionando, inclusive `service.test.ts` e o `cobertura.ts` da Task 10.
4. Se `FAIXA_*` deixarem de ser usados em `service.ts`, remover do import.

Run: `npx vitest run src/modules/whatsapp-estoque src/modules/produtos/cobertura.test.ts` → Expected: PASS (sem mudança de comportamento).

- [ ] **Step 2: Cards na lista (celular)**

Em `src/components/produtos/lista-produtos.tsx`:
1. Imports:
```ts
import type { Route } from "next";
import { ProductThumb } from "@/components/ui/product-thumb";
import { classificarFaixa, type FaixaEstoque } from "@/modules/whatsapp-estoque/schemas";
```
`Link`, `formatBRL`, `resolverImagemProduto`, `cn` e `ChevronRight` já são importados. Conferir antes de duplicar.
2. Perto dos helpers do topo (depois de `getEstoqueVendavel`), acrescentar:
```ts
const FAIXA_CARD: Record<FaixaEstoque, { rotulo: string; classe: string }> = {
  CRITICO: { rotulo: "Crítico", classe: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200" },
  ATENCAO: { rotulo: "Atenção", classe: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200" },
  ESTAVEL: { rotulo: "Estável", classe: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200" },
  SEGURO: { rotulo: "Seguro", classe: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200" },
};
```
3. No bloco de render da lista, logo depois de `) : (` + `<>` (o ramo com produtos, antes de `<div className="relative overflow-hidden">`), inserir:
```tsx
                <ul className="divide-y md:hidden">
                  {produtosPaginados.map((p) => {
                    const dias = velocidadePorId.get(p.id)?.diasEstoque ?? null;
                    const faixa = dias == null ? null : FAIXA_CARD[classificarFaixa(dias)];
                    const preco = getPrecoAmazon(p);
                    const thumb = p.imagemUrl
                      ? `/api/produtos/${p.id}/imagem`
                      : resolverImagemProduto(p.amazonImagemUrl, p.asin);
                    return (
                      <li key={p.id}>
                        <Link
                          href={`/produtos/${p.id}` as Route}
                          className="flex flex-col gap-3 px-4 py-3 active:bg-muted/60"
                        >
                          <div className="flex items-start gap-3">
                            <ProductThumb src={thumb} alt={p.nome} size={56} />
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-2 text-[15px] font-semibold leading-snug">{p.nome}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {p.sku}
                                {p.asin ? ` · ${p.asin}` : ""}
                              </p>
                            </div>
                            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                          </div>
                          <div className="grid grid-cols-4 gap-2 pl-[68px]">
                            <div>
                              <p className="text-[11px] text-muted-foreground">Estoque</p>
                              <p className="text-sm font-semibold tabular-nums">{getEstoqueVendavel(p)} un</p>
                            </div>
                            <div className="col-span-2">
                              <p className="text-[11px] text-muted-foreground">Cobertura</p>
                              {faixa && dias != null ? (
                                <span className={cn("mt-0.5 inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold", faixa.classe)}>
                                  {Math.floor(dias)} dias · {faixa.rotulo}
                                </span>
                              ) : (
                                <p className="text-sm text-muted-foreground">sem vendas</p>
                              )}
                            </div>
                            <div>
                              <p className="text-[11px] text-muted-foreground">Preço</p>
                              <p className="text-sm font-semibold tabular-nums">
                                {preco == null ? "—" : formatBRL(preco)}
                              </p>
                            </div>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
```
4. Trocar `<div className="relative overflow-hidden">` (o que envolve `<Table className="table-fixed">`) por `<div className="relative hidden overflow-hidden md:block">`. A paginação que vem depois continua compartilhada.

- [ ] **Step 3: Resumo compacto no celular**

Em `src/components/produtos/card-resumo-estoque.tsx`, trocar o `return (` final:
```tsx
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
```
por:
```tsx
  const custoEstoque = data?.custoEstoqueCentavos ?? data?.valorTotalCentavos ?? 0;
  const custoCompacto =
    custoEstoque >= 100_000
      ? `R$ ${(custoEstoque / 100_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
      : formatBRL(custoEstoque);

  return (
    <>
    <div className="grid grid-cols-3 rounded-xl border bg-card md:hidden">
      <div className="px-3 py-2.5">
        <p className="text-lg font-bold tabular-nums">{data?.total ?? 0}</p>
        <p className="text-xs text-muted-foreground">produtos</p>
      </div>
      <div className="border-l px-3 py-2.5">
        <p className={`text-lg font-bold tabular-nums ${data?.countRepor ? "text-destructive" : ""}`}>
          {data?.countRepor ?? 0}
        </p>
        <p className="text-xs text-muted-foreground">repor já</p>
      </div>
      <div className="border-l px-3 py-2.5">
        <p className="truncate text-lg font-bold tabular-nums">{custoCompacto}</p>
        <p className="text-xs text-muted-foreground">em estoque</p>
      </div>
    </div>
    <div className="hidden grid-cols-2 gap-4 sm:grid-cols-3 md:grid">
```
Fechar com `</div></>` no lugar do `</div>` final do `return`.

- [ ] **Step 4: Verificar e commitar**

Run: `npx eslint src/modules/whatsapp-estoque src/components/produtos/lista-produtos.tsx src/components/produtos/card-resumo-estoque.tsx && npx tsc --noEmit && npx vitest run src/modules/whatsapp-estoque src/modules/produtos`
Expected: sem erros; PASS.

Visual em 390 px: faixa "N produtos · N repor já · R$ X mil em estoque" + cards com foto, estoque, cobertura colorida e preço; tocar abre o detalhe. Em ≥ 768 px: tabela e cards de resumo de sempre.

```bash
git add src/modules/whatsapp-estoque/schemas.ts src/modules/whatsapp-estoque/service.ts src/components/produtos/lista-produtos.tsx src/components/produtos/card-resumo-estoque.tsx
git commit -m "feat(mobile): produtos em cards no celular com cobertura e resumo compacto

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 11: Ajustes mínimos nas telas opcionais (Agenda, DRE, sino)

**Files:**
- Modify: `src/components/agenda/agenda-view.tsx` (~L87)
- Modify: `src/app/dre/page.tsx` (~L430 e ~L749)
- Modify: `src/components/topbar/notification-bell.tsx` (~L262)

- [ ] **Step 1: Agenda abre em "Dia" no celular**

Em `AgendaView`, depois de `const [modo, setModo] = React.useState<Modo>("semana");`:
```tsx
  // A grade de 7 colunas não cabe no celular: lá a agenda abre no dia.
  React.useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setModo("dia");
  }, []);
```

- [ ] **Step 2: DRE: tabelas cruas roláveis**

Em `src/app/dre/page.tsx`, nas DUAS ocorrências de `<table className="w-full">`, envolver a tabela num `<div className="overflow-x-auto">…</div>` e trocar a classe da tabela por `"w-full min-w-[360px]"`.

- [ ] **Step 3: Sino: "marcar como lida" visível no toque**

Em `notification-bell.tsx`, na `className` do botão `aria-label="Marcar como lida"`, acrescentar `[@media(hover:none)]:opacity-100` ao final da string.

- [ ] **Step 4: Verificar e commitar**

Run: `npx eslint src/components/agenda/agenda-view.tsx src/app/dre/page.tsx src/components/topbar/notification-bell.tsx && npx tsc --noEmit`
Expected: sem erros.

```bash
git add src/components/agenda/agenda-view.tsx src/app/dre/page.tsx src/components/topbar/notification-bell.tsx
git commit -m "fix(mobile): agenda em Dia, DRE rolável e ações do sino visíveis no toque

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# FASE 3 — Aviso de venda por push (segundos, sem nome de produto)

## Task 12: Regras puras do push

**Files:**
- Create: `src/modules/push/regras.ts`
- Create: `src/modules/push/regras.test.ts`

**Interfaces:**
- Produces:
  - `JANELA_RECENCIA_MS = 7_200_000`, `LIMITE_AGRUPAMENTO = 3`
  - `type PayloadPush = { title: string; body: string; tag: string; url: string; icon: string; badge: string }`
  - `type ResumoPedido = { amazonOrderId: string; purchaseDate: Date | null; status: string | null; itens: Array<{ sku: string; quantidade: number }> }`
  - `type VendaCriadaNoSync = { amazonOrderId: string; purchaseDate: Date; status: string; valorBrutoCentavos: number; estimado: boolean }`
  - `type PedidoAgrupado = { amazonOrderId: string; purchaseDate: Date; status: string; valorCentavos: number | null; estimado: boolean }`
  - `pedidoNotificavel(p: { purchaseDate: Date | null; status: string | null }, agora: Date): boolean`
  - `formatarValorPush(centavos: number | null, estimado: boolean): string | null`
  - `montarPayloadVenda({ loja, valorCentavos, estimado, amazonOrderId, empresaId }): PayloadPush`
  - `montarPayloadAgrupado({ loja, quantidade, totalCentavos, estimado, empresaId }): PayloadPush`
  - `montarPayloadTeste(loja: string): PayloadPush`
  - `extrairResumoOrderChange(payload: Record<string, unknown> | null): ResumoPedido | null`
  - `agruparPorPedido(vendas: readonly VendaCriadaNoSync[]): PedidoAgrupado[]`

- [ ] **Step 1: Teste que falha**

`src/modules/push/regras.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatBRL } from "@/lib/money";
import {
  agruparPorPedido,
  extrairResumoOrderChange,
  montarPayloadAgrupado,
  montarPayloadTeste,
  montarPayloadVenda,
  pedidoNotificavel,
} from "./regras";

const AGORA = new Date("2026-10-06T22:35:00Z");

describe("pedidoNotificavel", () => {
  it("pedido de agora há pouco avisa", () => {
    expect(pedidoNotificavel({ purchaseDate: new Date("2026-10-06T22:33:10Z"), status: "Pending" }, AGORA)).toBe(true);
  });

  it("pedido com mais de 2 h não avisa (primeira conexão / worker voltando de queda)", () => {
    expect(pedidoNotificavel({ purchaseDate: new Date("2026-10-06T20:30:00Z"), status: "Pending" }, AGORA)).toBe(false);
  });

  it("cancelado não avisa", () => {
    expect(pedidoNotificavel({ purchaseDate: new Date("2026-10-06T22:30:00Z"), status: "Canceled" }, AGORA)).toBe(false);
  });

  it("sem data de compra não avisa (a reserva do ORDERS_SYNC cobre)", () => {
    expect(pedidoNotificavel({ purchaseDate: null, status: "Pending" }, AGORA)).toBe(false);
  });

  it("tolera relógio da Amazon alguns minutos à frente", () => {
    expect(pedidoNotificavel({ purchaseDate: new Date("2026-10-06T22:40:00Z"), status: "Unshipped" }, AGORA)).toBe(true);
  });
});

describe("texto do aviso", () => {
  const base = { loja: "MundoFS", amazonOrderId: "702-4417820-3391045", empresaId: "mundofs" };

  it("título com a loja e corpo com o valor", () => {
    const p = montarPayloadVenda({ ...base, valorCentavos: 20497, estimado: false });
    expect(p.title).toBe("Nova venda na MundoFS");
    expect(p.body).toBe(`Você teve uma nova venda de ${formatBRL(20497)}.`);
    expect(p.url).toBe("/vendas?pedido=702-4417820-3391045");
    expect(p.tag).toBe("venda-mundofs-702-4417820-3391045");
  });

  it("valor estimado ganha ~ e sem valor não inventa número", () => {
    expect(montarPayloadVenda({ ...base, valorCentavos: 7700, estimado: true }).body).toBe(
      `Você teve uma nova venda de ~${formatBRL(7700)}.`,
    );
    expect(montarPayloadVenda({ ...base, valorCentavos: null, estimado: true }).body).toBe(
      "Você teve uma nova venda.",
    );
  });

  it("o aviso só tem título, corpo, link e ícones (nunca produto/SKU/quantidade)", () => {
    const p = montarPayloadVenda({ ...base, valorCentavos: 7700, estimado: true });
    expect(Object.keys(p).sort()).toEqual(["badge", "body", "icon", "tag", "title", "url"]);
    expect(JSON.stringify(p)).not.toMatch(/MFS-|SKU|un\b/);
  });

  it("agrupado e teste", () => {
    const g = montarPayloadAgrupado({ loja: "UDN", quantidade: 4, totalCentavos: 35620, estimado: true, empresaId: "udncd" });
    expect(g.title).toBe("4 novas vendas na UDN");
    expect(g.body).toBe(`Total de ~${formatBRL(35620)}.`);
    expect(g.url).toBe("/vendas");
    expect(montarPayloadTeste("UDN").body).toBe("Os avisos de venda da UDN vão chegar assim.");
  });
});

describe("extrairResumoOrderChange", () => {
  it("lê pedido, data, status e itens do payload da Amazon", () => {
    const r = extrairResumoOrderChange({
      OrderChangeNotification: {
        AmazonOrderId: "702-4417820-3391045",
        Summary: {
          OrderStatus: "Pending",
          PurchaseDate: "2026-10-06T22:33:10Z",
          OrderItems: [
            { SellerSKU: "MFS-0036", Quantity: 1, OrderItemId: "1" },
            { SellerSKU: "MFS-0032", Quantity: 2, OrderItemId: "2" },
          ],
        },
      },
    });
    expect(r).toEqual({
      amazonOrderId: "702-4417820-3391045",
      purchaseDate: new Date("2026-10-06T22:33:10Z"),
      status: "Pending",
      itens: [
        { sku: "MFS-0036", quantidade: 1 },
        { sku: "MFS-0032", quantidade: 2 },
      ],
    });
  });

  it("payload sem pedido ou malformado devolve null", () => {
    expect(extrairResumoOrderChange(null)).toBeNull();
    expect(extrairResumoOrderChange({ OrderChangeNotification: { Summary: {} } })).toBeNull();
    expect(extrairResumoOrderChange({ OrderChangeNotification: "lixo" } as Record<string, unknown>)).toBeNull();
  });
});

describe("agruparPorPedido", () => {
  it("pedido com 2 SKUs vira 1 aviso com o valor somado", () => {
    const d = new Date("2026-10-06T22:00:00Z");
    const r = agruparPorPedido([
      { amazonOrderId: "A", purchaseDate: d, status: "Pending", valorBrutoCentavos: 7700, estimado: true },
      { amazonOrderId: "A", purchaseDate: d, status: "Pending", valorBrutoCentavos: 4997, estimado: false },
      { amazonOrderId: "B", purchaseDate: d, status: "Pending", valorBrutoCentavos: 0, estimado: true },
    ]);
    expect(r).toEqual([
      { amazonOrderId: "A", purchaseDate: d, status: "Pending", valorCentavos: 12697, estimado: true },
      { amazonOrderId: "B", purchaseDate: d, status: "Pending", valorCentavos: null, estimado: true },
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/push/regras.test.ts`
Expected: FAIL (import inexistente).

- [ ] **Step 3: Implementar**

`src/modules/push/regras.ts`:
```ts
import { formatBRL } from "@/lib/money";

// Regras puras do aviso de venda no celular. O aviso pode aparecer na tela
// bloqueada: NUNCA leva nome de produto, SKU ou quantidade — só loja e valor.

/** Pedido mais velho que isso não avisa (primeira conexão, worker voltando de queda). */
export const JANELA_RECENCIA_MS = 2 * 60 * 60 * 1000;
/** Relógio da Amazon pode vir alguns minutos à frente do nosso. */
export const TOLERANCIA_RELOGIO_MS = 10 * 60 * 1000;
/** Acima disso, numa mesma execução do ORDERS_SYNC, sai um aviso agrupado. */
export const LIMITE_AGRUPAMENTO = 3;

export const ICONE_PUSH = "/icons/icon-192.png";
export const BADGE_PUSH = "/icons/badge-96.png";

export type PayloadPush = {
  title: string;
  body: string;
  tag: string;
  url: string;
  icon: string;
  badge: string;
};

export type ResumoPedido = {
  amazonOrderId: string;
  purchaseDate: Date | null;
  status: string | null;
  itens: Array<{ sku: string; quantidade: number }>;
};

export type VendaCriadaNoSync = {
  amazonOrderId: string;
  purchaseDate: Date;
  status: string;
  valorBrutoCentavos: number;
  estimado: boolean;
};

export type PedidoAgrupado = {
  amazonOrderId: string;
  purchaseDate: Date;
  status: string;
  valorCentavos: number | null;
  estimado: boolean;
};

export function pedidoNotificavel(
  p: { purchaseDate: Date | null; status: string | null },
  agora: Date,
): boolean {
  if (!p.purchaseDate || Number.isNaN(p.purchaseDate.getTime())) return false;
  const status = (p.status ?? "").toLowerCase();
  if (status === "canceled" || status === "cancelled") return false;
  const idade = agora.getTime() - p.purchaseDate.getTime();
  return idade <= JANELA_RECENCIA_MS && idade >= -TOLERANCIA_RELOGIO_MS;
}

export function formatarValorPush(centavos: number | null, estimado: boolean): string | null {
  if (centavos == null || centavos <= 0) return null;
  return `${estimado ? "~" : ""}${formatBRL(centavos)}`;
}

export function montarPayloadVenda(input: {
  loja: string;
  valorCentavos: number | null;
  estimado: boolean;
  amazonOrderId: string;
  empresaId: string;
}): PayloadPush {
  const valor = formatarValorPush(input.valorCentavos, input.estimado);
  return {
    title: `Nova venda na ${input.loja}`,
    body: valor ? `Você teve uma nova venda de ${valor}.` : "Você teve uma nova venda.",
    tag: `venda-${input.empresaId}-${input.amazonOrderId}`,
    url: `/vendas?pedido=${encodeURIComponent(input.amazonOrderId)}`,
    icon: ICONE_PUSH,
    badge: BADGE_PUSH,
  };
}

export function montarPayloadAgrupado(input: {
  loja: string;
  quantidade: number;
  totalCentavos: number | null;
  estimado: boolean;
  empresaId: string;
}): PayloadPush {
  const total = formatarValorPush(input.totalCentavos, input.estimado);
  return {
    title: `${input.quantidade} novas vendas na ${input.loja}`,
    body: total ? `Total de ${total}.` : "Abra o Atlas para ver os pedidos.",
    tag: `vendas-${input.empresaId}`,
    url: "/vendas",
    icon: ICONE_PUSH,
    badge: BADGE_PUSH,
  };
}

export function montarPayloadTeste(loja: string): PayloadPush {
  return {
    title: "Teste do Atlas",
    body: `Os avisos de venda da ${loja} vão chegar assim.`,
    tag: "teste-atlas",
    url: "/configuracoes?tab=notificacoes",
    icon: ICONE_PUSH,
    badge: BADGE_PUSH,
  };
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function registro(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Lê o payload de ORDER_CHANGE (Notifications API v1, payloadVersion 1.0). */
export function extrairResumoOrderChange(
  payload: Record<string, unknown> | null,
): ResumoPedido | null {
  const raiz = registro(payload);
  if (!raiz) return null;
  const notif = "OrderChangeNotification" in raiz ? registro(raiz.OrderChangeNotification) : raiz;
  if (!notif) return null;
  const amazonOrderId = texto(notif.AmazonOrderId);
  if (!amazonOrderId) return null;
  const summary = registro(notif.Summary) ?? {};
  const dataTexto = texto(summary.PurchaseDate);
  const data = dataTexto ? new Date(dataTexto) : null;
  const itensBrutos = Array.isArray(summary.OrderItems) ? summary.OrderItems : [];
  const itens = itensBrutos
    .map(registro)
    .filter((i): i is Record<string, unknown> => i !== null)
    .map((i) => ({
      sku: texto(i.SellerSKU) ?? "",
      quantidade: typeof i.Quantity === "number" && i.Quantity > 0 ? i.Quantity : 1,
    }))
    .filter((i) => i.sku);
  return {
    amazonOrderId,
    purchaseDate: data && !Number.isNaN(data.getTime()) ? data : null,
    status: texto(summary.OrderStatus),
    itens,
  };
}

/** ORDERS_SYNC grava uma linha por SKU; o aviso é por pedido. */
export function agruparPorPedido(vendas: readonly VendaCriadaNoSync[]): PedidoAgrupado[] {
  const mapa = new Map<string, PedidoAgrupado>();
  for (const v of vendas) {
    const valor = v.valorBrutoCentavos > 0 ? v.valorBrutoCentavos : 0;
    const atual = mapa.get(v.amazonOrderId);
    if (!atual) {
      mapa.set(v.amazonOrderId, {
        amazonOrderId: v.amazonOrderId,
        purchaseDate: v.purchaseDate,
        status: v.status,
        valorCentavos: valor > 0 ? valor : null,
        estimado: v.estimado,
      });
      continue;
    }
    atual.valorCentavos = (atual.valorCentavos ?? 0) + valor || null;
    atual.estimado = atual.estimado || v.estimado;
    if (v.purchaseDate < atual.purchaseDate) atual.purchaseDate = v.purchaseDate;
  }
  return [...mapa.values()];
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/push/regras.test.ts`
Expected: PASS (12 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/push/regras.ts src/modules/push/regras.test.ts
git commit -m "feat(push): regras puras do aviso de venda (loja + valor, recência, agrupamento)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 13: Modelos Prisma e entrega do push (VAPID + idempotência)

**Files:**
- Modify: `package.json` / `package-lock.json` (deps `web-push`, `@types/web-push`)
- Modify: `prisma/schema.prisma` e `prisma/schema.postgresql.prisma` (models novos no fim do bloco "Notificacao")
- Create: `prisma/migrations/20261007120000_push_mobile/migration.sql`
- Modify: `src/lib/db.ts` (`TENANT_MODELS`, `GLOBAL_MODELS`), `src/lib/tenant-isolation.test.ts`
- Create: `src/modules/push/envio.ts`, `src/modules/push/envio.test.ts`

**Interfaces:**
- Consumes: Task 12 (`PayloadPush`, `montarPayloadVenda`).
- Produces:
  - `TipoPushEnvio = { VENDA_NOVA, VENDAS_AGRUPADAS, TESTE }`
  - `type VapidConfig = { publicKey: string; privateKey: string; subject: string }`
  - `getVapidConfig(env?: Record<string, string | undefined>): VapidConfig | null`
  - `reservarEnvio({ empresaId, tipo, dedupeKey, payload }): Promise<string | null>` (`null` = já avisado)
  - `entregar({ empresaId, payload, usuarioId?, cfg? }): Promise<ResultadoEntrega>`
  - `concluirEnvio(envioId: string, r: ResultadoEntrega): Promise<void>`
  - `enviarPush({ empresaId, tipo, dedupeKey, payload, usuarioId?, cfg? }): Promise<ResultadoEntrega & { duplicado: boolean }>`
  - `type ResultadoEntrega = { destinos: number; ok: number; falhas: number }`
  - Prisma: `db.pushDispositivo` (unique `empresaId_endpoint`), `db.pushEnvio` (unique `empresaId_dedupeKey`)

- [ ] **Step 1: Dependências**

```bash
npm install web-push@^3.6.7
npm install -D @types/web-push@^3.6.4
```
Expected: `package.json` com `web-push` em `dependencies` e `@types/web-push` em `devDependencies`.

- [ ] **Step 2: Models nos DOIS schemas**

Acrescentar, logo depois do `model Notificacao { … }`, em `prisma/schema.prisma` **e** em `prisma/schema.postgresql.prisma` (texto idêntico):
```prisma
// ── Push (Atlas mobile) ─────────────────────────────────────────────────────
// Aparelho inscrito para receber aviso de venda. GLOBAL em db.ts: o mesmo
// celular pode estar inscrito em várias empresas (MundoFS e UDN) — a chave é
// [empresaId, endpoint]. Toda leitura filtra empresaId/usuarioId explicitamente.
model PushDispositivo {
  id                 String    @id @default(cuid())
  empresaId          String
  usuarioId          String
  endpoint           String
  p256dh             String
  auth               String
  userAgent          String?
  apelido            String?
  receberVendas      Boolean   @default(true)
  ativo              Boolean   @default(true)
  falhasConsecutivas Int       @default(0)
  ultimoEnvioEm      DateTime?
  criadoEm           DateTime  @default(now())
  atualizadoEm       DateTime  @updatedAt

  @@unique([empresaId, endpoint])
  @@index([empresaId, ativo])
  @@index([usuarioId])
  @@index([endpoint])
}

// Histórico + idempotência dos avisos (TENANT). dedupeKey "venda:<orderId>":
// o primeiro gatilho (SQS ou ORDERS_SYNC) reserva; o segundo vira no-op.
model PushEnvio {
  id          String    @id @default(cuid())
  empresaId   String?
  tipo        String
  dedupeKey   String?
  payloadJson String
  status      String    @default("PENDENTE")
  enviadosOk  Int       @default(0)
  falhas      Int       @default(0)
  erro        String?
  criadoEm    DateTime  @default(now())
  enviadoEm   DateTime?

  @@unique([empresaId, dedupeKey])
  @@index([criadoEm])
}
```

- [ ] **Step 3: Migration Postgres (manual)**

`prisma/migrations/20261007120000_push_mobile/migration.sql`:
```sql
-- Atlas mobile: aparelhos inscritos para push e histórico/idempotência dos avisos.
-- Só cria tabelas novas: zero risco para dados existentes.

CREATE TABLE "PushDispositivo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "apelido" TEXT,
    "receberVendas" BOOLEAN NOT NULL DEFAULT true,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "falhasConsecutivas" INTEGER NOT NULL DEFAULT 0,
    "ultimoEnvioEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PushDispositivo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushDispositivo_empresaId_endpoint_key" ON "PushDispositivo"("empresaId", "endpoint");
CREATE INDEX "PushDispositivo_empresaId_ativo_idx" ON "PushDispositivo"("empresaId", "ativo");
CREATE INDEX "PushDispositivo_usuarioId_idx" ON "PushDispositivo"("usuarioId");
CREATE INDEX "PushDispositivo_endpoint_idx" ON "PushDispositivo"("endpoint");

CREATE TABLE "PushEnvio" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT,
    "tipo" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "enviadosOk" INTEGER NOT NULL DEFAULT 0,
    "falhas" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadoEm" TIMESTAMP(3),
    CONSTRAINT "PushEnvio_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushEnvio_empresaId_dedupeKey_key" ON "PushEnvio"("empresaId", "dedupeKey");
CREATE INDEX "PushEnvio_criadoEm_idx" ON "PushEnvio"("criadoEm");
```

- [ ] **Step 4: Validar schemas e gerar o client**

```bash
npx prisma validate
npx prisma validate --schema prisma/schema.postgresql.prisma
npm run prisma:generate
npm run prisma:push
```
Expected:
- `The schema … is valid` duas vezes;
- client gerado;
- `prisma db push` aplica as tabelas no `dev.db` local.

Parar o `next dev`, se estiver rodando (CLAUDE.md, "Processo ao alterar Prisma").

- [ ] **Step 5: Classificação de tenant**

Em `src/lib/db.ts`:
- no `TENANT_MODELS`, acrescentar `"PushEnvio",` ao lado de `"Notificacao",`;
- no `GLOBAL_MODELS`, acrescentar ao final:
```ts
  // Aparelho de push: o MESMO celular pode estar inscrito em várias empresas
  // ([empresaId, endpoint]) e a limpeza de inscrição morta (410) vale para
  // todas. Escopo explícito no módulo push/dispositivos (empresaId+usuarioId).
  "PushDispositivo",
```

Em `src/lib/tenant-isolation.test.ts`, dentro de `describe("classificacao dos models novos (A+B)", …)`, acrescentar:
```ts
  it("PushDispositivo é GLOBAL e PushEnvio é TENANT", () => {
    expect(GLOBAL_MODEL_NAMES.has("PushDispositivo")).toBe(true);
    expect(TENANT_MODEL_NAMES.has("PushDispositivo")).toBe(false);
    expect(TENANT_MODEL_NAMES.has("PushEnvio")).toBe(true);
  });
```

Run: `npx vitest run src/lib/tenant-isolation.test.ts` → Expected: PASS. Se houver teste que confere "todo model do schema está em uma lista", ele também passa.

- [ ] **Step 6: Teste que falha da entrega**

`src/modules/push/envio.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { dbMock, sendMock } = vi.hoisted(() => ({
  dbMock: {
    pushEnvio: { create: vi.fn(), update: vi.fn() },
    pushDispositivo: { findMany: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  },
  sendMock: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("web-push", () => ({ default: { sendNotification: sendMock } }));

import { entregar, enviarPush, getVapidConfig, reservarEnvio, TipoPushEnvio } from "./envio";
import { montarPayloadVenda } from "./regras";

const CFG = { publicKey: "pub", privateKey: "priv", subject: "https://erp.mundofs.cloud" };
const PAYLOAD = montarPayloadVenda({
  loja: "MundoFS",
  valorCentavos: 7700,
  estimado: true,
  amazonOrderId: "702-0000000-0000001",
  empresaId: "mundofs",
});
const disp = (id: string, endpoint: string, falhasConsecutivas = 0) => ({
  id,
  endpoint,
  p256dh: "p",
  auth: "a",
  falhasConsecutivas,
});

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.pushEnvio.create.mockResolvedValue({ id: "env1" });
  dbMock.pushEnvio.update.mockResolvedValue({});
  dbMock.pushDispositivo.update.mockResolvedValue({});
  dbMock.pushDispositivo.deleteMany.mockResolvedValue({ count: 1 });
  dbMock.pushDispositivo.findMany.mockResolvedValue([]);
  sendMock.mockResolvedValue({ statusCode: 201 });
});

describe("getVapidConfig", () => {
  it("sem chaves, push fica desligado", () => {
    expect(getVapidConfig({})).toBeNull();
  });
  it("subject padrão é o domínio do ERP (sem e-mail pessoal)", () => {
    expect(getVapidConfig({ VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b" })?.subject).toBe(
      "https://erp.mundofs.cloud",
    );
  });
});

describe("reservarEnvio", () => {
  it("dedupe já usado (P2002) devolve null = já avisado", async () => {
    dbMock.pushEnvio.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5.22.0" }),
    );
    expect(
      await reservarEnvio({ empresaId: "mundofs", tipo: TipoPushEnvio.VENDA_NOVA, dedupeKey: "venda:1", payload: PAYLOAD }),
    ).toBeNull();
  });
});

describe("entregar", () => {
  it("vai só para aparelhos ativos DA EMPRESA da venda que querem vendas", async () => {
    dbMock.pushDispositivo.findMany.mockResolvedValue([disp("d1", "https://fcm/1")]);
    const r = await entregar({ empresaId: "udncd", payload: PAYLOAD, cfg: CFG });
    expect(dbMock.pushDispositivo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { empresaId: "udncd", ativo: true, receberVendas: true } }),
    );
    expect(sendMock).toHaveBeenCalledWith(
      { endpoint: "https://fcm/1", keys: { p256dh: "p", auth: "a" } },
      JSON.stringify(PAYLOAD),
      expect.objectContaining({ TTL: 3600, urgency: "high" }),
    );
    expect(r).toEqual({ destinos: 1, ok: 1, falhas: 0 });
  });

  it("teste vai só para os aparelhos do próprio usuário", async () => {
    await entregar({ empresaId: "mundofs", payload: PAYLOAD, usuarioId: "u1", cfg: CFG });
    expect(dbMock.pushDispositivo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { empresaId: "mundofs", ativo: true, usuarioId: "u1" } }),
    );
  });

  it("inscrição expirada (410) é apagada em todas as lojas daquele aparelho", async () => {
    dbMock.pushDispositivo.findMany.mockResolvedValue([disp("d1", "https://fcm/1")]);
    sendMock.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    const r = await entregar({ empresaId: "mundofs", payload: PAYLOAD, cfg: CFG });
    expect(dbMock.pushDispositivo.deleteMany).toHaveBeenCalledWith({ where: { endpoint: "https://fcm/1" } });
    expect(r).toEqual({ destinos: 1, ok: 0, falhas: 1 });
  });

  it("5ª falha seguida desativa o aparelho", async () => {
    dbMock.pushDispositivo.findMany.mockResolvedValue([disp("d1", "https://fcm/1", 4)]);
    sendMock.mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 500 }));
    await entregar({ empresaId: "mundofs", payload: PAYLOAD, cfg: CFG });
    expect(dbMock.pushDispositivo.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { falhasConsecutivas: 5, ativo: false },
    });
  });

  it("sem VAPID não consulta nem envia", async () => {
    const r = await entregar({ empresaId: "mundofs", payload: PAYLOAD, cfg: null });
    expect(dbMock.pushDispositivo.findMany).not.toHaveBeenCalled();
    expect(r).toEqual({ destinos: 0, ok: 0, falhas: 0 });
  });
});

describe("enviarPush", () => {
  it("pedido já avisado não entrega de novo", async () => {
    dbMock.pushEnvio.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5.22.0" }),
    );
    const r = await enviarPush({ empresaId: "mundofs", tipo: TipoPushEnvio.VENDA_NOVA, dedupeKey: "venda:1", payload: PAYLOAD, cfg: CFG });
    expect(r.duplicado).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("registra ENVIADO com a contagem", async () => {
    dbMock.pushDispositivo.findMany.mockResolvedValue([disp("d1", "https://fcm/1")]);
    await enviarPush({ empresaId: "mundofs", tipo: TipoPushEnvio.VENDA_NOVA, dedupeKey: "venda:1", payload: PAYLOAD, cfg: CFG });
    expect(dbMock.pushEnvio.update).toHaveBeenCalledWith({
      where: { id: "env1" },
      data: expect.objectContaining({ status: "ENVIADO", enviadosOk: 1, falhas: 0 }),
    });
  });
});
```

Run: `npx vitest run src/modules/push/envio.test.ts` → Expected: FAIL (import inexistente).

- [ ] **Step 7: Implementar a entrega**

`src/modules/push/envio.ts`:
```ts
import webpush from "web-push";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { PayloadPush } from "./regras";

export const TipoPushEnvio = {
  VENDA_NOVA: "VENDA_NOVA",
  VENDAS_AGRUPADAS: "VENDAS_AGRUPADAS",
  TESTE: "TESTE",
} as const;
export type TipoPushEnvio = (typeof TipoPushEnvio)[keyof typeof TipoPushEnvio];

export const MAX_FALHAS_CONSECUTIVAS = 5;
const SUBJECT_PADRAO = "https://erp.mundofs.cloud";

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };
export type ResultadoEntrega = { destinos: number; ok: number; falhas: number };

export function getVapidConfig(
  env: Record<string, string | undefined> = process.env,
): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: env.VAPID_SUBJECT?.trim() || SUBJECT_PADRAO };
}

/** Reserva o aviso. null = esse dedupeKey já foi usado (outro gatilho avisou antes). */
export async function reservarEnvio(input: {
  empresaId: string;
  tipo: TipoPushEnvio;
  dedupeKey: string | null;
  payload: PayloadPush;
}): Promise<string | null> {
  try {
    const criado = await db.pushEnvio.create({
      data: {
        empresaId: input.empresaId,
        tipo: input.tipo,
        dedupeKey: input.dedupeKey,
        payloadJson: JSON.stringify(input.payload),
      },
      select: { id: true },
    });
    return criado.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
}

export async function entregar(input: {
  empresaId: string;
  payload: PayloadPush;
  /** Só para o teste: aparelhos de um usuário. Sem isso: quem quer vendas. */
  usuarioId?: string;
  cfg?: VapidConfig | null;
}): Promise<ResultadoEntrega> {
  const cfg = input.cfg === undefined ? getVapidConfig() : input.cfg;
  if (!cfg) return { destinos: 0, ok: 0, falhas: 0 };

  const dispositivos = await db.pushDispositivo.findMany({
    where: {
      empresaId: input.empresaId,
      ativo: true,
      ...(input.usuarioId ? { usuarioId: input.usuarioId } : { receberVendas: true }),
    },
    select: { id: true, endpoint: true, p256dh: true, auth: true, falhasConsecutivas: true },
  });

  const corpo = JSON.stringify(input.payload);
  const resultados = await Promise.all(
    dispositivos.map(async (d) => {
      try {
        await webpush.sendNotification(
          { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
          corpo,
          {
            TTL: 3600,
            urgency: "high",
            timeout: 5000,
            vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey },
          },
        );
        await db.pushDispositivo.update({
          where: { id: d.id },
          data: { ultimoEnvioEm: new Date(), falhasConsecutivas: 0 },
        });
        return true;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // A inscrição morreu no navegador: vale para todas as lojas do aparelho.
          await db.pushDispositivo.deleteMany({ where: { endpoint: d.endpoint } });
        } else {
          const falhas = d.falhasConsecutivas + 1;
          await db.pushDispositivo.update({
            where: { id: d.id },
            data: { falhasConsecutivas: falhas, ativo: falhas < MAX_FALHAS_CONSECUTIVAS },
          });
          logger.warn({ status, dispositivoId: d.id }, "push: falha ao entregar");
        }
        return false;
      }
    }),
  );
  const ok = resultados.filter(Boolean).length;
  return { destinos: dispositivos.length, ok, falhas: dispositivos.length - ok };
}

export async function concluirEnvio(envioId: string, r: ResultadoEntrega): Promise<void> {
  const status = r.destinos === 0 ? "SEM_DESTINO" : r.ok > 0 ? "ENVIADO" : "ERRO";
  await db.pushEnvio.update({
    where: { id: envioId },
    data: { status, enviadosOk: r.ok, falhas: r.falhas, enviadoEm: new Date() },
  });
}

export async function enviarPush(input: {
  empresaId: string;
  tipo: TipoPushEnvio;
  dedupeKey: string | null;
  payload: PayloadPush;
  usuarioId?: string;
  cfg?: VapidConfig | null;
}): Promise<ResultadoEntrega & { duplicado: boolean }> {
  const envioId = await reservarEnvio(input);
  if (!envioId) return { destinos: 0, ok: 0, falhas: 0, duplicado: true };
  const r = await entregar(input);
  await concluirEnvio(envioId, r);
  return { ...r, duplicado: false };
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npx vitest run src/modules/push/envio.test.ts src/lib/tenant-isolation.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck e commit**

Run: `npx eslint src/modules/push src/lib/db.ts && npx tsc --noEmit`
Expected: sem erros. Se `vapidDetails`/`urgency`/`timeout` não existirem no tipo de `@types/web-push` instalado, conferir a versão; os três existem em `@types/web-push` ≥ 3.3.

```bash
git add package.json package-lock.json prisma/schema.prisma prisma/schema.postgresql.prisma prisma/migrations/20261007120000_push_mobile src/lib/db.ts src/lib/tenant-isolation.test.ts src/modules/push/envio.ts src/modules/push/envio.test.ts
git commit -m "feat(push): modelos PushDispositivo/PushEnvio e entrega com VAPID e idempotência

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 14: Aparelhos inscritos e API do push

**Files:**
- Create: `src/modules/push/loja.ts`
- Create: `src/modules/push/dispositivos.ts`, `src/modules/push/dispositivos.test.ts`
- Create: `src/app/api/push/config/route.ts`
- Create: `src/app/api/push/dispositivos/route.ts`
- Create: `src/app/api/push/teste/route.ts`

**Interfaces:**
- Consumes: Task 13 (`enviarPush`, `getVapidConfig`, `TipoPushEnvio`), Task 12 (`montarPayloadTeste`), Task 2 (`TipoAuditLog.PUSH_*`).
- Produces:
  - `nomeDaLoja(empresaId: string, agora?: number): Promise<string>`
  - `inscricaoSchema` (zod `{ endpoint, keys: { p256dh, auth } }`)
  - `apelidoDoUserAgent(ua: string | null | undefined): string`
  - `inscreverDispositivo(...)`, `listarDispositivos(...)`, `atualizarPreferencia(...)`, `removerDispositivo(...)`
  - `type DispositivoPush = { id: string; apelido: string | null; endpoint: string; receberVendas: boolean; ativo: boolean; criadoEm: Date; ultimoEnvioEm: Date | null }`
  - `GET /api/push/config` → `{ enabled: boolean; publicKey: string | null; loja: string }`
  - `GET|POST|PATCH|DELETE /api/push/dispositivos`
  - `POST /api/push/teste` → `{ enviados: number; destinos: number }` (429 se menos de 30 s desde o último teste)

- [ ] **Step 1: Teste que falha**

`src/modules/push/dispositivos.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    pushDispositivo: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import {
  apelidoDoUserAgent,
  atualizarPreferencia,
  inscreverDispositivo,
  inscricaoSchema,
  removerDispositivo,
} from "./dispositivos";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.pushDispositivo.upsert.mockResolvedValue({ id: "d1" });
  dbMock.pushDispositivo.deleteMany.mockResolvedValue({ count: 1 });
  dbMock.pushDispositivo.updateMany.mockResolvedValue({ count: 1 });
});

describe("mesmo celular em duas lojas", () => {
  it("cria uma inscrição por empresa para o mesmo endpoint", async () => {
    const base = { usuarioId: "u1", endpoint: "https://web.push.apple.com/abc", p256dh: "p", auth: "a", userAgent: IPHONE };
    await inscreverDispositivo({ ...base, empresaId: "mundofs" });
    await inscreverDispositivo({ ...base, usuarioId: "u9", empresaId: "udncd" });
    const chaves = dbMock.pushDispositivo.upsert.mock.calls.map((c) => c[0].where.empresaId_endpoint);
    expect(chaves).toEqual([
      { empresaId: "mundofs", endpoint: base.endpoint },
      { empresaId: "udncd", endpoint: base.endpoint },
    ]);
    expect(dbMock.pushDispositivo.upsert.mock.calls[0][0].create.apelido).toBe("iPhone");
  });

  it("remover numa loja não toca a outra (filtro por empresa e usuário)", async () => {
    await removerDispositivo({ empresaId: "mundofs", usuarioId: "u1", endpoint: "https://web.push.apple.com/abc" });
    expect(dbMock.pushDispositivo.deleteMany).toHaveBeenCalledWith({
      where: { empresaId: "mundofs", usuarioId: "u1", endpoint: "https://web.push.apple.com/abc" },
    });
  });

  it("remover exige endpoint ou id", async () => {
    await expect(removerDispositivo({ empresaId: "mundofs", usuarioId: "u1" })).rejects.toThrow();
  });

  it("preferência só muda o aparelho do próprio usuário na própria loja", async () => {
    await atualizarPreferencia({ empresaId: "udncd", usuarioId: "u9", endpoint: "https://e", receberVendas: false });
    expect(dbMock.pushDispositivo.updateMany).toHaveBeenCalledWith({
      where: { empresaId: "udncd", usuarioId: "u9", endpoint: "https://e" },
      data: { receberVendas: false },
    });
  });
});

describe("validação e apelido", () => {
  it("endpoint precisa ser https", () => {
    expect(inscricaoSchema.safeParse({ endpoint: "http://x.com/1", keys: { p256dh: "p".repeat(20), auth: "a".repeat(10) } }).success).toBe(false);
    expect(inscricaoSchema.safeParse({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "p".repeat(20), auth: "a".repeat(10) } }).success).toBe(true);
  });

  it("apelido legível a partir do navegador", () => {
    expect(apelidoDoUserAgent(IPHONE)).toBe("iPhone");
    expect(apelidoDoUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/126 Mobile")).toBe("Android");
    expect(apelidoDoUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/154")).toBe("Computador (Windows)");
    expect(apelidoDoUserAgent(null)).toBe("Navegador");
  });
});
```

Run: `npx vitest run src/modules/push/dispositivos.test.ts` → Expected: FAIL.

- [ ] **Step 2: Implementar loja e dispositivos**

`src/modules/push/loja.ts`:
```ts
import { db } from "@/lib/db";

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { nome: string; expira: number }>();

/** Nome da loja no aviso ("Nova venda na MundoFS"). Empresa é GLOBAL. */
export async function nomeDaLoja(empresaId: string, agora = Date.now()): Promise<string> {
  const emCache = cache.get(empresaId);
  if (emCache && emCache.expira > agora) return emCache.nome;
  const empresa = await db.empresa.findUnique({ where: { id: empresaId }, select: { nome: true } });
  const nome = empresa?.nome?.trim() || "sua loja";
  cache.set(empresaId, { nome, expira: agora + TTL_MS });
  return nome;
}
```

`src/modules/push/dispositivos.ts`:
```ts
import { z } from "zod";
import { db } from "@/lib/db";

// PushDispositivo é GLOBAL (db.ts): cada acesso aqui filtra empresaId e
// usuarioId explicitamente.

export const inscricaoSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(1000)
    .refine((u) => u.startsWith("https://"), "endpoint precisa ser https"),
  keys: z.object({
    p256dh: z.string().min(10).max(200),
    auth: z.string().min(8).max(100),
  }),
});

export type DispositivoPush = {
  id: string;
  apelido: string | null;
  endpoint: string;
  receberVendas: boolean;
  ativo: boolean;
  criadoEm: Date;
  ultimoEnvioEm: Date | null;
};

export function apelidoDoUserAgent(ua: string | null | undefined): string {
  const s = (ua ?? "").toLowerCase();
  if (!s) return "Navegador";
  if (s.includes("iphone")) return "iPhone";
  if (s.includes("ipad")) return "iPad";
  if (s.includes("android")) return "Android";
  if (s.includes("windows")) return "Computador (Windows)";
  if (s.includes("macintosh")) return "Computador (Mac)";
  if (s.includes("linux")) return "Computador (Linux)";
  return "Navegador";
}

export async function inscreverDispositivo(input: {
  empresaId: string;
  usuarioId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}): Promise<{ id: string }> {
  return db.pushDispositivo.upsert({
    where: { empresaId_endpoint: { empresaId: input.empresaId, endpoint: input.endpoint } },
    update: {
      usuarioId: input.usuarioId,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent,
      ativo: true,
      falhasConsecutivas: 0,
    },
    create: {
      empresaId: input.empresaId,
      usuarioId: input.usuarioId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent,
      apelido: apelidoDoUserAgent(input.userAgent),
    },
    select: { id: true },
  });
}

export async function listarDispositivos(input: {
  empresaId: string;
  usuarioId: string;
}): Promise<DispositivoPush[]> {
  return db.pushDispositivo.findMany({
    where: { empresaId: input.empresaId, usuarioId: input.usuarioId },
    select: {
      id: true,
      apelido: true,
      endpoint: true,
      receberVendas: true,
      ativo: true,
      criadoEm: true,
      ultimoEnvioEm: true,
    },
    orderBy: { criadoEm: "desc" },
  });
}

export async function atualizarPreferencia(input: {
  empresaId: string;
  usuarioId: string;
  endpoint: string;
  receberVendas: boolean;
}): Promise<number> {
  const r = await db.pushDispositivo.updateMany({
    where: { empresaId: input.empresaId, usuarioId: input.usuarioId, endpoint: input.endpoint },
    data: { receberVendas: input.receberVendas },
  });
  return r.count;
}

export async function removerDispositivo(input: {
  empresaId: string;
  usuarioId: string;
  endpoint?: string;
  id?: string;
}): Promise<number> {
  if (!input.endpoint && !input.id) throw new Error("informe o aparelho (endpoint ou id)");
  const r = await db.pushDispositivo.deleteMany({
    where: {
      empresaId: input.empresaId,
      usuarioId: input.usuarioId,
      ...(input.endpoint ? { endpoint: input.endpoint } : {}),
      ...(input.id ? { id: input.id } : {}),
    },
  });
  return r.count;
}
```

Run: `npx vitest run src/modules/push/dispositivos.test.ts` → Expected: PASS (6 testes).

- [ ] **Step 3: Rotas**

`src/app/api/push/config/route.ts`:
```ts
import { handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { currentEmpresaIdOrDefault } from "@/lib/tenant-context";
import { getVapidConfig } from "@/modules/push/envio";
import { nomeDaLoja } from "@/modules/push/loja";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const session = await requireSession();
  const cfg = getVapidConfig();
  const loja = await nomeDaLoja(session.empresaId ?? currentEmpresaIdOrDefault());
  return ok({ enabled: !!cfg, publicKey: cfg?.publicKey ?? null, loja });
});
```

`src/app/api/push/dispositivos/route.ts`:
```ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { erro, handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { currentEmpresaIdOrDefault } from "@/lib/tenant-context";
import type { SessionPayload } from "@/lib/session";
import { TipoAuditLog } from "@/modules/shared/domain";
import {
  atualizarPreferencia,
  inscreverDispositivo,
  inscricaoSchema,
  listarDispositivos,
  removerDispositivo,
} from "@/modules/push/dispositivos";

export const dynamic = "force-dynamic";

function escopo(session: SessionPayload) {
  return { empresaId: session.empresaId ?? currentEmpresaIdOrDefault(), usuarioId: session.uid };
}

export const GET = handle(async () => {
  const session = await requireSession();
  return ok({ dispositivos: await listarDispositivos(escopo(session)) });
});

export const POST = handle(async (req: NextRequest) => {
  const session = await requireSession();
  const body = inscricaoSchema.parse(await req.json());
  const dispositivo = await inscreverDispositivo({
    ...escopo(session),
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
    userAgent: req.headers.get("user-agent"),
  });
  await auditLog({
    session,
    req,
    acao: TipoAuditLog.PUSH_DISPOSITIVO_ATIVADO,
    entidade: "PushDispositivo",
    entidadeId: dispositivo.id,
  });
  return ok({ dispositivo });
});

const patchSchema = z.object({ endpoint: z.string().url(), receberVendas: z.boolean() });

export const PATCH = handle(async (req: NextRequest) => {
  const session = await requireSession();
  const body = patchSchema.parse(await req.json());
  const n = await atualizarPreferencia({ ...escopo(session), ...body });
  if (n === 0) return erro(404, "aparelho não encontrado");
  return ok({ ok: true });
});

const deleteSchema = z
  .object({ endpoint: z.string().url().optional(), id: z.string().min(1).optional() })
  .refine((b) => !!b.endpoint || !!b.id, "informe o aparelho");

export const DELETE = handle(async (req: NextRequest) => {
  const session = await requireSession();
  const body = deleteSchema.parse(await req.json());
  const removidos = await removerDispositivo({ ...escopo(session), ...body });
  await auditLog({
    session,
    req,
    acao: TipoAuditLog.PUSH_DISPOSITIVO_REMOVIDO,
    entidade: "PushDispositivo",
    entidadeId: body.id ?? null,
    metadata: { removidos },
  });
  return ok({ removidos });
});
```

`src/app/api/push/teste/route.ts`:
```ts
import { erro, handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { currentEmpresaIdOrDefault } from "@/lib/tenant-context";
import { enviarPush, TipoPushEnvio } from "@/modules/push/envio";
import { nomeDaLoja } from "@/modules/push/loja";
import { montarPayloadTeste } from "@/modules/push/regras";

export const dynamic = "force-dynamic";

const INTERVALO_MS = 30_000;
const ultimoTeste = new Map<string, number>();

export const POST = handle(async () => {
  const session = await requireSession();
  const agora = Date.now();
  if (agora - (ultimoTeste.get(session.uid) ?? 0) < INTERVALO_MS) {
    return erro(429, "Aguarde alguns segundos para enviar outro teste.");
  }
  ultimoTeste.set(session.uid, agora);
  const empresaId = session.empresaId ?? currentEmpresaIdOrDefault();
  const r = await enviarPush({
    empresaId,
    tipo: TipoPushEnvio.TESTE,
    dedupeKey: null,
    payload: montarPayloadTeste(await nomeDaLoja(empresaId)),
    usuarioId: session.uid,
  });
  return ok({ enviados: r.ok, destinos: r.destinos });
});
```

- [ ] **Step 4: Verificar e commitar**

Run: `npx eslint src/modules/push src/app/api/push && npx tsc --noEmit && npx vitest run src/modules/push`
Expected: sem erros; todos PASS.

```bash
git add src/modules/push/loja.ts src/modules/push/dispositivos.ts src/modules/push/dispositivos.test.ts src/app/api/push
git commit -m "feat(push): aparelhos por loja e API de inscrição, preferências e teste

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 15: Gatilhos do aviso de venda (SQS primeiro, ORDERS_SYNC de reserva)

**Files:**
- Create: `src/modules/push/vendas.ts`, `src/modules/push/vendas.test.ts`
- Modify: `src/lib/amazon-sqs.ts` (`dispatchNotification`, `case "ORDER_CHANGE"`, ~L332) — **só 2 linhas + 1 import**
- Modify: `src/modules/amazon/service.ts` (`syncOrdersInternal`: counters ~L737, `criadas++` ~L1133, `return` ~L1163; import de `PRECO_ORIGEM_LISTING` ~L71)

**Interfaces:**
- Consumes:
  - Task 12: `extrairResumoOrderChange`, `pedidoNotificavel`, `agruparPorPedido`, `montarPayloadVenda`, `montarPayloadAgrupado`, `LIMITE_AGRUPAMENTO`, `VendaCriadaNoSync`
  - Task 13: `enviarPush`, `reservarEnvio`, `entregar`, `concluirEnvio`, `TipoPushEnvio`
  - Task 14: `nomeDaLoja`
- Produces:
  - `estimarValorItens(itens, agora?): Promise<number | null>`
  - `notificarVendaDeOrderChange(payload: Record<string, unknown> | null | undefined, agora?: Date): Promise<void>` (nunca lança)
  - `notificarVendasCriadasNoSync(vendas: readonly VendaCriadaNoSync[], agora?: Date): Promise<void>` (nunca lança)

- [ ] **Step 1: Teste que falha**

`src/modules/push/vendas.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, envioMock } = vi.hoisted(() => ({
  dbMock: {
    vendaAmazon: { findMany: vi.fn() },
    produto: { findMany: vi.fn() },
  },
  envioMock: {
    enviarPush: vi.fn(),
    reservarEnvio: vi.fn(),
    entregar: vi.fn(),
    concluirEnvio: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("./envio", () => ({ ...envioMock, TipoPushEnvio: { VENDA_NOVA: "VENDA_NOVA", VENDAS_AGRUPADAS: "VENDAS_AGRUPADAS", TESTE: "TESTE" } }));
vi.mock("./loja", () => ({ nomeDaLoja: vi.fn(async () => "MundoFS") }));
vi.mock("@/lib/tenant-context", () => ({
  getEmpresaId: () => "mundofs",
  currentEmpresaIdOrDefault: () => "mundofs",
}));

import { notificarVendaDeOrderChange, notificarVendasCriadasNoSync } from "./vendas";

const AGORA = new Date("2026-10-06T22:35:00Z");
const RECENTE = new Date("2026-10-06T22:33:10Z");

function orderChange(status: string, data: string, itens = [{ SellerSKU: "MFS-0036", Quantity: 1 }]) {
  return {
    OrderChangeNotification: {
      AmazonOrderId: "702-4417820-3391045",
      Summary: { OrderStatus: status, PurchaseDate: data, OrderItems: itens },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.vendaAmazon.findMany.mockResolvedValue([]);
  dbMock.produto.findMany.mockResolvedValue([{ sku: "MFS-0036", amazonPrecoListagemCentavos: 7700 }]);
  envioMock.enviarPush.mockResolvedValue({ destinos: 1, ok: 1, falhas: 0, duplicado: false });
  envioMock.entregar.mockResolvedValue({ destinos: 1, ok: 1, falhas: 0 });
  envioMock.concluirEnvio.mockResolvedValue(undefined);
});

describe("gatilho SQS (ORDER_CHANGE)", () => {
  it("pedido novo avisa na hora, com loja e valor estimado, dedupe por pedido", async () => {
    await notificarVendaDeOrderChange(orderChange("Pending", "2026-10-06T22:33:10Z"), AGORA);
    expect(envioMock.enviarPush).toHaveBeenCalledTimes(1);
    const arg = envioMock.enviarPush.mock.calls[0][0];
    expect(arg.dedupeKey).toBe("venda:702-4417820-3391045");
    expect(arg.empresaId).toBe("mundofs");
    expect(arg.payload.title).toBe("Nova venda na MundoFS");
    expect(arg.payload.body).toContain("~R$");
    expect(JSON.stringify(arg.payload)).not.toContain("MFS-0036");
  });

  it("preço real recente do SKU tem prioridade sobre o listing", async () => {
    dbMock.vendaAmazon.findMany.mockResolvedValue([{ sku: "MFS-0036", precoUnitarioCentavos: 6990 }]);
    await notificarVendaDeOrderChange(orderChange("Pending", "2026-10-06T22:33:10Z", [{ SellerSKU: "MFS-0036", Quantity: 2 }]), AGORA);
    expect(envioMock.enviarPush.mock.calls[0][0].payload.body).toMatch(/139,80/);
  });

  it("pedido antigo ou cancelado não avisa", async () => {
    await notificarVendaDeOrderChange(orderChange("Pending", "2026-10-06T18:00:00Z"), AGORA);
    await notificarVendaDeOrderChange(orderChange("Canceled", "2026-10-06T22:33:10Z"), AGORA);
    expect(envioMock.enviarPush).not.toHaveBeenCalled();
  });

  it("erro no envio nunca derruba o processamento da mensagem", async () => {
    envioMock.enviarPush.mockRejectedValue(new Error("rede caiu"));
    await expect(notificarVendaDeOrderChange(orderChange("Pending", "2026-10-06T22:33:10Z"), AGORA)).resolves.toBeUndefined();
  });
});

describe("gatilho de reserva (ORDERS_SYNC)", () => {
  const venda = (id: string, valor = 7700) => ({
    amazonOrderId: id,
    purchaseDate: RECENTE,
    status: "Pending",
    valorBrutoCentavos: valor,
    estimado: true,
  });

  it("pedido que o SQS já avisou é ignorado (reserva devolve null)", async () => {
    envioMock.reservarEnvio.mockResolvedValueOnce(null).mockResolvedValueOnce("env2");
    await notificarVendasCriadasNoSync([venda("A"), venda("B")], AGORA);
    expect(envioMock.entregar).toHaveBeenCalledTimes(1);
    expect(envioMock.concluirEnvio).toHaveBeenCalledWith("env2", expect.anything());
  });

  it("mais de 3 pedidos novos de uma vez viram 1 aviso agrupado", async () => {
    envioMock.reservarEnvio.mockImplementation(async ({ dedupeKey }: { dedupeKey: string }) => `env-${dedupeKey}`);
    await notificarVendasCriadasNoSync(["A", "B", "C", "D", "E"].map((id) => venda(id)), AGORA);
    expect(envioMock.entregar).toHaveBeenCalledTimes(1);
    expect(envioMock.entregar.mock.calls[0][0].payload.title).toBe("5 novas vendas na MundoFS");
    expect(envioMock.concluirEnvio).toHaveBeenCalledTimes(5);
  });

  it("vendas antigas do backfill/primeira conexão não avisam", async () => {
    await notificarVendasCriadasNoSync([{ ...venda("A"), purchaseDate: new Date("2026-10-03T10:00:00Z") }], AGORA);
    expect(envioMock.reservarEnvio).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run src/modules/push/vendas.test.ts` → Expected: FAIL.

- [ ] **Step 2: Implementar**

`src/modules/push/vendas.ts`:
```ts
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { currentEmpresaIdOrDefault, getEmpresaId } from "@/lib/tenant-context";
import { PRECO_ORIGEM_SPAPI } from "@/modules/vendas/filtros";
import { concluirEnvio, entregar, enviarPush, reservarEnvio, TipoPushEnvio } from "./envio";
import { nomeDaLoja } from "./loja";
import {
  agruparPorPedido,
  extrairResumoOrderChange,
  LIMITE_AGRUPAMENTO,
  montarPayloadAgrupado,
  montarPayloadVenda,
  pedidoNotificavel,
  type VendaCriadaNoSync,
} from "./regras";

const JANELA_PRECO_REAL_DIAS = 7;

function erroComoTexto(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Valor do pedido para o aviso, antes do ItemPrice chegar: preço real recente
 * do SKU (≤ 7 dias, acompanha ofertas) → cache do listing. SÓ EXIBIÇÃO: nada
 * é gravado em VendaAmazon.
 */
export async function estimarValorItens(
  itens: ReadonlyArray<{ sku: string; quantidade: number }>,
  agora = new Date(),
): Promise<number | null> {
  const skus = [...new Set(itens.map((i) => i.sku).filter(Boolean))];
  if (skus.length === 0) return null;
  const [vendas, produtos] = await Promise.all([
    db.vendaAmazon.findMany({
      where: {
        sku: { in: skus },
        precoOrigem: PRECO_ORIGEM_SPAPI,
        precoUnitarioCentavos: { gt: 0 },
        dataVenda: { gte: new Date(agora.getTime() - JANELA_PRECO_REAL_DIAS * 86_400_000) },
      },
      orderBy: { dataVenda: "desc" },
      select: { sku: true, precoUnitarioCentavos: true },
    }),
    db.produto.findMany({
      where: { sku: { in: skus } },
      select: { sku: true, amazonPrecoListagemCentavos: true },
    }),
  ]);
  const real = new Map<string, number>();
  for (const v of vendas) {
    if (!real.has(v.sku) && v.precoUnitarioCentavos) real.set(v.sku, v.precoUnitarioCentavos);
  }
  const listing = new Map(produtos.map((p) => [p.sku, p.amazonPrecoListagemCentavos ?? 0]));
  let total = 0;
  for (const item of itens) {
    const preco = real.get(item.sku) ?? listing.get(item.sku) ?? 0;
    if (preco > 0) total += preco * Math.max(1, item.quantidade);
  }
  return total > 0 ? total : null;
}

/** Gatilho primário: consumidor SQS, assim que o ORDER_CHANGE chega (~13 s após a compra). */
export async function notificarVendaDeOrderChange(
  payload: Record<string, unknown> | null | undefined,
  agora = new Date(),
): Promise<void> {
  try {
    const resumo = extrairResumoOrderChange(payload ?? null);
    if (!resumo || !pedidoNotificavel(resumo, agora)) return;
    const empresaId = getEmpresaId() ?? currentEmpresaIdOrDefault();
    const [valorCentavos, loja] = await Promise.all([
      estimarValorItens(resumo.itens, agora),
      nomeDaLoja(empresaId),
    ]);
    await enviarPush({
      empresaId,
      tipo: TipoPushEnvio.VENDA_NOVA,
      dedupeKey: `venda:${resumo.amazonOrderId}`,
      payload: montarPayloadVenda({
        loja,
        valorCentavos,
        estimado: true,
        amazonOrderId: resumo.amazonOrderId,
        empresaId,
      }),
    });
  } catch (err) {
    logger.warn({ err: erroComoTexto(err) }, "push: falha ao avisar venda (SQS)");
  }
}

/** Gatilho de reserva: vendas CRIADAS pelo ORDERS_SYNC (empresas sem SQS, mensagem perdida). */
export async function notificarVendasCriadasNoSync(
  vendas: readonly VendaCriadaNoSync[],
  agora = new Date(),
): Promise<void> {
  try {
    if (vendas.length === 0) return;
    const pedidos = agruparPorPedido(vendas).filter((p) => pedidoNotificavel(p, agora));
    if (pedidos.length === 0) return;
    const empresaId = getEmpresaId() ?? currentEmpresaIdOrDefault();
    const loja = await nomeDaLoja(empresaId);

    const reservados: Array<{ envioId: string; payload: ReturnType<typeof montarPayloadVenda>; valor: number | null; estimado: boolean }> = [];
    for (const p of pedidos) {
      const payload = montarPayloadVenda({
        loja,
        valorCentavos: p.valorCentavos,
        estimado: p.estimado,
        amazonOrderId: p.amazonOrderId,
        empresaId,
      });
      const envioId = await reservarEnvio({
        empresaId,
        tipo: TipoPushEnvio.VENDA_NOVA,
        dedupeKey: `venda:${p.amazonOrderId}`,
        payload,
      });
      if (envioId) reservados.push({ envioId, payload, valor: p.valorCentavos, estimado: p.estimado });
    }
    if (reservados.length === 0) return;

    if (reservados.length > LIMITE_AGRUPAMENTO) {
      const total = reservados.reduce((s, r) => s + (r.valor ?? 0), 0);
      const r = await entregar({
        empresaId,
        payload: montarPayloadAgrupado({
          loja,
          quantidade: reservados.length,
          totalCentavos: total > 0 ? total : null,
          estimado: reservados.some((x) => x.estimado),
          empresaId,
        }),
      });
      for (const x of reservados) await concluirEnvio(x.envioId, r);
      return;
    }

    for (const x of reservados) {
      const r = await entregar({ empresaId, payload: x.payload });
      await concluirEnvio(x.envioId, r);
    }
  } catch (err) {
    logger.warn({ err: erroComoTexto(err) }, "push: falha ao avisar vendas (ORDERS_SYNC)");
  }
}
```

Run: `npx vitest run src/modules/push/vendas.test.ts` → Expected: PASS (7 testes). O teste "139,80" usa 6990 × 2 = 13980.

- [ ] **Step 3: Ligar no consumidor SQS (mudança mínima)**

Em `src/lib/amazon-sqs.ts`:
1. Junto dos imports do topo: `import { notificarVendaDeOrderChange } from "@/modules/push/vendas";`
2. Em `dispatchNotification`, no `case "ORDER_CHANGE": {`, como PRIMEIRA linha do bloco:
```ts
      // Aviso de venda no celular sai daqui, antes da fila do worker
      // (compra → esta mensagem: ~13 s; fila do worker: até ~3 min no p90).
      await notificarVendaDeOrderChange(basePayload.payload);
```

- [ ] **Step 4: Ligar no ORDERS_SYNC (reserva)**

Em `src/modules/amazon/service.ts`:
1. No import de `@/modules/vendas/filtros` (~L71), acrescentar `PRECO_ORIGEM_LISTING,`.
2. Acrescentar o import: `import { notificarVendasCriadasNoSync } from "@/modules/push/vendas";` e `import type { VendaCriadaNoSync } from "@/modules/push/regras";`.
3. Em `syncOrdersInternal`, junto de `let criadas = 0;`, acrescentar `const vendasCriadas: VendaCriadaNoSync[] = [];`.
4. Trocar:
```ts
        if (existente) atualizadas++;
        else criadas++;
```
por:
```ts
        if (existente) atualizadas++;
        else {
          criadas++;
          vendasCriadas.push({
            amazonOrderId,
            purchaseDate: createdAt,
            status: statusPedido,
            valorBrutoCentavos: valorBrutoFinal,
            estimado: precoOrigemFinal === PRECO_ORIGEM_LISTING,
          });
        }
```
5. No caminho de sucesso, imediatamente antes de `return {` com `lidas: pedidos.length,`, acrescentar:
```ts
    // Reserva do aviso de venda: o SQS normalmente já avisou (dedupe por pedido).
    await notificarVendasCriadasNoSync(vendasCriadas);
```

`notificarVendasCriadasNoSync` nunca lança, então o sync não é afetado por falha de push. `upsertOrdersHistoryRows` (REPORTS_BACKFILL) e a importação CSV **não** chamam o push.

- [ ] **Step 5: Verificar**

Run: `npx eslint src/modules/push src/lib/amazon-sqs.ts src/modules/amazon/service.ts && npx tsc --noEmit && npx vitest run src/modules/push`
Expected: sem erros; PASS. Rodar também os testes existentes de SQS/orders, se houver: `npx vitest run src/lib/amazon-sqs src/modules/amazon/service` (os padrões que existirem). Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/push/vendas.ts src/modules/push/vendas.test.ts src/lib/amazon-sqs.ts src/modules/amazon/service.ts
git commit -m "feat(push): aviso de venda direto do SQS (segundos) com ORDERS_SYNC de reserva

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 16: Celular — ativar avisos, "Neste celular" e pergunta ao sair

**Files:**
- Create: `src/lib/push/cliente.ts`, `src/lib/push/cliente.test.ts`
- Create: `src/components/push/use-push.ts`
- Create: `src/components/configuracoes/neste-celular-section.tsx`
- Modify: `src/app/configuracoes/page.tsx` (aba notificações)
- Modify: `src/components/auth/use-logout.tsx` (pergunta + `DialogAvisosAoSair`)
- Modify: `src/components/topbar.tsx`, `src/components/mobile/mais-sheet.tsx` (renderizar o diálogo)

**Interfaces:**
- Consumes: Task 6 (`usePwa`, `precisaInstalarParaPush`), Task 7 (`InstalarSheet`, `useLogout`), Task 14 (API).
- Produces:
  - `urlBase64ParaUint8Array(base64: string): Uint8Array`
  - `type EstadoPush = "nao-suportado" | "instalar-primeiro" | "negado" | "desligado" | "ativo"`
  - `calcularEstadoPush(...)`
  - `ehAppInstalado(): boolean`
  - `obterInscricaoAtual(): Promise<PushSubscription | null>`
  - `inscricaoDestaLojaNesteAparelho(): Promise<{ endpoint: string; loja: string } | null>`
  - `usePush()`
  - `<NesteCelularSection />`
  - `ControleLogout` ganha `pergunta` e `responder`, mais `<DialogAvisosAoSair controle />`

- [ ] **Step 1: Teste que falha**

`src/lib/push/cliente.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { calcularEstadoPush, urlBase64ParaUint8Array } from "./cliente";

describe("urlBase64ParaUint8Array", () => {
  it("decodifica base64url sem padding (formato da chave VAPID)", () => {
    expect(Array.from(urlBase64ParaUint8Array("AQID_-8"))).toEqual([1, 2, 3, 255, 239]);
  });
});

describe("calcularEstadoPush", () => {
  const base = { suportado: true, precisaInstalar: false, permissao: "default" as const, inscritoNestaLoja: false };

  it("iPhone fora do app: instalar primeiro (mesmo sem PushManager)", () => {
    expect(calcularEstadoPush({ ...base, suportado: false, precisaInstalar: true })).toBe("instalar-primeiro");
  });
  it("navegador sem push", () => {
    expect(calcularEstadoPush({ ...base, suportado: false })).toBe("nao-suportado");
  });
  it("permissão negada", () => {
    expect(calcularEstadoPush({ ...base, permissao: "denied" })).toBe("negado");
  });
  it("permitido e inscrito nesta loja = ativo", () => {
    expect(calcularEstadoPush({ ...base, permissao: "granted", inscritoNestaLoja: true })).toBe("ativo");
  });
  it("permitido mas inscrito só na outra loja = desligado (pode ativar aqui)", () => {
    expect(calcularEstadoPush({ ...base, permissao: "granted", inscritoNestaLoja: false })).toBe("desligado");
  });
});
```

Run: `npx vitest run src/lib/push/cliente.test.ts` → Expected: FAIL.

- [ ] **Step 2: Helpers de cliente**

`src/lib/push/cliente.ts`:
```ts
// Helpers de navegador para o aviso de venda (rodam só no cliente).

export type EstadoPush = "nao-suportado" | "instalar-primeiro" | "negado" | "desligado" | "ativo";

export function urlBase64ParaUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bruto = atob(b64);
  return Uint8Array.from(bruto, (c) => c.charCodeAt(0));
}

export function calcularEstadoPush(input: {
  suportado: boolean;
  precisaInstalar: boolean;
  permissao: NotificationPermission | "indisponivel";
  inscritoNestaLoja: boolean;
}): EstadoPush {
  if (input.precisaInstalar) return "instalar-primeiro";
  if (!input.suportado) return "nao-suportado";
  if (input.permissao === "denied") return "negado";
  if (input.permissao === "granted" && input.inscritoNestaLoja) return "ativo";
  return "desligado";
}

export function ehAppInstalado(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

/** Inscrição do navegador, sem travar quando não há service worker. */
export async function obterInscricaoAtual(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Este aparelho recebe avisos da loja da sessão? (usado ao sair) */
export async function inscricaoDestaLojaNesteAparelho(): Promise<{ endpoint: string; loja: string } | null> {
  try {
    const sub = await obterInscricaoAtual();
    if (!sub) return null;
    const [lista, config] = await Promise.all([
      fetch("/api/push/dispositivos").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/push/config").then((r) => (r.ok ? r.json() : null)),
    ]);
    const inscrito = (lista?.dispositivos ?? []).some(
      (d: { endpoint: string }) => d.endpoint === sub.endpoint,
    );
    return inscrito ? { endpoint: sub.endpoint, loja: config?.loja ?? "sua loja" } : null;
  } catch {
    return null;
  }
}
```

Run: `npx vitest run src/lib/push/cliente.test.ts` → Expected: PASS (6 testes).

- [ ] **Step 3: Hook do celular**

`src/components/push/use-push.ts`:
```ts
"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJSON } from "@/lib/fetcher";
import { precisaInstalarParaPush } from "@/lib/pwa/plataforma";
import {
  calcularEstadoPush,
  obterInscricaoAtual,
  urlBase64ParaUint8Array,
  type EstadoPush,
} from "@/lib/push/cliente";
import { usePwa } from "@/components/pwa/pwa-provider";

export type DispositivoPushCliente = {
  id: string;
  apelido: string | null;
  endpoint: string;
  receberVendas: boolean;
  ativo: boolean;
  criadoEm: string;
  ultimoEnvioEm: string | null;
};

type ConfigPush = { enabled: boolean; publicKey: string | null; loja: string };

export function usePush() {
  const qc = useQueryClient();
  const { plataforma } = usePwa();
  const config = useQuery<ConfigPush>({
    queryKey: ["push-config"],
    queryFn: () => fetchJSON<ConfigPush>("/api/push/config"),
    staleTime: Infinity,
  });
  const lista = useQuery<{ dispositivos: DispositivoPushCliente[] }>({
    queryKey: ["push-dispositivos"],
    queryFn: () => fetchJSON("/api/push/dispositivos"),
  });

  const [endpointAtual, setEndpointAtual] = React.useState<string | null>(null);
  const [permissao, setPermissao] = React.useState<NotificationPermission | "indisponivel">(
    "indisponivel",
  );

  React.useEffect(() => {
    if (typeof Notification !== "undefined") setPermissao(Notification.permission);
    obterInscricaoAtual()
      .then((s) => setEndpointAtual(s?.endpoint ?? null))
      .catch(() => setEndpointAtual(null));
  }, []);

  const suportado =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined" &&
    !!config.data?.enabled;
  const dispositivos = lista.data?.dispositivos ?? [];
  const desteAparelho = dispositivos.find((d) => d.endpoint === endpointAtual) ?? null;
  const carregando = config.isLoading || lista.isLoading || !plataforma;
  const estado: EstadoPush | "carregando" = carregando
    ? "carregando"
    : calcularEstadoPush({
        suportado,
        precisaInstalar: precisaInstalarParaPush(plataforma),
        permissao,
        inscritoNestaLoja: !!desteAparelho,
      });

  const invalidar = () => qc.invalidateQueries({ queryKey: ["push-dispositivos"] });

  const ativar = useMutation({
    mutationFn: async () => {
      // iOS exige que o pedido de permissão saia direto de um toque.
      const perm = await Notification.requestPermission();
      setPermissao(perm);
      if (perm !== "granted") throw new Error("Permissão de notificação não concedida.");
      if (!config.data?.publicKey) throw new Error("Avisos ainda não configurados no servidor.");
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ParaUint8Array(config.data.publicKey) as BufferSource,
        }));
      const json = sub.toJSON();
      await fetchJSON("/api/push/dispositivos", {
        method: "POST",
        body: JSON.stringify({ endpoint: sub.endpoint, keys: json.keys }),
      });
      setEndpointAtual(sub.endpoint);
    },
    onSuccess: invalidar,
  });

  const remover = useMutation({
    mutationFn: (alvo: { id?: string; endpoint?: string }) =>
      fetchJSON("/api/push/dispositivos", { method: "DELETE", body: JSON.stringify(alvo) }),
    onSuccess: invalidar,
  });

  const alternarVendas = useMutation({
    mutationFn: (receberVendas: boolean) =>
      fetchJSON("/api/push/dispositivos", {
        method: "PATCH",
        body: JSON.stringify({ endpoint: endpointAtual, receberVendas }),
      }),
    onSuccess: invalidar,
  });

  const teste = useMutation({
    mutationFn: () => fetchJSON<{ enviados: number; destinos: number }>("/api/push/teste", { method: "POST" }),
  });

  return {
    estado,
    loja: config.data?.loja ?? "sua loja",
    plataforma,
    endpointAtual,
    desteAparelho,
    dispositivos,
    ativar,
    remover,
    alternarVendas,
    teste,
  };
}
```

- [ ] **Step 4: Card "Neste celular"**

`src/components/configuracoes/neste-celular-section.tsx`:
```tsx
"use client";

import * as React from "react";
import { Bell, CheckCircle2, Info, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { InstalarSheet } from "@/components/pwa/instalar-sheet";
import { usePush } from "@/components/push/use-push";

function dataCurta(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function NesteCelularSection() {
  const push = usePush();
  const [instalarAberto, setInstalarAberto] = React.useState(false);
  const nomeAparelho = push.plataforma?.ios ? "iPhone" : push.plataforma?.android ? "Android" : "aparelho";

  function ativar() {
    push.ativar.mutate(undefined, {
      onSuccess: () => toast.success(`Avisos da ${push.loja} ativados neste ${nomeAparelho}.`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível ativar."),
    });
  }

  function testar() {
    push.teste.mutate(undefined, {
      onSuccess: (r) =>
        r.destinos > 0
          ? toast.success("Teste enviado. Chega em instantes.")
          : toast.info("Nenhum aparelho seu está recebendo avisos ainda."),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao enviar o teste."),
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Smartphone className="h-5 w-5" aria-hidden />
        </span>
        <div className="space-y-1">
          <CardTitle className="text-base">Aviso de venda neste celular</CardTitle>
          <CardDescription>
            Segundos depois de cada venda, mesmo com o celular bloqueado. Mostra a
            loja e o valor, sem o nome do produto.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {push.estado === "carregando" && <Skeleton className="h-12 w-full" />}

        {push.estado === "instalar-primeiro" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No iPhone, os avisos funcionam com o Atlas instalado na Tela de Início
              (iOS 16.4 ou mais novo).
            </p>
            <Button className="h-12 w-full" onClick={() => setInstalarAberto(true)}>
              Como instalar
            </Button>
          </div>
        )}

        {push.estado === "nao-suportado" && (
          <p className="text-sm text-muted-foreground">
            Este navegador não recebe notificações. No celular, use o Chrome
            (Android) ou o app instalado (iPhone).
          </p>
        )}

        {push.estado === "negado" && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            As notificações estão bloqueadas para o Atlas. Libere em Ajustes →
            Notificações → Atlas (iPhone) ou nas permissões do site (Android) e
            volte aqui.
          </p>
        )}

        {push.estado === "desligado" && (
          <div className="space-y-2">
            <Button className="h-12 w-full text-base" onClick={ativar} disabled={push.ativar.isPending}>
              <Bell className="mr-2 h-5 w-5" aria-hidden />
              {push.ativar.isPending ? "Ativando…" : "Ativar notificações"}
            </Button>
            <p className="text-xs text-muted-foreground">
              No iPhone, funciona com o Atlas instalado na Tela de Início. No
              Android, direto pelo Chrome.
            </p>
          </div>
        )}

        {push.estado === "ativo" && push.desteAparelho && (
          <div className="space-y-1">
            <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              Ativo neste {nomeAparelho} para a {push.loja}
            </p>
            <label className="flex min-h-[56px] cursor-pointer items-center gap-3" htmlFor="push-vendas">
              <span className="flex-1">
                <span className="block text-[15px] font-medium">Vendas novas</span>
                <span className="block text-xs text-muted-foreground">
                  “Nova venda na {push.loja}” e o valor do pedido
                </span>
              </span>
              <Switch
                id="push-vendas"
                checked={push.desteAparelho.receberVendas}
                disabled={push.alternarVendas.isPending}
                onCheckedChange={(v) => push.alternarVendas.mutate(v)}
              />
            </label>
            <Button variant="outline" className="h-11 w-full" onClick={testar} disabled={push.teste.isPending}>
              Enviar teste
            </Button>
          </div>
        )}

        {(push.estado === "ativo" || push.estado === "desligado") && (
          <p className="flex gap-2 rounded-lg bg-primary/5 p-3 text-xs leading-relaxed text-primary">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Tem outra loja? Entre na conta dela neste celular e ative aqui também.
            Cada aviso mostra o nome da loja.
          </p>
        )}

        <div className="overflow-hidden rounded-lg border">
          <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Seus aparelhos
          </p>
          {push.dispositivos.length === 0 ? (
            <p className="border-t px-4 py-3 text-sm text-muted-foreground">
              Nenhum aparelho seu recebe avisos da {push.loja} ainda.
            </p>
          ) : (
            push.dispositivos.map((d) => (
              <div key={d.id} className="flex min-h-[56px] items-center gap-3 border-t pl-4 pr-1">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium">
                    {d.apelido ?? "Aparelho"}
                    {d.endpoint === push.endpointAtual && (
                      <span className="ml-1 text-xs font-semibold text-primary">· este aparelho</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {d.ativo ? `Avisos desde ${dataCurta(d.criadoEm)}` : "Pausado após falhas de entrega"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  className="h-11 text-red-700 dark:text-red-400"
                  disabled={push.remover.isPending}
                  onClick={() =>
                    push.remover.mutate(
                      { id: d.id },
                      { onSuccess: () => toast.success("Aparelho removido. Ele não recebe mais avisos.") },
                    )
                  }
                >
                  Remover
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
      <InstalarSheet aberto={instalarAberto} onAbertoChange={setInstalarAberto} />
    </Card>
  );
}
```

Em `src/app/configuracoes/page.tsx`: import `import { NesteCelularSection } from "@/components/configuracoes/neste-celular-section";` e, no `TabsContent value="notificacoes"`, colocar `<NesteCelularSection />` ANTES de `<NotificacoesSection />`.

- [ ] **Step 5: Pergunta ao sair**

Substituir `src/components/auth/use-logout.tsx` inteiro por:
```tsx
"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchJSON } from "@/lib/fetcher";
import { ehAppInstalado, inscricaoDestaLojaNesteAparelho } from "@/lib/push/cliente";

type Pergunta = { endpoint: string; loja: string; padraoContinuar: boolean };

export type ControleLogout = {
  sair: () => Promise<void>;
  saindo: boolean;
  pergunta: Pergunta | null;
  responder: (continuar: boolean) => Promise<void>;
};

export function useLogout(): ControleLogout {
  const qc = useQueryClient();
  const [saindo, setSaindo] = React.useState(false);
  const [pergunta, setPergunta] = React.useState<Pergunta | null>(null);

  const encerrar = React.useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Mesmo com erro, seguimos: o cookie é revalidado no próximo load.
    }
    qc.clear();
    toast.success("Sessão encerrada.");
    window.location.href = "/login";
  }, [qc]);

  const sair = React.useCallback(async () => {
    if (saindo) return;
    setSaindo(true);
    // Quem troca entre MundoFS e UDN no mesmo celular quer continuar recebendo
    // as duas; computador compartilhado, não. Por isso perguntamos.
    const inscricao = await inscricaoDestaLojaNesteAparelho();
    if (inscricao) {
      setPergunta({ ...inscricao, padraoContinuar: ehAppInstalado() });
      return;
    }
    await encerrar();
  }, [saindo, encerrar]);

  const responder = React.useCallback(
    async (continuar: boolean) => {
      const atual = pergunta;
      setPergunta(null);
      if (atual && !continuar) {
        try {
          await fetchJSON("/api/push/dispositivos", {
            method: "DELETE",
            body: JSON.stringify({ endpoint: atual.endpoint }),
          });
        } catch {
          // Sem rede: dá para remover depois em "Seus aparelhos".
        }
      }
      await encerrar();
    },
    [pergunta, encerrar],
  );

  return { sair, saindo, pergunta, responder };
}

export function DialogAvisosAoSair({ controle }: { controle: ControleLogout }) {
  const p = controle.pergunta;
  return (
    <Dialog
      open={!!p}
      onOpenChange={(aberto) => {
        if (!aberto && p) void controle.responder(p.padraoContinuar);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Continuar recebendo avisos?</DialogTitle>
          <DialogDescription>
            Este aparelho recebe os avisos de venda da {p?.loja}. Quer continuar
            recebendo depois de sair?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="grid grid-cols-2 gap-2 sm:space-x-0">
          <Button
            variant="outline"
            className="h-11"
            autoFocus={!p?.padraoContinuar}
            onClick={() => void controle.responder(false)}
          >
            Parar avisos
          </Button>
          <Button
            className="h-11"
            autoFocus={!!p?.padraoContinuar}
            onClick={() => void controle.responder(true)}
          >
            Continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Renderizar o diálogo nos dois lugares que chamam `useLogout`:
- `src/components/topbar.tsx` (`ProfileMenu`): trocar o retorno `return ( <DropdownMenu>…</DropdownMenu> );` por `return ( <> <DropdownMenu>…</DropdownMenu> <DialogAvisosAoSair controle={logout} /> </> );` e importar `DialogAvisosAoSair` de `@/components/auth/use-logout`.
- `src/components/mobile/mais-sheet.tsx`: acrescentar `<DialogAvisosAoSair controle={logout} />` ao lado de `<InstalarSheet …/>` (fora do `<Sheet>`) e importar.

- [ ] **Step 6: Verificar**

Run: `npx eslint src/lib/push src/components/push src/components/configuracoes/neste-celular-section.tsx src/app/configuracoes/page.tsx src/components/auth src/components/topbar.tsx src/components/mobile && npx tsc --noEmit && npx vitest run src/lib/push`
Expected: sem erros; PASS. Se `as BufferSource` gerar erro de tipo (TS < 5.7), remover o cast.

- [ ] **Step 7: Commit**

```bash
git add src/lib/push src/components/push src/components/configuracoes/neste-celular-section.tsx src/app/configuracoes/page.tsx src/components/auth/use-logout.tsx src/components/topbar.tsx src/components/mobile/mais-sheet.tsx
git commit -m "feat(push): ativar avisos no celular, lista de aparelhos e pergunta ao sair

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 17: UDN mais rápida — polling de 2 min sem SQS e assinatura ORDER_CHANGE por empresa

**Files:**
- Create: `src/modules/amazon/sqs-cobertura.ts`, `src/modules/amazon/sqs-cobertura.test.ts`
- Modify: `src/modules/amazon/jobs.ts` (tipo do `SCHEDULES` ~L140-151; 2 entradas ORDERS_SYNC ~L152-172; `agendarRecorrentesDaEmpresa` ~L679-725)
- Modify: `scripts/setup-sqs-subscriptions.ts`

**Interfaces:**
- Produces:
  - `empresaRecebeOrderChange(empresaId: string, agora: Date): Promise<boolean>`
  - `intervaloEfetivo(schedule: { intervalMs: number; intervalMsSemSqs?: number }, semSqs: boolean): number`
  - `__limparCacheSqsCobertura(): void` (só para teste)
  - flag de script `--empresa=<id>`

- [ ] **Step 1: Teste que falha**

`src/modules/amazon/sqs-cobertura.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: { amazonNotification: { findFirst: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import { __limparCacheSqsCobertura, empresaRecebeOrderChange, intervaloEfetivo } from "./sqs-cobertura";

const AGORA = new Date("2026-10-06T22:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  __limparCacheSqsCobertura();
});

describe("empresaRecebeOrderChange", () => {
  it("ORDER_CHANGE nas últimas 24 h = recebe SQS", async () => {
    dbMock.amazonNotification.findFirst.mockResolvedValue({ id: "n1" });
    expect(await empresaRecebeOrderChange("mundofs", AGORA)).toBe(true);
    expect(dbMock.amazonNotification.findFirst).toHaveBeenCalledWith({
      where: {
        empresaId: "mundofs",
        notificationType: "ORDER_CHANGE",
        criadoEm: { gte: new Date("2026-10-05T22:00:00Z") },
      },
      select: { id: true },
    });
  });

  it("sem notificação = não recebe, e o resultado fica em cache", async () => {
    dbMock.amazonNotification.findFirst.mockResolvedValue(null);
    expect(await empresaRecebeOrderChange("udncd", AGORA)).toBe(false);
    expect(await empresaRecebeOrderChange("udncd", AGORA)).toBe(false);
    expect(dbMock.amazonNotification.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe("intervaloEfetivo", () => {
  it("empresa sem SQS usa o intervalo curto", () => {
    expect(intervaloEfetivo({ intervalMs: 900_000, intervalMsSemSqs: 120_000 }, true)).toBe(120_000);
    expect(intervaloEfetivo({ intervalMs: 900_000, intervalMsSemSqs: 120_000 }, false)).toBe(900_000);
    expect(intervaloEfetivo({ intervalMs: 600_000 }, true)).toBe(600_000);
  });
});
```

Run: `npx vitest run src/modules/amazon/sqs-cobertura.test.ts` → Expected: FAIL.

- [ ] **Step 2: Implementar**

`src/modules/amazon/sqs-cobertura.ts`:
```ts
import { db } from "@/lib/db";

// SQS_PRIMARY é global: com ele, o ORDERS_SYNC cai para 15 min em TODAS as
// empresas — inclusive as que não têm assinatura ORDER_CHANGE (caso UDN, ~12
// min até ver a venda). Empresa sem ORDER_CHANGE recente volta ao polling curto.

const JANELA_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { valor: boolean; expira: number }>();

export async function empresaRecebeOrderChange(empresaId: string, agora: Date): Promise<boolean> {
  const emCache = cache.get(empresaId);
  if (emCache && emCache.expira > agora.getTime()) return emCache.valor;
  const ultima = await db.amazonNotification.findFirst({
    where: {
      empresaId,
      notificationType: "ORDER_CHANGE",
      criadoEm: { gte: new Date(agora.getTime() - JANELA_MS) },
    },
    select: { id: true },
  });
  const valor = !!ultima;
  cache.set(empresaId, { valor, expira: agora.getTime() + CACHE_TTL_MS });
  return valor;
}

export function intervaloEfetivo(
  schedule: { intervalMs: number; intervalMsSemSqs?: number },
  semSqs: boolean,
): number {
  return semSqs && schedule.intervalMsSemSqs ? schedule.intervalMsSemSqs : schedule.intervalMs;
}

export function __limparCacheSqsCobertura(): void {
  cache.clear();
}
```

Run: `npx vitest run src/modules/amazon/sqs-cobertura.test.ts` → Expected: PASS (3 testes).

- [ ] **Step 3: Agendador usa o intervalo por empresa**

Em `src/modules/amazon/jobs.ts`:
1. Import: `import { empresaRecebeOrderChange, intervaloEfetivo } from "@/modules/amazon/sqs-cobertura";`
2. No tipo do array `SCHEDULES` (onde está `intervalMs: number;` e `dedupeKeyOverride?: (now: Date) => string;`):
   - acrescentar `intervalMsSemSqs?: number;`
   - trocar a assinatura por `dedupeKeyOverride?: (now: Date, intervalMs: number) => string;`
3. Na 1ª entrada `TipoAmazonSyncJob.ORDERS_SYNC` (payload `dateFilter: "created"`): acrescentar `intervalMsSemSqs: 2 * 60_000,` logo depois de `intervalMs`.
4. Na 2ª entrada ORDERS_SYNC (`dateFilter: "lastUpdated"`):
   - acrescentar `intervalMsSemSqs: 5 * 60_000,`;
   - trocar o `dedupeKeyOverride` por:
```ts
    dedupeKeyOverride: (now, intervalMs) =>
      `${TipoAmazonSyncJob.ORDERS_SYNC}:lastUpdated:${Math.floor(now.getTime() / intervalMs)}`,
```
5. Em `agendarRecorrentesDaEmpresa`, logo depois do `const reviewAutomacaoAtiva = …;`:
```ts
  // Empresa sem ORDER_CHANGE recente não pode esperar o polling de 15 min.
  const semSqs =
    SQS_PRIMARY && !(await empresaRecebeOrderChange(empresaId, now).catch(() => false));
```
6. No loop, trocar:
```ts
    const dedupeBase = schedule.dedupeKeyOverride
      ? schedule.dedupeKeyOverride(now)
      : `${schedule.tipo}:${Math.floor(now.getTime() / schedule.intervalMs)}`;
```
por:
```ts
    const intervalMs = intervaloEfetivo(schedule, semSqs);
    const dedupeBase = schedule.dedupeKeyOverride
      ? schedule.dedupeKeyOverride(now, intervalMs)
      : `${schedule.tipo}:${Math.floor(now.getTime() / intervalMs)}`;
```
Os demais `dedupeKeyOverride` (com 1 parâmetro) continuam compatíveis.

- [ ] **Step 4: Script de assinatura por empresa**

Em `scripts/setup-sqs-subscriptions.ts`:
1. Imports: acrescentar `getCredentialsOrThrow` ao import de `@/modules/amazon/service` e `import { runWithTenant } from "@/lib/tenant-context";`.
2. Depois de `const QUEUE_ARN = …`:
```ts
// --empresa=<id>: usa o app LWA/refresh token DA EMPRESA (ex.: udncd) em vez
// da credencial global da primária. Sem a flag, comportamento antigo.
const EMPRESA = process.argv.find((a) => a.startsWith("--empresa="))?.slice("--empresa=".length) || null;
```
3. Em `main()`, trocar o bloco `const config = await getAmazonConfig(); … const creds: SPAPICredentials = { … };` por:
```ts
  let creds: SPAPICredentials;
  if (EMPRESA) {
    creds = await getCredentialsOrThrow();
    console.log(`→ Empresa ${EMPRESA}: credencial do app da própria conta`);
  } else {
    const config = await getAmazonConfig();
    if (!isAmazonConfigured(config)) {
      console.error("Credenciais Amazon não configuradas.");
      process.exit(1);
    }
    creds = {
      clientId: config.amazon_client_id!,
      clientSecret: config.amazon_client_secret!,
      refreshToken: config.amazon_refresh_token!,
      marketplaceId: config.amazon_marketplace_id!,
      endpoint: config.amazon_endpoint || undefined,
    };
  }
```
4. Trocar o rodapé `main().catch(…)` por:
```ts
const executar = EMPRESA
  ? () => runWithTenant({ empresaId: EMPRESA, isSuperAdmin: false, source: "worker" }, main)
  : main;

executar().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Verificar e commitar**

Run: `npx eslint src/modules/amazon/sqs-cobertura.ts src/modules/amazon/jobs.ts scripts/setup-sqs-subscriptions.ts && npx tsc --noEmit && npx vitest run src/modules/amazon/sqs-cobertura.test.ts`
Rodar também os testes existentes do agendador: `npx vitest run src/modules/amazon/jobs` (se existir `jobs*.test.ts`).
Expected: sem erros; PASS.

```bash
git add src/modules/amazon/sqs-cobertura.ts src/modules/amazon/sqs-cobertura.test.ts src/modules/amazon/jobs.ts scripts/setup-sqs-subscriptions.ts
git commit -m "feat(amazon): ORDERS_SYNC a cada 2 min para empresa sem SQS e assinatura ORDER_CHANGE por empresa

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# FASE 4 — Alterar preço na Amazon pelo celular

## Task 18: Módulo de preço (Listings Items API) e teste de permissão

**Files:**
- Modify: `src/lib/amazon-rate-limit.ts` (`AmazonSpApiOperation` ~L4-30; mapa de limites ~L120)
- Create: `src/modules/amazon/listings-preco.ts`, `src/modules/amazon/listings-preco.test.ts`
- Create: `scripts/verificar-permissao-preco.ts`

**Interfaces:**
- Consumes:
  - `getListingsItem`, `spApiRequest` (`@/lib/amazon-sp-api`, sem editar esse arquivo)
  - `getCredentialsOrThrow`, `resolverSellerIdDoTenant` (`@/modules/amazon/service`)
  - `AmazonQuotaCooldownError` (`@/lib/amazon-rate-limit`)
- Produces:
  - `AmazonSpApiOperation.LISTINGS_PATCH_ITEM`
  - `LIMITE_VARIACAO_SEM_CONFIRMACAO = 0.3`
  - `precisaConfirmarVariacao(atualCentavos: number | null, novoCentavos: number): boolean`
  - `montarPatchPreco({ productType, marketplaceId, precoCentavos })`
  - `ehErroPermissaoListing(err: unknown): boolean`, `ehErroQuota(err: unknown): boolean`
  - `class PermissaoListingNegadaError`, `class PrecoRejeitadoError`
  - `type ResultadoPatchListing`
  - `enviarPrecoAmazon({ sku, precoCentavos, somenteValidar }): Promise<ResultadoPatchListing>`

- [ ] **Step 1: Operação de rate limit**

Em `src/lib/amazon-rate-limit.ts`:
- em `export const AmazonSpApiOperation = {`, depois de `LISTINGS_GET_ITEM: "LISTINGS_GET_ITEM",`, acrescentar `LISTINGS_PATCH_ITEM: "LISTINGS_PATCH_ITEM",`;
- no mapa de limites, depois do bloco `[AmazonSpApiOperation.LISTINGS_GET_ITEM]: { … },`, acrescentar:
```ts
  // Listings Items v2021-08-01 patchListingsItem: 5 rps, burst 10.
  [AmazonSpApiOperation.LISTINGS_PATCH_ITEM]: {
    rateLimitPerSecond: 5,
    burst: 10,
  },
```
Se o mapa for tipado como `Record<AmazonSpApiOperationType, …>`, o `tsc` exige a entrada nova. É exatamente o que foi acrescentado.

- [ ] **Step 2: Teste que falha**

`src/modules/amazon/listings-preco.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spMock, serviceMock } = vi.hoisted(() => ({
  spMock: { getListingsItem: vi.fn(), spApiRequest: vi.fn() },
  serviceMock: { getCredentialsOrThrow: vi.fn(), resolverSellerIdDoTenant: vi.fn() },
}));
vi.mock("@/lib/amazon-sp-api", () => spMock);
vi.mock("@/modules/amazon/service", () => serviceMock);

import {
  ehErroPermissaoListing,
  enviarPrecoAmazon,
  montarPatchPreco,
  PermissaoListingNegadaError,
  PrecoRejeitadoError,
  precisaConfirmarVariacao,
} from "./listings-preco";

const CREDS = { marketplaceId: "A2Q3Y263D00KWC" };

beforeEach(() => {
  vi.clearAllMocks();
  serviceMock.getCredentialsOrThrow.mockResolvedValue(CREDS);
  serviceMock.resolverSellerIdDoTenant.mockResolvedValue("SELLER1");
  spMock.getListingsItem.mockResolvedValue({
    summaries: [{ marketplaceId: "A2Q3Y263D00KWC", productType: "FOOD_STORAGE_CONTAINER" }],
  });
  spMock.spApiRequest.mockResolvedValue({ status: "ACCEPTED", submissionId: "s1" });
});

describe("trava de variação", () => {
  it("R$ 77,00 → R$ 7,70 (dedo gordo) exige confirmação", () => {
    expect(precisaConfirmarVariacao(7700, 770)).toBe(true);
  });
  it("ajuste pequeno não pede confirmação; sem preço atual também não", () => {
    expect(precisaConfirmarVariacao(7700, 7990)).toBe(false);
    expect(precisaConfirmarVariacao(7700, 10010)).toBe(false); // exatamente 30%
    expect(precisaConfirmarVariacao(null, 1)).toBe(false);
  });
});

describe("montarPatchPreco", () => {
  it("troca o our_price do purchasable_offer em reais, no marketplace do Brasil", () => {
    expect(montarPatchPreco({ productType: "X", marketplaceId: "A2Q3Y263D00KWC", precoCentavos: 7700 })).toEqual({
      productType: "X",
      patches: [
        {
          op: "replace",
          path: "/attributes/purchasable_offer",
          value: [
            {
              marketplace_id: "A2Q3Y263D00KWC",
              currency: "BRL",
              our_price: [{ schedule: [{ value_with_tax: 77 }] }],
            },
          ],
        },
      ],
    });
  });
});

describe("enviarPrecoAmazon", () => {
  it("validação sem efeito usa VALIDATION_PREVIEW e o productType do anúncio", async () => {
    spMock.spApiRequest.mockResolvedValue({ status: "VALID" });
    await enviarPrecoAmazon({ sku: "MFS-0036", precoCentavos: 7700, somenteValidar: true });
    const [, path, opts] = spMock.spApiRequest.mock.calls[0];
    expect(path).toBe("/listings/2021-08-01/items/SELLER1/MFS-0036");
    expect(opts.method).toBe("PATCH");
    expect(opts.params).toMatchObject({ marketplaceIds: "A2Q3Y263D00KWC", mode: "VALIDATION_PREVIEW" });
    expect(opts.body.productType).toBe("FOOD_STORAGE_CONTAINER");
    expect(opts.operation).toBe("LISTINGS_PATCH_ITEM");
  });

  it("403 vira PermissaoListingNegadaError", async () => {
    spMock.spApiRequest.mockRejectedValue(new Error("SP-API PATCH /listings/2021-08-01/items/SELLER1/MFS-0036 -> 403: {\"errors\":[]}"));
    await expect(enviarPrecoAmazon({ sku: "MFS-0036", precoCentavos: 7700, somenteValidar: false })).rejects.toBeInstanceOf(PermissaoListingNegadaError);
  });

  it("INVALID devolve a mensagem da Amazon", async () => {
    spMock.spApiRequest.mockResolvedValue({ status: "INVALID", issues: [{ severity: "ERROR", message: "Preço abaixo do mínimo permitido." }] });
    await expect(enviarPrecoAmazon({ sku: "MFS-0036", precoCentavos: 100, somenteValidar: false })).rejects.toThrow(PrecoRejeitadoError);
  });

  it("ehErroPermissaoListing só reconhece 403", () => {
    expect(ehErroPermissaoListing(new Error("… -> 403: {}"))).toBe(true);
    expect(ehErroPermissaoListing(new Error("… -> 400: {}"))).toBe(false);
  });
});
```

Run: `npx vitest run src/modules/amazon/listings-preco.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implementar**

`src/modules/amazon/listings-preco.ts`:
```ts
import { getListingsItem, spApiRequest } from "@/lib/amazon-sp-api";
import { AmazonQuotaCooldownError, AmazonSpApiOperation } from "@/lib/amazon-rate-limit";
import { getCredentialsOrThrow, resolverSellerIdDoTenant } from "@/modules/amazon/service";

// Alterar o preço do anúncio (our_price) via Listings Items API 2021-08-01.
// Exige a permissão "Product Listing" no app da Amazon. Sem ela, 403.

/** Mudança acima disso (para mais ou para menos) pede segunda confirmação. */
export const LIMITE_VARIACAO_SEM_CONFIRMACAO = 0.3;

export class PermissaoListingNegadaError extends Error {
  constructor() {
    super("A Amazon ainda não liberou alteração de preço para o Atlas (permissão Product Listing).");
    this.name = "PermissaoListingNegadaError";
  }
}

export class PrecoRejeitadoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "PrecoRejeitadoError";
  }
}

export type ResultadoPatchListing = {
  status?: string;
  submissionId?: string;
  issues?: Array<{ code?: string; message?: string; severity?: string }>;
};

export function precisaConfirmarVariacao(atualCentavos: number | null, novoCentavos: number): boolean {
  if (!atualCentavos || atualCentavos <= 0) return false;
  return Math.abs(novoCentavos - atualCentavos) / atualCentavos > LIMITE_VARIACAO_SEM_CONFIRMACAO;
}

export function montarPatchPreco(input: {
  productType: string;
  marketplaceId: string;
  precoCentavos: number;
}) {
  return {
    productType: input.productType,
    patches: [
      {
        op: "replace",
        path: "/attributes/purchasable_offer",
        value: [
          {
            marketplace_id: input.marketplaceId,
            currency: "BRL",
            our_price: [{ schedule: [{ value_with_tax: input.precoCentavos / 100 }] }],
          },
        ],
      },
    ],
  };
}

function mensagemDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** spApiRequest lança "SP-API PATCH … -> 403: {…}" quando falta a permissão. */
export function ehErroPermissaoListing(err: unknown): boolean {
  return /->\s*403\b/.test(mensagemDe(err));
}

export function ehErroQuota(err: unknown): boolean {
  return err instanceof AmazonQuotaCooldownError || /SP-API quota/.test(mensagemDe(err));
}

function errosDasIssues(r: ResultadoPatchListing): string | null {
  const erros = (r.issues ?? [])
    .filter((i) => (i.severity ?? "").toUpperCase() === "ERROR")
    .map((i) => i.message)
    .filter((m): m is string => !!m);
  return erros.length > 0 ? erros.join(" ") : null;
}

export async function enviarPrecoAmazon(input: {
  sku: string;
  precoCentavos: number;
  /** true = mode=VALIDATION_PREVIEW: a Amazon valida e NÃO aplica. */
  somenteValidar: boolean;
}): Promise<ResultadoPatchListing> {
  const creds = await getCredentialsOrThrow();
  const sellerId = await resolverSellerIdDoTenant(creds);
  if (!sellerId) throw new Error("Não foi possível identificar a conta Amazon (sellerId).");

  const listing = await getListingsItem(creds, sellerId, input.sku, ["summaries"]);
  const productType =
    listing.summaries?.find((s) => s.marketplaceId === creds.marketplaceId)?.productType ??
    listing.summaries?.[0]?.productType;
  if (!productType) {
    throw new PrecoRejeitadoError("Anúncio sem tipo de produto na Amazon; altere o preço pelo Seller Central.");
  }

  let resultado: ResultadoPatchListing;
  try {
    resultado = await spApiRequest<ResultadoPatchListing>(
      creds,
      `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(input.sku)}`,
      {
        method: "PATCH",
        params: {
          marketplaceIds: creds.marketplaceId,
          issueLocale: "pt_BR",
          ...(input.somenteValidar ? { mode: "VALIDATION_PREVIEW" } : {}),
        },
        body: montarPatchPreco({
          productType,
          marketplaceId: creds.marketplaceId,
          precoCentavos: input.precoCentavos,
        }),
        operation: AmazonSpApiOperation.LISTINGS_PATCH_ITEM,
      },
    );
  } catch (err) {
    if (ehErroPermissaoListing(err)) throw new PermissaoListingNegadaError();
    throw err;
  }

  if ((resultado.status ?? "").toUpperCase() === "INVALID") {
    throw new PrecoRejeitadoError(errosDasIssues(resultado) ?? "A Amazon recusou este preço.");
  }
  return resultado;
}
```
Se o `tsc` acusar que `getListingsItem` não aceita `["summaries"]` como 4º argumento (assinatura `includedData = [...]`), passar a lista como `string[]`. Ela já tem default e aceita array.

Run: `npx vitest run src/modules/amazon/listings-preco.test.ts` → Expected: PASS (8 testes).

- [ ] **Step 4: Script de verificação (sem efeito)**

`scripts/verificar-permissao-preco.ts`:
```ts
/**
 * Verifica, SEM ALTERAR NADA, se o app pode mudar preço de anúncio (permissão
 * "Product Listing"): patchListingsItem com mode=VALIDATION_PREVIEW enviando
 * o PREÇO ATUAL do produto (cache amazonPrecoListagemCentavos).
 *
 * Uso: npx tsx scripts/verificar-permissao-preco.ts --empresa=mundofs --sku=MFS-0036
 */
import { loadEnvConfig } from "@next/env";
import { db } from "@/lib/db";
import { runWithTenant } from "@/lib/tenant-context";
import { enviarPrecoAmazon, PermissaoListingNegadaError } from "@/modules/amazon/listings-preco";

loadEnvConfig(process.cwd());

function argumento(nome: string): string | null {
  const prefixo = `--${nome}=`;
  return process.argv.find((a) => a.startsWith(prefixo))?.slice(prefixo.length) || null;
}

async function main() {
  const empresaId = argumento("empresa") ?? "mundofs";
  const sku = argumento("sku");
  if (!sku) {
    console.error("Informe --sku=<SKU>");
    process.exit(1);
  }
  await runWithTenant({ empresaId, isSuperAdmin: false, source: "worker" }, async () => {
    const produto = await db.produto.findFirst({
      where: { sku },
      select: { amazonPrecoListagemCentavos: true },
    });
    const preco = produto?.amazonPrecoListagemCentavos;
    if (!preco) {
      console.error(`SKU ${sku} sem preço de listagem em cache — escolha outro SKU.`);
      process.exitCode = 1;
      return;
    }
    try {
      const r = await enviarPrecoAmazon({ sku, precoCentavos: preco, somenteValidar: true });
      console.log(`✓ Permissão OK (${empresaId}). Validação: ${r.status ?? "?"}`);
      if (r.issues?.length) console.log(JSON.stringify(r.issues, null, 2));
    } catch (e) {
      if (e instanceof PermissaoListingNegadaError) {
        console.log(`✗ ${empresaId}: 403 — falta a permissão Product Listing no app da Amazon.`);
        process.exitCode = 2;
        return;
      }
      throw e;
    }
  });
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 5: Verificar e commitar**

Run: `npx eslint src/lib/amazon-rate-limit.ts src/modules/amazon/listings-preco.ts scripts/verificar-permissao-preco.ts && npx tsc --noEmit && npx vitest run src/modules/amazon/listings-preco.test.ts`
Expected: sem erros; PASS.

```bash
git add src/lib/amazon-rate-limit.ts src/modules/amazon/listings-preco.ts src/modules/amazon/listings-preco.test.ts scripts/verificar-permissao-preco.ts
git commit -m "feat(amazon): alterar preço do anúncio via Listings API com trava de variação

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 19: Rota e folha "Alterar preço na Amazon"

**Files:**
- Create: `src/app/api/produtos/[id]/preco-amazon/route.ts`
- Create: `src/components/produtos/alterar-preco-sheet.tsx`
- Modify: `src/app/produtos/[id]/page.tsx` (prop `acaoPreco` do `ProdutoMobile`)

**Interfaces:**
- Consumes: Task 18 (`enviarPrecoAmazon`, `precisaConfirmarVariacao`, erros), Task 10 (`ProdutoMobile.acaoPreco`, `reprojetarParaPreco`, `parseValorBRL`, `ResumoMobileProduto`), Task 2 (`TipoAuditLog.PRECO_AMAZON_ALTERADO`).
- Produces:
  - `POST /api/produtos/[id]/preco-amazon` body `{ precoCentavos: number; confirmarVariacao?: boolean }`:
    - 200 `{ ok, status }`
    - 409 `CONFIRMAR_VARIACAO`
    - 403 permissão
    - 422 recusado
    - 429 quota
    - 502 Amazon fora
  - `<BotaoAlterarPreco resumo />` (só ADMIN)

- [ ] **Step 1: Rota**

`src/app/api/produtos/[id]/preco-amazon/route.ts`:
```ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { erro, handleAuth, ok } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { TipoAuditLog } from "@/modules/shared/domain";
import {
  ehErroQuota,
  enviarPrecoAmazon,
  PermissaoListingNegadaError,
  precisaConfirmarVariacao,
  PrecoRejeitadoError,
  type ResultadoPatchListing,
} from "@/modules/amazon/listings-preco";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  precoCentavos: z.number().int().min(100).max(10_000_000),
  confirmarVariacao: z.boolean().optional(),
});

export const POST = handleAuth(
  [UsuarioRole.ADMIN],
  async (req: NextRequest, { params }: Params) => {
    const session = await requireRole(UsuarioRole.ADMIN);
    const { id } = await params;
    const body = schema.parse(await req.json());

    const produto = await db.produto.findFirst({
      where: { id },
      select: { id: true, sku: true, amazonPrecoListagemCentavos: true },
    });
    if (!produto) return erro(404, "produto não encontrado");

    const atual = produto.amazonPrecoListagemCentavos;
    if (precisaConfirmarVariacao(atual, body.precoCentavos) && !body.confirmarVariacao) {
      return erro(409, "CONFIRMAR_VARIACAO", { atualCentavos: atual, novoCentavos: body.precoCentavos });
    }

    let resultado: ResultadoPatchListing;
    try {
      resultado = await enviarPrecoAmazon({
        sku: produto.sku,
        precoCentavos: body.precoCentavos,
        somenteValidar: false,
      });
    } catch (e) {
      if (e instanceof PermissaoListingNegadaError) {
        return erro(403, `${e.message} Habilite-a no Developer Central e reconecte a loja em Configurações → Integrações.`);
      }
      if (e instanceof PrecoRejeitadoError) return erro(422, e.message);
      if (ehErroQuota(e)) return erro(429, "A Amazon pediu para esperar. Tente de novo em instantes.");
      logger.warn(
        { err: e instanceof Error ? e.message : String(e), sku: produto.sku },
        "preço amazon: falha no PATCH",
      );
      return erro(502, "A Amazon não respondeu. Tente de novo em instantes.");
    }

    await db.produto.update({
      where: { id: produto.id },
      data: { amazonPrecoListagemCentavos: body.precoCentavos, amazonPrecoListagemSyncEm: new Date() },
    });
    await auditLog({
      session,
      req,
      acao: TipoAuditLog.PRECO_AMAZON_ALTERADO,
      entidade: "Produto",
      entidadeId: produto.id,
      antes: { precoCentavos: atual },
      depois: { precoCentavos: body.precoCentavos },
      metadata: { sku: produto.sku, status: resultado.status, submissionId: resultado.submissionId },
    });
    return ok({ ok: true, status: resultado.status ?? null });
  },
);
```

- [ ] **Step 2: Folha + botão**

`src/components/produtos/alterar-preco-sheet.tsx`:
```tsx
"use client";

import * as React from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarginBadge } from "@/components/ui/margin-badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  parseValorBRL,
  reprojetarParaPreco,
  type ResumoMobileProduto,
} from "@/modules/produtos/resumo-mobile";

type Me = { usuario: { role: string } };

function centavosParaTexto(c: number | null) {
  return c == null ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

export function AlterarPrecoSheet({
  aberto,
  onAbertoChange,
  resumo,
}: {
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
  resumo: ResumoMobileProduto;
}) {
  const qc = useQueryClient();
  const [texto, setTexto] = React.useState(centavosParaTexto(resumo.preco.centavos));
  const [confirmando, setConfirmando] = React.useState(false);

  React.useEffect(() => {
    if (aberto) {
      setTexto(centavosParaTexto(resumo.preco.centavos));
      setConfirmando(false);
    }
  }, [aberto, resumo.preco.centavos]);

  const novo = parseValorBRL(texto);
  const depois = resumo.unidade && novo ? reprojetarParaPreco(resumo.unidade, novo, resumo.impostoBps) : null;

  const enviar = useMutation({
    mutationFn: (confirmarVariacao: boolean) =>
      fetchJSON<{ ok: true }>(`/api/produtos/${resumo.produto.id}/preco-amazon`, {
        method: "POST",
        body: JSON.stringify({ precoCentavos: novo, confirmarVariacao }),
      }),
    onSuccess: () => {
      toast.success(`Preço ${formatBRL(novo ?? 0)} enviado para a Amazon. Aparece na loja em alguns minutos.`);
      void qc.invalidateQueries({ queryKey: ["produto-resumo-mobile", resumo.produto.id] });
      onAbertoChange(false);
    },
    onError: (e: Error) => {
      if (e.message === "CONFIRMAR_VARIACAO") {
        setConfirmando(true);
        return;
      }
      toast.error(e.message || "Não foi possível alterar o preço.");
    },
  });

  return (
    <Sheet open={aberto} onOpenChange={onAbertoChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] overflow-y-auto rounded-t-2xl px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <SheetTitle className="text-lg">Alterar preço na Amazon</SheetTitle>
        <SheetDescription className="line-clamp-1">
          {resumo.produto.sku} · {resumo.produto.nome}
        </SheetDescription>

        <div className="mt-4 space-y-1.5">
          <Label htmlFor="novo-preco">Novo preço de venda</Label>
          <div className="flex h-12 items-center gap-2 rounded-xl border-2 border-primary px-3">
            <span className="text-lg font-semibold text-muted-foreground">R$</span>
            <Input
              id="novo-preco"
              inputMode="decimal"
              autoComplete="off"
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                setConfirmando(false);
              }}
              className="h-auto border-0 p-0 text-xl font-bold shadow-none focus-visible:ring-0"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Atual: {resumo.preco.centavos == null ? "—" : formatBRL(resumo.preco.centavos)}
          </p>
        </div>

        <p className="mt-4 flex gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[13px] leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          O preço muda no anúncio da Amazon. Pode levar alguns minutos para aparecer na loja.
        </p>

        {resumo.unidade && depois && (
          <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3 py-3 text-sm">
            <span className="text-muted-foreground">Lucro por unidade</span>
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground">
                {resumo.unidade.lucroCentavos == null ? "—" : formatBRL(resumo.unidade.lucroCentavos)}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <strong className={cn((depois.lucroCentavos ?? 0) < 0 && "text-red-600")}>
                {depois.lucroCentavos == null ? "—" : formatBRL(depois.lucroCentavos)}
              </strong>
              <MarginBadge value={depois.margemPercentual} />
            </span>
          </div>
        )}

        {confirmando && novo && (
          <p role="alert" className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            Você está mudando de {formatBRL(resumo.preco.centavos ?? 0)} para{" "}
            <strong>{formatBRL(novo)}</strong>, uma diferença grande. Confirma?
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-12" onClick={() => onAbertoChange(false)}>
            Cancelar
          </Button>
          <Button
            className={cn("h-12", confirmando && "bg-red-600 hover:bg-red-700")}
            disabled={!novo || novo === resumo.preco.centavos || enviar.isPending}
            onClick={() => enviar.mutate(confirmando)}
          >
            {enviar.isPending ? "Enviando…" : confirmando ? "Confirmar mudança" : "Enviar para a Amazon"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Botão do card de preço: só ADMIN altera preço na Amazon. */
export function BotaoAlterarPreco({ resumo }: { resumo: ResumoMobileProduto }) {
  const [aberto, setAberto] = React.useState(false);
  const { data } = useQuery<Me>({
    queryKey: ["auth-me"],
    queryFn: () => fetchJSON<Me>("/api/auth/me"),
    staleTime: 60_000,
  });
  if (data?.usuario.role !== "ADMIN" || resumo.preco.centavos == null) return null;
  return (
    <>
      <Button
        variant="outline"
        className="h-11 border-primary/40 text-primary"
        onClick={() => setAberto(true)}
      >
        Alterar
      </Button>
      <AlterarPrecoSheet aberto={aberto} onAbertoChange={setAberto} resumo={resumo} />
    </>
  );
}
```

- [ ] **Step 3: Ligar no detalhe**

Em `src/app/produtos/[id]/page.tsx`:
- import `import { BotaoAlterarPreco } from "@/components/produtos/alterar-preco-sheet";`;
- trocar `<ProdutoMobile produtoId={id} />` por:
```tsx
        <ProdutoMobile
          produtoId={id}
          acaoPreco={(resumo) => <BotaoAlterarPreco resumo={resumo} />}
        />
```

- [ ] **Step 4: Verificar e commitar**

Run: `npx eslint "src/app/api/produtos/[id]/preco-amazon/route.ts" src/components/produtos/alterar-preco-sheet.tsx "src/app/produtos/[id]/page.tsx" && npx tsc --noEmit`
Expected: sem erros.

```bash
git add "src/app/api/produtos/[id]/preco-amazon" src/components/produtos/alterar-preco-sheet.tsx "src/app/produtos/[id]/page.tsx"
git commit -m "feat(mobile): alterar preço na Amazon pelo celular (ADMIN, com confirmação)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# FECHAMENTO

## Task 20: E2E mobile (Playwright, Pixel 7)

**Files:**
- Modify: `playwright.config.ts` (`projects`)
- Create: `tests/e2e/mobile-shell.spec.ts`

- [ ] **Step 1: Project mobile**

Em `playwright.config.ts`, trocar o array `projects` por:
```ts
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /mobile-.*\.spec\.ts/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: /mobile-.*\.spec\.ts/,
    },
  ],
```

- [ ] **Step 2: Spec**

`tests/e2e/mobile-shell.spec.ts`:
```ts
import crypto from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";

const sessionSecret =
  process.env.SESSION_SECRET ?? "playwright-session-secret-0123456789abcdef0123456789abcdef";
const baseURL = `http://localhost:${process.env.PLAYWRIGHT_PORT ?? 3107}`;

function base64Url(value: Buffer) {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signSession(payload: Record<string, unknown>) {
  const json = JSON.stringify(payload);
  const assinatura = crypto.createHmac("sha256", sessionSecret).update(json).digest();
  return `${base64Url(Buffer.from(json))}.${base64Url(assinatura)}`;
}

const KPIS = {
  faturamentoCentavos: 3894017, freteCentavos: 0, faturamentoComFreteCentavos: 3894017,
  faturamentoReembolsadoCentavos: 0, faturamentoComReembolsadosCentavos: 3894017,
  liquidoMarketplaceCentavos: 2790514, impostoSimplesCentavos: 0, impostoSimplesAliquotaBps: 600,
  impostoSimplesAtivo: true, lucroBrutoCentavos: 529626, margemPercentual: 13.6, numeroVendas: 431,
  unidades: 538, ticketMedioCentavos: 9034, roiPercentual: 21.4, valorAdsCentavos: 146832,
  tacosPercentual: 3.8, lucroPosAdsCentavos: 382794, mpaPercentual: 9.8, contasFixasCentavos: 0,
  mpaPosContasFixasPercentual: null, roiPosAdsPercentual: 15.5, trafficSessions: 0,
  trafficPageViews: 0, trafficUnitsOrdered: 0, trafficRevenueOrderedCentavos: 0,
  trafficConversionPercent: null, trafficBuyBoxPercent: null, vendasSemCusto: 0,
  delta: {
    faturamento: 12.4, frete: null, faturamentoComFrete: null, faturamentoReembolsado: null,
    faturamentoComReembolsados: null, liquidoMarketplace: null, lucroBruto: 8.1, margem: -0.6,
    numeroVendas: 9, unidades: null, ticketMedio: null, roi: 1.8, valorAds: 4.2, tacos: null,
    lucroPosAds: -2, roiPosAds: null,
  },
};

const TOP = [
  {
    sku: "MFS-0036", produtoId: "p1", nome: "Kit 3 Potes Marinex Facilita Vap 1 Litro", imagemUrl: null,
    amazonImagemUrl: null, asin: null, precoMedioCentavos: 7866, custoUnitarioCentavos: 4758,
    unidades: 65, faturadoCentavos: 511314, representatividadePercentual: 13.1, lucroCentavos: 63337,
    impostoSimplesCentavos: 0, margemPercentual: 12.4, custoAdsCentavos: 25566,
    lucroPosAdsCentavos: 37771, mpaPercentual: 7.4,
  },
];

async function logar(context: BrowserContext, ocultas: string[] = []) {
  await context.addCookies([
    {
      name: "erp_session",
      value: signSession({
        uid: "user-e2e", email: "e2e@atlas.test", nome: "E2E Admin", role: "ADMIN",
        exp: Math.floor(Date.now() / 1000) + 3600, v: 0, empresaId: "empresa-e2e",
      }),
      url: baseURL,
      sameSite: "Lax",
      httpOnly: true,
    },
  ]);
  await context.route("**/api/menu/preferencias", (r) => r.fulfill({ json: { ocultas } }));
  await context.route("**/api/auth/me", (r) =>
    r.fulfill({ json: { usuario: { id: "user-e2e", nome: "E2E Admin", email: "e2e@atlas.test", role: "ADMIN", avatarUrl: null } } }),
  );
  await context.route("**/api/notificacoes/contar", (r) => r.fulfill({ json: { total: 0 } }));
  await context.route("**/api/push/config", (r) => r.fulfill({ json: { enabled: false, publicKey: null, loja: "Loja E2E" } }));
  await context.route("**/api/dashboard-ecommerce/kpis**", (r) => r.fulfill({ json: KPIS }));
  await context.route("**/api/dashboard-ecommerce/timeline**", (r) => r.fulfill({ json: [] }));
  await context.route("**/api/dashboard-ecommerce/top-produtos**", (r) => r.fulfill({ json: TOP }));
}

test("manifest e service worker abrem sem login", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  expect((await manifest.json()).name).toBe("Atlas Seller");
  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["content-type"]).toContain("javascript");
});

test("barra inferior e folha Mais respeitam o menu do usuário", async ({ context, page }) => {
  await logar(context, ["/agenda"]);
  await page.goto("/dashboard-ecommerce");
  const nav = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(nav.getByRole("link", { name: "Início" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Vendas" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Produtos" })).toBeVisible();
  await nav.getByRole("button", { name: "Mais" }).click();
  const folha = page.getByRole("dialog");
  await expect(folha.getByText("Personalizar menu")).toBeVisible();
  await expect(folha.getByRole("link", { name: "Caixa" })).toBeVisible();
  await expect(folha.getByRole("link", { name: "Agenda" })).toHaveCount(0);
});

test("dashboard no celular: 6 KPIs, MPA e Top 15, sem gráfico nem scroll lateral", async ({ context, page }) => {
  await logar(context);
  await page.goto("/dashboard-ecommerce");
  const mobile = page.getByTestId("dashboard-mobile");
  await expect(mobile.getByText("Gasto em anúncios", { exact: true })).toBeVisible();
  await expect(mobile.getByText("MPA · margem pós-anúncios")).toBeVisible();
  await expect(mobile.getByRole("heading", { name: "Top 15 produtos" })).toBeVisible();
  await expect(mobile.getByRole("link", { name: /Kit 3 Potes Marinex/ })).toBeVisible();
  await expect(page.getByText("Resumo de receitas")).toBeHidden();
  const [largura, viewport] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(largura).toBeLessThanOrEqual(viewport);
});
```

- [ ] **Step 3: Rodar**

```bash
npx playwright install chromium
npx playwright test --project=mobile
```
Expected: 3 testes PASS.

Se o servidor de dev não subir por causa do `dev.db` vazio, isso não afeta: todas as APIs usadas estão mockadas. Se alguma outra chamada da página falhar com 401, ignorar, porque não altera as asserções.

As asserções do dashboard ficam dentro de `getByTestId("dashboard-mobile")` porque a versão desktop (escondida) repete os mesmos textos e quebraria o modo estrito do Playwright.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts tests/e2e/mobile-shell.spec.ts
git commit -m "test(e2e): shell mobile (PWA público, barra inferior, Mais e dashboard)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 21: Documentação

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-10-06-atlas-mobile-pwa-design.md` (§10)

- [ ] **Step 1: CLAUDE.md**

Acrescentar, depois da seção "### Resumo diário de estoque (WhatsApp via WAHA)":
```markdown
### Atlas mobile (PWA + push de venda + menu por usuário)
- **Instalável** sem loja de apps:
  - `src/app/manifest.ts` + `public/sw.js` (SÓ push/clique, **sem fetch handler e sem cache**: zero dado velho e zero cache cruzado entre contas);
  - ícones em `public/icons/` (gerar com `node scripts/gerar-icones-pwa.mjs`);
  - `/sw.js` e `/manifest.webmanifest` são públicos no `proxy.ts`.
- **iPhone:** push só com o app instalado na Tela de Início (iOS 16.4+).
- **Celular (< lg):**
  - `BottomNav` (Início/Vendas/Produtos/Mais) substitui o drawer; a folha "Mais" lista as abas visíveis + conta/app;
  - Dashboard no celular = 6 KPIs + MPA + Top 15 (`components/dashboard-ecommerce/dashboard-mobile.tsx`); desktop intocado;
  - produto no celular = `components/produtos/produto-mobile.tsx` (estoque, lucro por unidade, alterar custo/preço).
- **Menu por usuário:**
  - `ConfiguracaoSistema` chave `menu_abas_ocultas:u:<usuarioId>`; API `/api/menu/preferencias`; aba Configurações → Menu;
  - fixas: Dashboard, Vendas, Produtos, Configurações;
  - esconder aba NÃO desliga nada (URL e jobs seguem).
- **Push de venda** (`src/modules/push/`):
  - **Gatilho principal:** consumidor SQS no `ORDER_CHANGE` (`notificarVendaDeOrderChange`, ~15–30 s após a compra).
  - **Gatilho de reserva:** ORDERS_SYNC (`notificarVendasCriadasNoSync`).
  - **Idempotência:** `PushEnvio` `[empresaId, "venda:<orderId>"]`.
  - **Texto:** "Nova venda na <Empresa.nome>" + valor (`~` = estimado). **NUNCA** produto, SKU ou quantidade.
  - **Regras:** recência 2 h; cancelado não avisa; mais de 3 de uma vez → aviso agrupado.
  - **Aparelhos:** `PushDispositivo` é **GLOBAL** com unique `[empresaId, endpoint]` (mesmo celular em MundoFS e UDN). 404/410 apaga a inscrição; 5 falhas desativam o aparelho.
  - **VAPID** em `.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). **Nunca rotacionar à toa**: invalida todos os aparelhos.
- **Empresa sem ORDER_CHANGE nas últimas 24 h:** ORDERS_SYNC a cada 2 min (`modules/amazon/sqs-cobertura.ts`). Assinar por empresa: `npx tsx scripts/setup-sqs-subscriptions.ts --empresa=<empresaId>`.
- **Preço na Amazon:**
  - `modules/amazon/listings-preco.ts` (`patchListingsItem`, `purchasable_offer.our_price`);
  - exige a permissão **Product Listing**; checar sem efeito com `npx tsx scripts/verificar-permissao-preco.ts --empresa=<id> --sku=<SKU>`;
  - variação acima de ±30% pede segunda confirmação.
```

Na tabela "Schedules", na linha do `ORDERS_SYNC`, acrescentar ao texto de Notas: `; 2 min p/ empresa sem ORDER_CHANGE recente (mesmo com SQS_PRIMARY)`.

- [ ] **Step 2: Spec §10**

No spec, trocar a frase "Cada fase vai em uma branch e um PR próprios…" por: "Entrega numa branch única (`feat/atlas-mobile`, worktree), com um commit por tarefa do plano `docs/superpowers/plans/2026-10-06-atlas-mobile.md`, publicada de uma vez na trunk de produção."

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-10-06-atlas-mobile-pwa-design.md docs/superpowers/plans/2026-10-06-atlas-mobile.md
git commit -m "docs: Atlas mobile (PWA, push de venda, menu por usuário, preço na Amazon)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 22: Verificação completa antes do deploy

- [ ] **Step 1: Typecheck e lint de tudo que mudou**

```bash
npx tsc --noEmit
git diff --name-only origin/feat/multitenant-fase0-seguranca...HEAD -- '*.ts' '*.tsx' | xargs npx eslint
```
Expected: zero erros.

- [ ] **Step 2: Testes unitários desta feature + vizinhos tocados**

```bash
npx vitest run src/modules/menu src/modules/push src/lib/pwa src/lib/push src/modules/dashboard-ecommerce/kpis-mobile.test.ts src/modules/vendas/pedido-param.test.ts src/modules/produtos/resumo-mobile.test.ts src/modules/produtos/cobertura.test.ts src/modules/whatsapp-estoque src/modules/amazon/sqs-cobertura.test.ts src/modules/amazon/listings-preco.test.ts src/lib/tenant-isolation.test.ts src/lib/amazon-sqs.test.ts src/modules/amazon/jobs.test.ts
```
Expected: todos PASS. Falha em `amazon-sqs.test.ts`/`jobs.test.ts` = regressão desta feature: investigar com superpowers:systematic-debugging antes de seguir.

- [ ] **Step 3: Build de produção local**

```bash
npm run build
```
Expected: `✓ Compiled successfully`; rotas `/manifest.webmanifest`, `/api/push/*`, `/api/menu/preferencias` e `/api/produtos/[id]/resumo-mobile` listadas.

- [ ] **Step 4: Smoke manual (dev, DevTools 390×844)**

`npm run dev:web` e, logado:
1. a barra inferior aparece;
2. Mais → Personalizar menu → desligar "Caixa" → a sidebar (desktop) e o Mais mudam;
3. no Dashboard, 6 KPIs + MPA + Top 15 com foto;
4. Produtos → um produto → Alterar custo → prévia muda ao digitar;
5. `/vendas?pedido=<id real>` → card aberto com anel azul;
6. Configurações → Notificações → "Neste celular" aparece (sem VAPID local: "Este navegador não recebe notificações"; esperado).

Anotar qualquer desvio e corrigir antes do deploy.

---

## Task 23: Deploy em produção (VPS) e verificação ao vivo

> Produção roda a branch `feat/multitenant-fase0-seguranca` em `/opt/erp-amazon` (usuário `erp`; acesso `ssh erp-vps` como `mundofs` com `sudo`). Migration só cria tabelas novas.

- [ ] **Step 1: Publicar a branch e avançar a trunk (fast-forward)**

```bash
cd /c/Projects/ERP-AMAZON-mobile
git fetch origin
git merge-base --is-ancestor origin/feat/multitenant-fase0-seguranca HEAD && echo "FF ok"
git push -u origin feat/atlas-mobile
git push origin feat/atlas-mobile:feat/multitenant-fase0-seguranca
```
Se "FF ok" não aparecer (a trunk andou):
1. `git rebase origin/feat/multitenant-fase0-seguranca`;
2. repetir a Task 22 Steps 1-3;
3. empurrar de novo.

- [ ] **Step 2: Backup do banco antes da migration**

```bash
ssh erp-vps 'mkdir -p ~/backups && sudo -u postgres pg_dump erp_amazon | gzip > ~/backups/erp_amazon_pre_mobile_$(date +%Y%m%d%H%M).sql.gz && ls -lh ~/backups | tail -2'
```
Expected: arquivo `.sql.gz` com tamanho > 1 MB.

- [ ] **Step 3: Pull, deps, migration e client**

```bash
ssh erp-vps 'cd /opt/erp-amazon && sudo -u erp git stash push -m "pre-deploy-$(date +%s)" -- src/lib/amazon-sp-api.ts src/lib/amazon-ads-api.ts src/lib/amazon-sqs.ts package-lock.json; sudo -u erp git pull --ff-only origin feat/multitenant-fase0-seguranca && sudo -u erp npm install --no-audit --no-fund && sudo -u erp npm run prisma:migrate:deploy:pg && sudo -u erp npm run prisma:generate:pg && sudo -u erp git log --oneline -1'
```
Expected: `20261007120000_push_mobile` aplicada; HEAD = último commit da feature.

- [ ] **Step 4: Chaves VAPID (uma única vez) + backup do `.env`**

```bash
ssh erp-vps 'cd /opt/erp-amazon && if ! sudo grep -q "^VAPID_PUBLIC_KEY=" .env; then sudo -u erp npx web-push generate-vapid-keys --json > /tmp/vapid.json && PUB=$(node -e "console.log(require(\"/tmp/vapid.json\").publicKey)") && PRIV=$(node -e "console.log(require(\"/tmp/vapid.json\").privateKey)") && printf "\nVAPID_PUBLIC_KEY=%s\nVAPID_PRIVATE_KEY=%s\nVAPID_SUBJECT=https://erp.mundofs.cloud\n" "$PUB" "$PRIV" | sudo tee -a .env > /dev/null && shred -u /tmp/vapid.json && echo "VAPID criado"; else echo "VAPID já existia"; fi; sudo cp .env ~/backups/env-$(date +%Y%m%d%H%M).bak && sudo chown mundofs ~/backups/env-*.bak && chmod 600 ~/backups/env-*.bak && sudo grep -c "^VAPID_" .env'
```
Expected: `VAPID criado` (ou `já existia`) e contagem `3`. **Nunca imprimir a chave privada no terminal.**

- [ ] **Step 5: Build e restart (restart, não reload)**

```bash
ssh erp-vps 'cd /opt/erp-amazon && sudo -u erp rm -rf .next && sudo -u erp npm run build && sudo -u erp sed -i "s/^GIT_SHA=.*/GIT_SHA=$(sudo -u erp git rev-parse --short HEAD)/" .env && sudo -u erp pm2 restart erp-web --update-env && sudo -u erp pm2 restart erp-worker --update-env && sudo -u erp pm2 restart erp-sqs-consumer --update-env && sudo -u erp pm2 ls'
```
Expected: os 3 processos `online`. Se o build falhar por falta de memória, rodar de novo com `NODE_OPTIONS=--max-old-space-size=1536`.

- [ ] **Step 6: Smoke em produção**

```bash
curl -s -o /dev/null -w "manifest %{http_code}\n" https://erp.mundofs.cloud/manifest.webmanifest
curl -s -o /dev/null -w "sw %{http_code} %{content_type}\n" https://erp.mundofs.cloud/sw.js
curl -s https://erp.mundofs.cloud/api/health | head -c 300; echo
ssh erp-vps 'sudo -u postgres psql -d erp_amazon -c "select count(*) from \"PushDispositivo\"; select count(*) from \"PushEnvio\";"; sudo -u erp pm2 logs --nostream --lines 40 erp-sqs-consumer | tail -20; sudo -u erp pm2 logs --nostream --lines 40 erp-web | grep -i error | tail -5'
```
Expected: manifest 200, sw 200 `application/javascript`, health ok, tabelas existem (count 0), sem erro novo nos logs.

- [ ] **Step 7: UDN: assinatura ORDER_CHANGE (UDN = `cmpy390qn0006vy7lhl9qkbzg`)**

```bash
ssh erp-vps 'cd /opt/erp-amazon && sudo -u erp npx tsx scripts/setup-sqs-subscriptions.ts --empresa=cmpy390qn0006vy7lhl9qkbzg'
```
Expected: `ORDER_CHANGE: criada (…)` ou `já existe`. Se der 403/erro de destination, anotar a mensagem para o relatório final. Mesmo assim a UDN já cai no polling de 2 min (Task 17), sem ação adicional.

- [ ] **Step 8: Permissão de preço (sem efeito)**

```bash
ssh erp-vps 'cd /opt/erp-amazon && sudo -u erp npx tsx scripts/verificar-permissao-preco.ts --empresa=mundofs --sku=MFS-0036; echo "exit=$?"'
```
Expected: `✓ Permissão OK` (exit 0) ou `✗ … 403` (exit 2). Em caso de 403, o botão "Alterar preço" responde com a mensagem de permissão até o usuário liberar a role "Product Listing" e reconectar a loja. Registrar no relatório.

- [ ] **Step 9: Confirmar o gatilho com uma venda real**

Aguardar a próxima venda (a MundoFS faz ~15–29/dia) e conferir:
```bash
ssh erp-vps 'sudo -u postgres psql -d erp_amazon -c "select \"empresaId\", tipo, status, \"enviadosOk\", \"criadoEm\" from \"PushEnvio\" order by \"criadoEm\" desc limit 5;"'
```
Expected: linha `VENDA_NOVA` com `SEM_DESTINO` (nenhum aparelho inscrito ainda), segundos depois da compra. Isso prova que o gatilho dispara. Se nenhuma venda chegar em ~1 h, registrar e seguir.

- [ ] **Step 10: Atualizar a memória do projeto**

Atualizar `C:\Users\heito\.claude\projects\c--Projects-ERP-AMAZON\memory\project_mobile_pwa.md` com:
- commit/SHA deployado;
- status da assinatura UDN e da permissão de preço;
- o que falta do lado do usuário (instalar no celular e ativar os avisos nas duas contas).

- [ ] **Step 11: Checklist para o usuário (aparelho real)**

Entregar ao usuário:
1. **iPhone:** Safari → erp.mundofs.cloud → Compartilhar → Adicionar à Tela de Início → abrir pelo ícone → logar na MundoFS → Mais → Notificações deste celular → **Ativar** → **Enviar teste**.
2. Sair escolhendo **Continuar**, logar na UDN, repetir "Ativar".
3. **Android:** Chrome → Mais → Instalar app → mesmos passos.
4. Esperar uma venda com a tela bloqueada: "Nova venda na MundoFS" + valor; tocar abre o pedido.
