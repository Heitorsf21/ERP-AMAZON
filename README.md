# ERP AMAZON — Sistema Interno de Gestão

Sistema interno da empresa — caixa, contas a pagar, estoque, compras. Construído do zero, separado do projeto `WORKSPACE AMAZON/AMAZON PRINCIPAL` (que coleta relatórios da Amazon).

## Status atual

**MVP em construção — Fase F0 (Fundação).**

O MVP do ERP cobre apenas a **parte financeira**:

1. **F0 — Fundação** (atual): setup de stack, layout, banco.
2. **F1 — Caixa**: movimentações (entrada/saída), ajuste com motivo, importador CSV/XLSX, saldo atual.
3. **F2 — Contas a Pagar**: CRUD + pagamento gera saída automática no caixa, importador.
4. **F3 — Saldo comprometido + Projeção 7/15/30d**: encerra o MVP.

Estoque, Compras e integração Amazon vêm **depois** do MVP validado com dados reais.

Plano autoritativo em `C:/Users/heito/.claude/plans/valiant-discovering-waffle.md`.

## Stack

- Node 20+, TypeScript, Next.js 16 (App Router)
- Tailwind + shadcn/ui + Radix
- Prisma + SQLite (dev/MVP) — migrável para Postgres sem mudança de código
- Zod + react-hook-form
- TanStack Query, Recharts
- pino (logs), Vitest (testes), date-fns / date-fns-tz

## Como rodar (local)

```bash
# 1. Instalar dependências
npm install

# 2. Gerar o cliente Prisma e criar o SQLite local
npm run prisma:generate
npm run prisma:push

# 3. Popular com categorias padrão e 1 fornecedor exemplo
npm run db:seed

# 4. Subir o app
npm run dev
```

App disponível em http://localhost:3000.

## Scripts

| Script | Função |
|---|---|
| `npm run dev` | Next.js em dev |
| `npm run build` | Build de produção |
| `npm run start` | Rodar build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest uma vez |
| `npm run test:watch` | Vitest em watch |
| `npm run prisma:studio` | UI do Prisma para inspecionar dados |
| `npm run db:seed` | Popula categorias e fornecedor exemplo |

## Estrutura

```
src/
├── app/                 # Next.js App Router (páginas + API routes)
├── modules/             # Núcleo de domínio (feature-sliced)
│   ├── financeiro/      # Caixa
│   ├── contas-a-pagar/
│   ├── documentos-financeiros/ # Dossiês de boletos/NFs
│   └── shared/          # Fornecedor, Categoria
├── integrations/
│   └── amazon/          # Contrato do conector Amazon (vazio no MVP)
├── components/          # UI reutilizável
└── lib/                 # db, logger, money, date, utils
```

## Convenções

- **Dinheiro em centavos (Int)** no banco; conversão só na UI via `lib/money.ts`.
- **Ajuste de saldo** = `Movimentacao` com `origem=AJUSTE` e `motivoAjuste` obrigatório.
- **SKU** (quando módulo Estoque entrar) é identificador mestre de produto.
- **Fuso** padrão: `America/Sao_Paulo`.

## Relação com o projeto Amazon antigo

O projeto `WORKSPACE AMAZON/AMAZON PRINCIPAL` permanece **independente**. A integração acontecerá em fase pós-MVP via `src/integrations/amazon/` — primeiro por importação CSV manual, depois por adapter do projeto antigo.
