# UI Cliente Final — mapa de abas e simplificação (2026-07-01)

## Contexto

O sistema nasceu como ERP interno e carrega telas de desenvolvimento/operação
que não fazem sentido para o cliente final do SaaS (Atlas Seller). No modelo
multi-tenant o ADMIN do tenant **é o cliente** — o gate por role do proxy não
separa "dono da plataforma" de "cliente"; a separação real é a camada
`/plataforma` (PlataformaUsuario). Portanto, esconder = remover da UI tenant.

**Princípio (pedido do usuário):** nada de lógica de negócio muda; nenhum dado
deixa de ser coletado. Some apenas a superfície visual de dev/ops.

## Mapa de abas — cliente final

| Aba (sidebar) | Veredito | Motivo |
|---|---|---|
| Home | ✅ mantém | central do dia a dia |
| Financeiro (Agenda, Dash Financeiro, Caixa, Contas a Pagar/Receber, Notas Fiscais, Destinação, DRE) | ✅ mantém | núcleo do produto |
| E-commerce (Dashboard, Produtos, Vendas, Compras, Avaliações, Publicidade) | ✅ mantém | núcleo do produto |
| **Conector Amazon** (`/amazon`) | ❌ remove | painel de sync manual (dev). Workers já automatizam tudo; conexão vira botão OAuth em Configurações → Integrações |
| **Saúde do Sistema** (`/sistema`) | ❌ remove | worker/fila/quotas/db = ops da plataforma. Dados (AmazonSyncLog, AmazonApiQuota, heartbeat) continuam sendo coletados; some só a UI |
| Meu Perfil | ✅ mantém | senha/conta do usuário |
| Configurações | ✅ mantém (enxuta) | ver abaixo |

## Configurações — antes → depois

| Aba | Antes | Depois |
|---|---|---|
| Sistema | Aparência (tema) + Imposto + Assinatura + card Sistema (GIT_SHA/fuso/LOG_LEVEL) | **"Geral"**: Imposto (compacto) + Assinatura. Tema migra para o botão do rodapé da sidebar (menu Sistema/Claro/Escuro). Card Sistema removido (info de dev) |
| Integrações | Amazon (form manual de credenciais LWA) + Ads (OAuth + form manual) + Gmail + Drive ("Em breve") + WhatsApp | Amazon = **card OAuth**: status + "Conectar com a Amazon" (→ `/api/amazon/oauth/iniciar`) + Desconectar. Ads mantém OAuth; form manual e instruções de credenciais **só aparecem para a empresa da plataforma** (`modoManualPermitido`, gate já existente). Gmail e WhatsApp mantêm. Drive (placeholder "Em breve") sai da página |
| Notificações | preferências do sino | inalterada |

## Decisões

1. **Mecanismo de ocultação = remoção da UI tenant** (páginas/itens de nav/cards).
   Endpoints, jobs, worker e dados ficam 100% intactos (`/api/amazon/*`,
   `/api/sistema/*`, POST `/api/amazon/config` para scripts). Precedente: abas
   Genius Pro/Expedição.
2. **Conexão Amazon em 1 clique**: fluxo OAuth F02 já existe (iniciar/callback/
   desconectar + `AmazonAccount` por empresa). A UI nova só consome. GET
   `/api/amazon/config` passa a devolver `conta` (espelho exato do que
   `/api/amazon/ads/config` já faz) para o card mostrar Conectado/Erro/datas.
3. **Redirects dos callbacks OAuth** (SP-API e Ads) apontavam para `/amazon?...`;
   passam a apontar para `/configuracoes?tab=integracoes&...`, e a página de
   Configurações lê `?tab=` + resultado e mostra toast (padrão Suspense +
   `useSearchParams` já usado pela GmailSection).
4. **Tema**: `ThemeToggle` do rodapé da sidebar (já existia) vira menu com
   Sistema/Claro/Escuro — nada se perde ao remover o card Aparência.
5. **Imposto compacto**: card slim de 1 linha de controles; some o hint de
   `npx tsx scripts/...` (dev-speak) da UI e do toast. Endpoint e regra intactos.
6. **Home/Command palette**: links órfãos de `/amazon` e `/sistema` re-apontados
   para `/configuracoes?tab=integracoes`; ações admin do palette (sync manual de
   pedidos/settlement, saúde do sistema) removidas — navegação de páginas segue
   `nav-routes` automaticamente.
7. **Sem commit automático**: working tree tem WIP de outras frentes (billing
   Stripe); as mudanças ficam no working tree para revisão.

## Fora de escopo (follow-ups sugeridos)

- Campos WAHA (url/api key) na seção WhatsApp são infra da plataforma — mover
  para config de plataforma quando existir; hoje escondê-los quebraria o setup.
- Setup de credenciais do Gmail (clientId/secret) tem o mesmo perfil; avaliar
  gate igual ao `modoManualPermitido` do Ads.
- APIs admin (`/api/sistema/db-stats` etc.) continuam acessíveis por URL para
  ADMIN do tenant; avaliar movê-las para a camada plataforma no workstream de
  segurança multi-tenant.
- `atalhos.tsx` e `amazon-status-card.tsx` (home) são legado/deprecated; só o
  link foi re-apontado, remoção fica para limpeza futura.
