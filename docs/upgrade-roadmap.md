# Upgrade roadmap — Atlas Seller

Lista de upgrades de dependências e mudanças significativas que ficam para sprints dedicados. Atualizado em 2026-05-23.

## Vulnerabilidades npm restantes (moderate)

`npm audit` mostra 5 moderates após `audit fix` da sprint atual. Todas fixáveis apenas com breaking changes via `--force` — agendar:

### `postcss` < 8.5.10 (moderate)
- **CVE:** GHSA-qx2v-qp2m-jg93 (XSS via unescaped `</style>` no stringify).
- **Path:** `node_modules/next/node_modules/postcss` (transitivo do Next).
- **Fix oficial:** Next.js já usa postcss recente, mas o lock pegou versão antiga. `npm audit fix --force` regridiria pra Next 9.3.3 (impraticável).
- **Plano:** aguardar próximo bump menor do Next (16.2.7+) que pode trazer postcss novo, ou forçar override no `package.json`:
  ```json
  "overrides": {
    "postcss": "^8.5.10"
  }
  ```
  Testar build antes de mergear.
- **Risco residual:** baixo. Vulnerabilidade afeta processamento de CSS untrusted — no nosso caso só processamos CSS próprio.

### `qs` 6.11.1-6.15.1 (moderate)
- **CVE:** GHSA-q8mj-m7cp-5q26 (DoS em `qs.stringify` com null/undefined em arrays comma-format).
- **Path:** `googleapis → gaxios → ... → qs`.
- **Fix oficial:** depende de bump no `googleapis`. Acompanhar https://github.com/googleapis/google-api-nodejs-client/releases.
- **Risco residual:** baixo. Só chamamos `googleapis` server-side com dados controlados — sem entrada de usuário direto no `qs.stringify`.

### `uuid` < 11.1.1 (moderate) + `exceljs` >= 3.5.0 (depende)
- **CVE:** GHSA-w5hq-g745-h8pq (bounds check em uuid v3/v5/v6 com buffer custom).
- **Path:** `exceljs → uuid`.
- **Fix oficial:** `exceljs@4.x` ainda não saiu. Migrar para `xlsx` é alternativa, mas precisa avaliar feature parity (planilhas com formatação, fórmulas).
- **Mitigação no nosso código:** não usamos UUIDs do `uuid` — só `crypto.randomUUID()` ou `cuid()` do Prisma. Vulnerabilidade não-explorável no nosso path.

### `@anthropic-ai/sdk` 0.79-0.91 (moderate)
- **CVE:** GHSA-p7fg-763f-g4gf (file permissions inseguras no Local Filesystem Memory Tool).
- **Path:** dep direta no nosso `package.json`.
- **Fix:** `npm install @anthropic-ai/sdk@0.98.0` (breaking — API mudou).
- **Risco residual:** muito baixo. Não usamos `Local Filesystem Memory Tool`. Mas atualizar quando puder — bumpamos junto com próxima feature de IA.

### `fast-xml-builder` <= 1.1.6 (high)
- **CVE:** GHSA-5wm8-gmm8-39j9 + GHSA-45c6-75p6-83cc (bypasses em sanitização).
- **Path:** já resolvido com `npm audit fix` em 2026-05-22 (subiu junto com Next 16.2.6). Confirmar `npm ls fast-xml-builder` após próximo `npm install`.

## Bumps maiores futuros

| Pacote | Atual | Latest | Esforço | Quando |
|---|---|---|---|---|
| `next` | 16.2.6 | 16.x semanal | baixo (patch) | rolling, sempre que sair |
| `prisma` | 5.22 | 6.x | médio (algumas mudanças de API) | próxima sprint dedicada |
| `tailwindcss` | 3.4.13 | 4.x | alto (CSS engine novo) | só se precisar de feature do v4 |
| `react` | 18.3 | 19.x | médio (compat com Next 16) | acompanhar guia oficial |
| `zod` | 3.23 | 4.x | médio (alguns breaking) | próxima sprint |
| `bcryptjs` | 3.0 | 3.0 | — | OK |
| `@aws-sdk/client-sqs` | 3.10x | 3.10x | — | bump mensal |

## Dependabot

Habilitar:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
    groups:
      next:
        patterns: ["next", "@next/*", "eslint-config-next"]
      prisma:
        patterns: ["prisma", "@prisma/*"]
      radix:
        patterns: ["@radix-ui/*"]
```

## Outros itens de hardening pendentes

- **Item Q (Pen test externo)** — agendar com fornecedor após Sprint 2 estabilizar (~30 dias após deploy).
- **Item S (rotação de secrets)** — escrever `docs/secrets-rotation.md` cobrindo: `SESSION_SECRET`, `CONFIG_ENCRYPTION_KEY`, `AMAZON_LWA_*`, `OPENAI_API_KEY`, `INTERNAL_HEALTH_TOKEN`, `CRON_SECRET`, `AWS_ACCESS_KEY_ID`/`SECRET`.
- **Item T (dashboard segurança)** — só se houver volume suficiente para justificar. Sino + audit log atual cobre o básico.

## Refinos de CSP

CSP está em `Content-Security-Policy-Report-Only` (item F da Sprint 2). Promover para enforce após 2 semanas sem violações no DevTools. Próximo refinamento: trocar `'unsafe-inline'` em script-src por nonces (requer middleware gerar nonce por request + integrar com Next 16).
