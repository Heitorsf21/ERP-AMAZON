# Content-Security-Policy — Atlas Seller

## Estado atual

CSP em **modo Report-Only** desde 2026-05-23. O header `Content-Security-Policy-Report-Only` é setado pelo middleware em [src/proxy.ts](../src/proxy.ts) (função `withSecurityHeaders`).

Modo Report-Only **não bloqueia nada** — apenas registra violações no console DevTools do navegador. Sem `report-uri` configurado, as violações ficam apenas localmente visíveis.

## Diretivas atuais

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://m.media-amazon.com https://images-na.ssl-images-amazon.com;
font-src 'self' data:;
connect-src 'self';
frame-ancestors 'none';
form-action 'self';
base-uri 'self';
object-src 'none';
```

### Por que `'unsafe-inline'`/`'unsafe-eval'` em script-src

Next.js 16 + React 18 injetam código de hidratação inline no HTML server-rendered. Sem `'unsafe-inline'`, a página quebra em runtime. A solução correta é migrar para nonces, mas isso requer:

1. Gerar `nonce` por request no middleware
2. Aplicar `nonce` em todos os `<script>` inline gerados pelo Next (suporte experimental em `next/script`)
3. Trocar `'unsafe-inline'` por `'nonce-{value}'`

Este é um esforço de ~1-2 dias e fica para uma sprint dedicada. Por enquanto, `'unsafe-inline'` é o trade-off.

## Roadmap de promoção para enforce

### Fase 1 — Observação (atual)
- **Duração:** mínimo 2 semanas após deploy.
- **Ação:** monitorar DevTools Console em todas as páginas críticas (`/login`, `/dashboard-ecommerce`, `/produtos`, `/vendas`, `/contas-a-pagar`, `/contas-a-receber`, `/configuracoes`, `/perfil`).
- **Sinal de pronto:** nenhuma violação reportada por 7 dias úteis consecutivos com tráfego normal.

### Fase 2 — Enforce
1. Trocar o nome do header em `withSecurityHeaders`:
   ```ts
   headers.set("Content-Security-Policy", CSP_REPORT_ONLY);  // (renomear const também)
   ```
2. Manter um header `Content-Security-Policy-Report-Only` extra com versão MAIS restrita (sem `'unsafe-*'`) durante a próxima fase de migração para nonces.
3. Deploy em janela de baixo tráfego; reverter imediatamente se houver quebra.

### Fase 3 — Nonces (futuro)
- Implementar `nonce` gerado no middleware via `randomBytes(16)`.
- Aplicar em `<Script>` e nos scripts inline do Next via wrappers.
- Trocar `'unsafe-inline'` por `'nonce-XXX'` nas diretivas.

## Allowlist de origens externas

Manter atualizado conforme novas dependências:

| Origem | Onde aparece | Diretiva |
|---|---|---|
| `m.media-amazon.com` | Thumbnails de produtos | `img-src` |
| `images-na.ssl-images-amazon.com` | Thumbnails alternativos | `img-src` |

Se adicionar Sentry, Google Analytics, ou qualquer SDK externo, **atualizar CSP ANTES de deploy** ou os scripts serão bloqueados em enforce.

## Como verificar violações

1. Abrir DevTools (F12) → Console
2. Filtrar por "Content Security Policy" ou "CSP"
3. Cada violação aparece como:
   ```
   [Report Only] Refused to execute inline script ... because it violates CSP directive ...
   ```

Anotar em `docs/csp-violations.md` (criar quando aparecer) para discussão de relaxamento ou refactor.

## Referências
- [MDN — Content-Security-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy)
- [Next.js CSP docs](https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy)
