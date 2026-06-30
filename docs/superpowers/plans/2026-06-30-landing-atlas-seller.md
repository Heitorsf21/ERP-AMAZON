# Landing Atlas Seller — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir e preparar o deploy de uma landing page estática do Atlas Seller que satisfaça as Website Guidelines da Amazon e destrave a aprovação do role Brand Analytics (caso `20883425301`).

**Architecture:** Conjunto de arquivos estáticos autocontidos (HTML + CSS próprio + JS mínimo), sem build e sem dependência de CDN externo crítico, servido por Nginx num subdomínio dedicado da VPS Hostinger com Let's Encrypt. Desacoplado do app Next do ERP para garantir o requisito "accessible at all times".

**Tech Stack:** HTML5 semântico, CSS3 (custom properties, sem framework), JavaScript vanilla (progressive enhancement), fonte Inter self-hosted (woff2), Nginx, Certbot/Let's Encrypt. Verificação: `npx html-validate`, grep de requisitos, conferência visual no navegador.

## Global Constraints

- **Sem claims proibidos:** nunca usar "#1", "melhor", "o único", "número 1" ou superlativos não verificáveis em nenhuma copy. (Website Guidelines.)
- **Sem dependência de CDN externo crítico:** CSS, JS e fontes servidos localmente. Nada que derrube a página se um terceiro cair.
- **Acessível sem autenticação:** nenhuma seção atrás de login; sem "under construction"/lorem ipsum/placeholder visível em produção.
- **Nome com marca:** sempre "Atlas Seller" (nunca termo genérico isolado); razão social "MundoFS" visível no footer.
- **Idioma do site:** Português (pt-BR), com acentuação correta e completa.
- **Pricing exato:** Starter **R$ 89,99/mês** · Pro **R$ 159,99/mês** · Scale **R$ 219,99/mês** (mensais, em R$, sem asteriscos escondidos).
- **Paleta (Modelo 1 — Sutil):** fundo `#F8FAFC`/superfície `#FFFFFF`; texto `#0F172A`/secundário `#475569`/mudo `#94A3B8`; primária azul `#2563EB` (hover `#1D4ED8`); sucesso `#10B981`/`#059669`; acento Amazon `#FF9900` + texto laranja `#EA580C`; bordas `#E2E8F0`.
- **Tipografia:** Inter self-hosted (400/600/700/800), fallback `system-ui, -apple-system, Segoe UI, Roboto, sans-serif`.
- **Diretório raiz da entrega:** `landing-atlas/` na raiz do repo.
- **Branch:** `feat/landing-atlas-seller` (já criada).
- **Commits frequentes:** um commit ao final de cada task.

---

## File Structure

```
landing-atlas/
├── index.html          # landing principal (nav, hero, 01..05, FAQ, CTA, footer)
├── privacidade.html    # Política de Privacidade (LGPD + Amazon DPP)
├── termos.html         # Termos de Uso
├── styles.css          # design system + todas as seções
├── app.js              # menu mobile + smooth scroll + FAQ accordion
└── assets/
    ├── fonts/          # Inter-{Regular,SemiBold,Bold,ExtraBold}.woff2
    ├── img/            # atlas-symbol.png, logo-mundofs.png, favicon, screenshots/
    └── ...
deploy/
└── landing-atlas-nginx.conf   # vhost Nginx do subdominio
docs/
└── amazon-case-20883425301-reply.md   # rascunho da resposta ao caso
```

Responsabilidades: `styles.css` concentra tokens + componentes (um arquivo, ordem por seção). `app.js` só comportamento progressivo. Cada `.html` é uma página independente; o header/footer são repetidos entre páginas (estático, sem template engine) — manter sincronizados.

---

### Task 1: Scaffold + assets + fontes Inter

**Files:**
- Create: `landing-atlas/assets/img/.gitkeep`
- Create: `landing-atlas/assets/fonts/` (woff2 baixados)
- Copy: `public/atlas-symbol.png` → `landing-atlas/assets/img/atlas-symbol.png`
- Copy: `public/logo-mundofs.png` → `landing-atlas/assets/img/logo-mundofs.png`

**Interfaces:**
- Produces: estrutura de pastas e assets que as Tasks 2-8 referenciam por caminho relativo (`assets/img/...`, `assets/fonts/...`).

- [ ] **Step 1: Criar estrutura de pastas e copiar logos**

```bash
cd "C:/Projects/ERP-AMAZON"
mkdir -p landing-atlas/assets/img/screenshots landing-atlas/assets/fonts
cp public/atlas-symbol.png landing-atlas/assets/img/atlas-symbol.png
cp public/logo-mundofs.png landing-atlas/assets/img/logo-mundofs.png
touch landing-atlas/assets/img/screenshots/.gitkeep
```

- [ ] **Step 2: Baixar Inter woff2 (one-time, fica self-hosted)**

```bash
cd "C:/Projects/ERP-AMAZON/landing-atlas/assets/fonts"
curl -L -o Inter-Regular.woff2   "https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-400-normal.woff2"
curl -L -o Inter-SemiBold.woff2  "https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-600-normal.woff2"
curl -L -o Inter-Bold.woff2      "https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-700-normal.woff2"
curl -L -o Inter-ExtraBold.woff2 "https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-800-normal.woff2"
```

- [ ] **Step 3: Verificar que os arquivos existem e têm tamanho > 0**

Run:
```bash
ls -l "C:/Projects/ERP-AMAZON/landing-atlas/assets/fonts"
```
Expected: 4 arquivos `.woff2`, cada um com tamanho > 10 KB. Se algum vier 0 bytes (CDN mudou o caminho), buscar a URL atual do Inter no Fontsource e refazer. **Não prosseguir com fonte ausente** — o fallback `system-ui` mantém o site funcional, mas Inter é parte do design system.

- [ ] **Step 4: Commit**

```bash
cd "C:/Projects/ERP-AMAZON"
git add landing-atlas/assets
git commit -m "chore(landing): scaffold de assets e fontes Inter self-hosted"
```

---

### Task 2: Design system (styles.css) + Nav + Hero

**Files:**
- Create: `landing-atlas/styles.css`
- Create: `landing-atlas/index.html`
- Create: `landing-atlas/app.js`

**Interfaces:**
- Produces:
  - Classes utilitárias e de componentes em `styles.css`: `.container`, `.btn`, `.btn-primary`, `.btn-outline`, `.badge-pill`, `.section`, `.eyebrow`, `.site-header`, `.hero`, `.dash-card`, `.kpi`. As Tasks 3-8 reutilizam essas classes.
  - `index.html` com `<header class="site-header">` e `<section class="hero">` — Tasks 3-6 inserem as seções seguintes ANTES do `<footer>` (placeholder na Task 2, conteúdo na Task 6).
  - `app.js` com `initMobileMenu()`, `initSmoothScroll()`, `initFaqAccordion()` (esta última só ativa quando o FAQ existir — Task 6).

- [ ] **Step 1: Escrever `styles.css` (tokens + base + nav + hero + botões)**

```css
/* ===== Design tokens (Modelo 1 — Sutil) ===== */
:root{
  --bg:#F8FAFC; --surface:#FFFFFF;
  --text:#0F172A; --text-2:#475569; --muted:#94A3B8;
  --primary:#2563EB; --primary-700:#1D4ED8;
  --success:#10B981; --success-700:#059669;
  --amazon:#FF9900; --amazon-700:#EA580C;
  --border:#E2E8F0;
  --radius:12px; --radius-sm:8px; --radius-pill:99px;
  --shadow-card:0 10px 30px -12px rgba(15,23,42,.18);
  --maxw:1120px;
}
/* ===== Inter self-hosted ===== */
@font-face{font-family:Inter;font-weight:400;font-display:swap;src:url('assets/fonts/Inter-Regular.woff2') format('woff2')}
@font-face{font-family:Inter;font-weight:600;font-display:swap;src:url('assets/fonts/Inter-SemiBold.woff2') format('woff2')}
@font-face{font-family:Inter;font-weight:700;font-display:swap;src:url('assets/fonts/Inter-Bold.woff2') format('woff2')}
@font-face{font-family:Inter;font-weight:800;font-display:swap;src:url('assets/fonts/Inter-ExtraBold.woff2') format('woff2')}
/* ===== Reset enxuto ===== */
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  background:var(--bg);color:var(--text);line-height:1.55;-webkit-font-smoothing:antialiased}
img{max-width:100%;display:block}
a{color:inherit;text-decoration:none}
h1,h2,h3{line-height:1.15;margin:0 0 .4em;font-weight:800;letter-spacing:-.01em}
p{margin:0 0 1em;color:var(--text-2)}
.container{max-width:var(--maxw);margin:0 auto;padding:0 24px}
.section{padding:80px 0}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.5px;
  font-weight:700;color:var(--amazon-700);background:#FFF7ED;border:1px solid #FED7AA;
  padding:5px 11px;border-radius:var(--radius-pill);text-transform:uppercase}
.eyebrow .dot{width:6px;height:6px;border-radius:var(--radius-pill);background:var(--amazon)}
/* ===== Buttons ===== */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;
  font-weight:700;font-size:15px;padding:12px 22px;border-radius:var(--radius-sm);
  cursor:pointer;border:1px solid transparent;transition:.15s ease}
.btn-primary{background:var(--primary);color:#fff}
.btn-primary:hover{background:var(--primary-700)}
.btn-outline{background:var(--surface);color:var(--text);border-color:var(--border)}
.btn-outline:hover{border-color:var(--muted)}
/* ===== Header / Nav ===== */
.site-header{position:sticky;top:0;z-index:50;background:rgba(248,250,252,.85);
  backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
.nav{display:flex;align-items:center;justify-content:space-between;height:68px}
.brand{display:flex;align-items:center;gap:9px;font-weight:800;font-size:18px}
.brand .sym{width:26px;height:26px;border-radius:7px;
  background:linear-gradient(135deg,var(--primary),var(--success))}
.brand .accent{color:var(--primary)}
.nav-links{display:flex;align-items:center;gap:26px}
.nav-links a{font-size:14px;color:var(--text-2);font-weight:600}
.nav-links a:hover{color:var(--text)}
.nav-toggle{display:none;background:none;border:0;cursor:pointer;padding:8px}
.nav-toggle span{display:block;width:22px;height:2px;background:var(--text);margin:4px 0}
/* ===== Hero ===== */
.hero{padding:72px 0 56px}
.hero-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:48px;align-items:center}
.hero h1{font-size:48px}
.hero .underline{position:relative;color:var(--primary);white-space:nowrap}
.hero .underline svg{position:absolute;left:0;bottom:-9px;width:100%}
.hero .lead{font-size:18px;max-width:34ch;margin-bottom:26px}
.hero-cta{display:flex;gap:12px;flex-wrap:wrap}
/* ===== Dashboard card (hero + features) ===== */
.dash-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:20px;box-shadow:var(--shadow-card)}
.dash-head{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:10px}
.dash-value{font-size:28px;font-weight:800;margin-bottom:16px}
.dash-bars{display:flex;align-items:flex-end;gap:7px;height:72px}
.dash-bars i{flex:1;border-radius:4px;display:block}
.dash-kpis{display:flex;gap:10px;margin-top:16px}
.kpi{flex:1;background:#F1F5F9;border-radius:var(--radius-sm);padding:10px}
.kpi .l{font-size:11px;color:var(--muted)}
.kpi .v{font-size:15px;font-weight:700}
/* ===== Responsive ===== */
@media(max-width:860px){
  .hero-grid{grid-template-columns:1fr;gap:32px}
  .hero h1{font-size:36px}
  .nav-links{position:fixed;inset:68px 0 auto 0;flex-direction:column;gap:0;
    background:var(--surface);border-bottom:1px solid var(--border);padding:8px 0;display:none}
  .nav-links.open{display:flex}
  .nav-links a{padding:14px 24px;width:100%}
  .nav-toggle{display:block}
  .section{padding:56px 0}
}
```

- [ ] **Step 2: Escrever `app.js`**

```javascript
function initMobileMenu(){
  const t=document.querySelector('.nav-toggle');
  const l=document.querySelector('.nav-links');
  if(!t||!l)return;
  t.addEventListener('click',()=>l.classList.toggle('open'));
  l.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>l.classList.remove('open')));
}
function initSmoothScroll(){
  document.querySelectorAll('a[href^="#"]').forEach(a=>{
    a.addEventListener('click',e=>{
      const el=document.querySelector(a.getAttribute('href'));
      if(el){e.preventDefault();el.scrollIntoView({behavior:'smooth'})}
    });
  });
}
function initFaqAccordion(){
  document.querySelectorAll('.faq-item').forEach(item=>{
    const q=item.querySelector('.faq-q');
    if(q)q.addEventListener('click',()=>item.classList.toggle('open'));
  });
}
document.addEventListener('DOMContentLoaded',()=>{
  initMobileMenu();initSmoothScroll();initFaqAccordion();
});
```

- [ ] **Step 3: Escrever `index.html` (head + header + hero + footer placeholder)**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Atlas Seller — Gestão e analytics para quem vende na Amazon</title>
  <meta name="description" content="Atlas Seller: plataforma de gestão e analytics para vendedores Amazon. Lucratividade real por venda, métricas de tráfego e conversão, otimização de Ads e controle financeiro.">
  <link rel="icon" href="assets/img/atlas-symbol.png">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="site-header">
    <div class="container nav">
      <a class="brand" href="#topo"><span class="sym"></span>Atlas <span class="accent">Seller</span></a>
      <button type="button" class="nav-toggle" aria-label="Abrir menu"><span></span><span></span><span></span></button>
      <nav class="nav-links">
        <a href="#recursos">Recursos</a>
        <a href="#analytics">Analytics</a>
        <a href="#seguranca">Segurança</a>
        <a href="#precos">Preços</a>
        <a class="btn btn-primary" href="#contato">Agendar demo</a>
      </nav>
    </div>
  </header>

  <main id="topo">
    <section class="hero">
      <div class="container hero-grid">
        <div>
          <span class="eyebrow"><span class="dot"></span>Feito para sellers Amazon</span>
          <h1>Decisões com o <span class="underline">lucro na mão<svg viewBox="0 0 200 12" preserveAspectRatio="none"><path d="M3 8 Q100 1 197 8" stroke="#FF9900" stroke-width="4" fill="none" stroke-linecap="round"/></svg></span>.</h1>
          <p class="lead">Conecte sua conta Amazon e veja vendas, taxas, Ads e margem reais — tudo em um painel só.</p>
          <div class="hero-cta">
            <a class="btn btn-primary" href="#contato">Começar agora</a>
            <a class="btn btn-outline" href="#recursos">Ver recursos</a>
          </div>
        </div>
        <div class="dash-card" aria-hidden="true">
          <div class="dash-head"><span>Faturamento · últimos 30 dias</span><span style="color:var(--success)">+18%</span></div>
          <div class="dash-value">R$ 248.910</div>
          <div class="dash-bars">
            <i style="height:40%;background:#BFDBFE"></i><i style="height:60%;background:#93C5FD"></i>
            <i style="height:45%;background:#6EE7B7"></i><i style="height:80%;background:#34D399"></i>
            <i style="height:65%;background:#10B981"></i><i style="height:100%;background:#059669"></i>
          </div>
          <div class="dash-kpis">
            <div class="kpi"><div class="l">Margem</div><div class="v" style="color:var(--success-700)">23,4%</div></div>
            <div class="kpi"><div class="l">ACOS</div><div class="v" style="color:var(--amazon-700)">14,1%</div></div>
            <div class="kpi"><div class="l">Buy Box</div><div class="v">92%</div></div>
          </div>
        </div>
      </div>
    </section>

    <!-- SEÇÕES 01..05 + FAQ + CTA entram aqui (Tasks 3-6) -->

  </main>

  <!-- FOOTER entra na Task 6 -->

  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 4: Criar config do validador e verificar HTML válido + abrir no navegador**

Primeiro criar `landing-atlas/.htmlvalidate.json` (sem config, o `html-validate` não aplica regras). O profile `recommended` NÃO inclui `no-inline-style`, então os estilos inline usados nos mockups são aceitos:

```json
{
  "extends": ["html-validate:recommended"],
  "rules": {
    "no-trailing-whitespace": "off"
  }
}
```

Run:
```bash
cd "C:/Projects/ERP-AMAZON/landing-atlas" && npx --yes html-validate index.html
```
Expected: `0 errors`. (Se acusar erro de `<svg>` sem `xmlns`, adicionar `xmlns="http://www.w3.org/2000/svg"` no svg. Se acusar `prefer-button-type`, garantir `type="button"` em todos os `<button>`.)

Abrir visualmente:
```bash
start "" "C:/Projects/ERP-AMAZON/landing-atlas/index.html"
```
Expected: hero clean light, headline "Decisões com o lucro na mão" com traço laranja, badge "Feito para sellers Amazon", botão azul, card de dashboard à direita. Menu vira hambúrguer abaixo de 860px.

- [ ] **Step 5: Commit**

```bash
cd "C:/Projects/ERP-AMAZON"
git add landing-atlas/styles.css landing-atlas/app.js landing-atlas/index.html landing-atlas/.htmlvalidate.json
git commit -m "feat(landing): design system, nav e hero (Modelo 1)"
```

---

### Task 3: Seções 01 Problema + 02 Como funciona

**Files:**
- Modify: `landing-atlas/index.html` (inserir após o comentário "SEÇÕES 01..05")
- Modify: `landing-atlas/styles.css` (append componentes desta task)

**Interfaces:**
- Consumes: `.section`, `.container`, `.eyebrow`, `.dash-card` (Task 2).
- Produces: classes `.problemas`, `.problema`, `.passos`, `.passo` reutilizáveis.

- [ ] **Step 1: Append CSS das seções 01/02 em `styles.css`**

```css
/* ===== 01 Problema ===== */
.sec-head{max-width:60ch;margin-bottom:40px}
.sec-head h2{font-size:32px}
.sec-head p{font-size:17px}
.problemas{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.problema{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px}
.problema h3{font-size:18px}
.problema p{margin:0;font-size:14px}
.problema .ic{width:40px;height:40px;border-radius:10px;background:#FFF7ED;color:var(--amazon-700);
  display:flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:14px}
/* ===== 02 Como funciona ===== */
.passos{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;counter-reset:p}
.passo{position:relative;padding-top:8px}
.passo::before{counter-increment:p;content:counter(p,decimal-leading-zero);
  font-size:13px;font-weight:800;color:var(--primary);display:block;margin-bottom:8px}
.passo h3{font-size:17px}
.passo p{font-size:14px;margin:0}
@media(max-width:860px){.problemas,.passos{grid-template-columns:1fr}}
```

- [ ] **Step 2: Inserir HTML das seções 01 e 02 em `index.html`**

```html
    <section class="section" id="problema" style="background:var(--surface);border-top:1px solid var(--border);border-bottom:1px solid var(--border)">
      <div class="container">
        <div class="sec-head">
          <span class="eyebrow"><span class="dot"></span>O desafio de vender na Amazon</span>
          <h2>Vender é fácil. Saber se deu lucro é o problema.</h2>
          <p>Entre comissão, FBA, parcelamento, frete e imposto, o resultado real de cada venda se perde — e a decisão vira chute.</p>
        </div>
        <div class="problemas">
          <div class="problema"><div class="ic">%</div><h3>Lucro real obscuro</h3><p>Você fatura, mas não sabe a margem de cada SKU depois de todas as taxas da Amazon.</p></div>
          <div class="problema"><div class="ic">★</div><h3>Taxas e FBA confusos</h3><p>Comissão, tarifa FBA, parcelamento e devoluções espalhados em relatórios difíceis de conciliar.</p></div>
          <div class="problema"><div class="ic">▦</div><h3>Estoque e Ads no escuro</h3><p>Ruptura que derruba o Buy Box e campanhas gastando sem leitura clara de ACOS e retorno.</p></div>
        </div>
      </div>
    </section>

    <section class="section" id="como-funciona">
      <div class="container">
        <div class="sec-head">
          <span class="eyebrow"><span class="dot"></span>Como funciona</span>
          <h2>Conectou, sincronizou, decidiu.</h2>
          <p>O Atlas Seller se conecta à sua conta Amazon de forma segura e transforma os dados brutos em decisões.</p>
        </div>
        <div class="passos">
          <div class="passo"><h3>Conecte sua conta</h3><p>Autorização oficial via SP-API (OAuth). Você nunca compartilha sua senha da Amazon com o Atlas Seller.</p></div>
          <div class="passo"><h3>Sincronização automática</h3><p>Pedidos, finanças, settlements, inventário e métricas de tráfego entram e se atualizam sozinhos.</p></div>
          <div class="passo"><h3>Decida com dados</h3><p>Dashboards de lucratividade, analytics de marketplace e otimização de Ads — prontos para agir.</p></div>
        </div>
      </div>
    </section>
```

- [ ] **Step 3: Validar e conferir**

Run:
```bash
cd "C:/Projects/ERP-AMAZON/landing-atlas" && npx --yes html-validate index.html
```
Expected: `0 errors`. Recarregar no navegador: duas seções novas, grids de 3 colunas que viram 1 coluna no mobile.

- [ ] **Step 4: Commit**

```bash
cd "C:/Projects/ERP-AMAZON"
git add landing-atlas/index.html landing-atlas/styles.css
git commit -m "feat(landing): secoes Problema e Como funciona"
```

---

### Task 4: Seção 03 Recursos + bloco Marketplace Analytics (CRÍTICO p/ Brand Analytics)

**Files:**
- Modify: `landing-atlas/index.html`
- Modify: `landing-atlas/styles.css`

**Interfaces:**
- Consumes: `.section`, `.container`, `.eyebrow`, `.sec-head` (Tasks 2-3).
- Produces: classes `.analytics-block`, `.feat-grid`, `.feat`. Ancoras `#recursos` e `#analytics` (referenciadas pela nav da Task 2).

**Requisito Amazon 4:** esta task descreve as features e DEVE conter, nominalmente, "Marketplace Analytics", "Brand Analytics", "tráfego", "taxa de conversão" e "Buy Box" — é o que casa o site com o role pedido.

- [ ] **Step 1: Append CSS de Recursos em `styles.css`**

```css
/* ===== 03 Recursos ===== */
.analytics-block{background:linear-gradient(180deg,#fff, #F8FAFC);border:1px solid var(--border);
  border-radius:16px;padding:32px;display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:center;margin-bottom:28px}
.analytics-block .tag{display:inline-block;font-size:12px;font-weight:700;color:var(--primary);
  background:#EFF6FF;border:1px solid #BFDBFE;padding:4px 10px;border-radius:var(--radius-pill);margin-bottom:12px}
.analytics-block h3{font-size:24px}
.analytics-list{list-style:none;padding:0;margin:0}
.analytics-list li{display:flex;gap:10px;align-items:flex-start;font-size:14px;color:var(--text-2);margin-bottom:10px}
.analytics-list li::before{content:"✓";color:var(--success-700);font-weight:800;flex:none}
.feat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.feat{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:22px}
.feat h4{font-size:16px;margin:0 0 6px}
.feat p{font-size:13px;margin:0}
.feat .ic{width:36px;height:36px;border-radius:9px;background:#EFF6FF;color:var(--primary);
  display:flex;align-items:center;justify-content:center;margin-bottom:12px;font-weight:800}
@media(max-width:860px){.analytics-block{grid-template-columns:1fr}.feat-grid{grid-template-columns:1fr}}
```

- [ ] **Step 2: Inserir HTML da seção Recursos em `index.html`**

```html
    <section class="section" id="recursos" style="background:var(--surface);border-top:1px solid var(--border)">
      <div class="container">
        <div class="sec-head">
          <span class="eyebrow"><span class="dot"></span>Recursos</span>
          <h2>Tudo da sua operação Amazon, em um lugar.</h2>
          <p>Da venda ao caixa: lucratividade, analytics de marketplace, publicidade, estoque e financeiro.</p>
        </div>

        <!-- BLOCO MARKETPLACE ANALYTICS (Brand Analytics) -->
        <div class="analytics-block" id="analytics">
          <div>
            <span class="tag">Marketplace Analytics · Brand Analytics</span>
            <h3>Entenda como seus clientes descobrem e compram.</h3>
            <p>Métricas de tráfego e conversão da Amazon, por SKU e por dia, que mostram a saúde real dos seus anúncios — além das vendas.</p>
          </div>
          <ul class="analytics-list">
            <li>Sessões e page views por produto, ao longo do tempo</li>
            <li>Taxa de conversão por sessão (unit session %)</li>
            <li>Percentual de Buy Box e perda de Buy Box</li>
            <li>Insights de comportamento: como os clientes encontram e compram seus produtos</li>
            <li>Séries diárias de vendas e tráfego para leitura de tendência</li>
          </ul>
        </div>

        <!-- DEMAIS FEATURES -->
        <div class="feat-grid">
          <div class="feat"><div class="ic">$</div><h4>Lucratividade real por venda</h4><p>Comissão, FBA, parcelamento, frete, imposto, custo e margem reais — conciliados via SP-API Finance.</p></div>
          <div class="feat"><div class="ic">◎</div><h4>Otimizador de Ads</h4><p>ACOS, ROAS, CTR e CPC com recomendações de lance e de palavras a negativar.</p></div>
          <div class="feat"><div class="ic">▣</div><h4>Monitor de Buy Box</h4><p>Acompanhamento de posse e perda da Buy Box para reagir rápido a concorrência.</p></div>
          <div class="feat"><div class="ic">▤</div><h4>Gestão financeira</h4><p>DRE, contas a pagar e a receber e conciliação bancária da operação.</p></div>
          <div class="feat"><div class="ic">▥</div><h4>Controle de estoque</h4><p>Cobertura em dias de venda e alerta de ruptura, com resumo diário no WhatsApp.</p></div>
          <div class="feat"><div class="ic">⌗</div><h4>Custo por nota fiscal</h4><p>Custo real por peça com rateio de frete e impostos e custo médio ponderado.</p></div>
        </div>
      </div>
    </section>
```

- [ ] **Step 3: Validar + conferir presença dos termos do Brand Analytics**

Run (HTML válido):
```bash
cd "C:/Projects/ERP-AMAZON/landing-atlas" && npx --yes html-validate index.html
```
Expected: `0 errors`.

Run (requisito Brand Analytics presente):
```bash
cd "C:/Projects/ERP-AMAZON/landing-atlas" && grep -Eo "Marketplace Analytics|Brand Analytics|tráfego|conversão por sessão|Buy Box" index.html | sort -u
```
Expected: lista contendo `Brand Analytics`, `Buy Box`, `Marketplace Analytics`, `conversão por sessão`, `tráfego`. Se faltar algum, o site reprova — adicionar.

- [ ] **Step 4: Commit**

```bash
cd "C:/Projects/ERP-AMAZON"
git add landing-atlas/index.html landing-atlas/styles.css
git commit -m "feat(landing): secao Recursos com bloco Marketplace Analytics (Brand Analytics)"
```

---

### Task 5: Seção 04 Segurança & Privacidade + 05 Preços

**Files:**
- Modify: `landing-atlas/index.html`
- Modify: `landing-atlas/styles.css`

**Interfaces:**
- Consumes: `.section`, `.container`, `.eyebrow`, `.btn` (Tasks 2-3).
- Produces: classes `.trust-grid`, `.trust`, `.plans`, `.plan`, `.plan.featured`, `.price`. Ancoras `#seguranca` e `#precos` (nav da Task 2).

**Requisito Amazon 5 e 6 (parcial):** pricing visível com 3 planos; bloco de segurança/privacidade com link para `privacidade.html` (criada na Task 7).

- [ ] **Step 1: Append CSS de Segurança e Preços em `styles.css`**

```css
/* ===== 04 Segurança ===== */
.trust-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:8px}
.trust{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px}
.trust h4{font-size:15px;margin:0 0 6px}
.trust p{font-size:13px;margin:0}
.trust .ic{color:var(--success-700);font-weight:800;font-size:18px;margin-bottom:10px}
/* ===== 05 Preços ===== */
.plans{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;align-items:stretch}
.plan{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px;display:flex;flex-direction:column}
.plan.featured{border-color:var(--primary);box-shadow:var(--shadow-card);position:relative}
.plan.featured .ribbon{position:absolute;top:-12px;left:28px;background:var(--primary);color:#fff;
  font-size:11px;font-weight:700;padding:4px 10px;border-radius:var(--radius-pill)}
.plan h3{font-size:18px;margin-bottom:4px}
.plan .price{font-size:34px;font-weight:800;margin:8px 0 2px}
.plan .price small{font-size:14px;font-weight:600;color:var(--muted)}
.plan ul{list-style:none;padding:0;margin:16px 0 24px;flex:1}
.plan li{display:flex;gap:9px;font-size:14px;color:var(--text-2);margin-bottom:10px}
.plan li::before{content:"✓";color:var(--success-700);font-weight:800}
@media(max-width:860px){.trust-grid{grid-template-columns:1fr 1fr}.plans{grid-template-columns:1fr}}
```

- [ ] **Step 2: Inserir HTML de Segurança e Preços em `index.html`**

```html
    <section class="section" id="seguranca">
      <div class="container">
        <div class="sec-head">
          <span class="eyebrow"><span class="dot"></span>Segurança e privacidade</span>
          <h2>Seus dados são seus. Tratados com cuidado.</h2>
          <p>Conexão oficial com a Amazon e proteção dos dados em conformidade com a LGPD e as políticas da Amazon.</p>
        </div>
        <div class="trust-grid">
          <div class="trust"><div class="ic">⚿</div><h4>OAuth oficial (SP-API)</h4><p>Autorização pela Amazon. Não armazenamos sua senha da Amazon.</p></div>
          <div class="trust"><div class="ic">🔒</div><h4>Criptografia</h4><p>Tokens e segredos cifrados em repouso (AES-256-GCM).</p></div>
          <div class="trust"><div class="ic">§</div><h4>LGPD &amp; Amazon DPP</h4><p>Aderência à LGPD e às políticas de proteção de dados da Amazon.</p></div>
          <div class="trust"><div class="ic">⌫</div><h4>Exclusão sob solicitação</h4><p>Seus dados podem ser excluídos quando você quiser.</p></div>
        </div>
        <p style="margin-top:18px;font-size:14px">Detalhes em nossa <a href="privacidade.html" style="color:var(--primary);font-weight:600">Política de Privacidade</a>.</p>
      </div>
    </section>

    <section class="section" id="precos" style="background:var(--surface);border-top:1px solid var(--border);border-bottom:1px solid var(--border)">
      <div class="container">
        <div class="sec-head">
          <span class="eyebrow"><span class="dot"></span>Planos e preços</span>
          <h2>Preços simples, sem surpresa.</h2>
          <p>Escolha pelo volume da sua operação. Valores mensais em reais.</p>
        </div>
        <div class="plans">
          <div class="plan">
            <h3>Starter</h3>
            <div class="price">R$ 89,99<small>/mês</small></div>
            <ul>
              <li>1 conta Amazon</li>
              <li>Até ~500 vendas/mês</li>
              <li>Dashboards e DRE</li>
              <li>Lucratividade por venda</li>
            </ul>
            <a class="btn btn-outline" href="#contato">Começar</a>
          </div>
          <div class="plan featured">
            <span class="ribbon">Mais popular</span>
            <h3>Pro</h3>
            <div class="price">R$ 159,99<small>/mês</small></div>
            <ul>
              <li>Até ~3.000 vendas/mês</li>
              <li>Marketplace Analytics (tráfego/Brand Analytics)</li>
              <li>Otimizador de Ads</li>
              <li>Resumo de estoque no WhatsApp</li>
            </ul>
            <a class="btn btn-primary" href="#contato">Começar</a>
          </div>
          <div class="plan">
            <h3>Scale</h3>
            <div class="price">R$ 219,99<small>/mês</small></div>
            <ul>
              <li>Até 10.000+ vendas/mês</li>
              <li>Multi-conta</li>
              <li>Tudo do Pro</li>
              <li>Suporte premium</li>
            </ul>
            <a class="btn btn-outline" href="#contato">Começar</a>
          </div>
        </div>
      </div>
    </section>
```

- [ ] **Step 3: Validar + conferir pricing presente**

Run:
```bash
cd "C:/Projects/ERP-AMAZON/landing-atlas" && npx --yes html-validate index.html
```
Expected: `0 errors`.

Run:
```bash
cd "C:/Projects/ERP-AMAZON/landing-atlas" && grep -Eo "R\\$ 89,99|R\\$ 159,99|R\\$ 219,99" index.html | sort -u
```
Expected: os 3 valores presentes.

- [ ] **Step 4: Commit**

```bash
cd "C:/Projects/ERP-AMAZON"
git add landing-atlas/index.html landing-atlas/styles.css
git commit -m "feat(landing): secoes Seguranca e Precos (3 planos)"
```

---

### Task 6: FAQ + CTA final + Footer

**Files:**
- Modify: `landing-atlas/index.html`
- Modify: `landing-atlas/styles.css`

**Interfaces:**
- Consumes: `.section`, `.container`, `.btn`, `initFaqAccordion()` (Task 2).
- Produces: `.faq`, `.faq-item`, `.faq-q`, `.faq-a`, `.cta-band`, `.site-footer`. Ancora `#contato` (referenciada por todos os CTAs).

- [ ] **Step 1: Append CSS de FAQ/CTA/Footer em `styles.css`**

```css
/* ===== FAQ ===== */
.faq{max-width:780px;margin:0 auto}
.faq-item{border-bottom:1px solid var(--border)}
.faq-q{width:100%;text-align:left;background:none;border:0;cursor:pointer;
  font-size:16px;font-weight:700;color:var(--text);padding:20px 0;display:flex;justify-content:space-between;gap:16px}
.faq-q::after{content:"+";color:var(--primary);font-weight:800}
.faq-item.open .faq-q::after{content:"–"}
.faq-a{display:none;padding:0 0 20px;font-size:14px;color:var(--text-2)}
.faq-item.open .faq-a{display:block}
/* ===== CTA band ===== */
.cta-band{background:linear-gradient(135deg,var(--primary),var(--success-700));color:#fff;
  border-radius:18px;padding:44px;text-align:center;margin:0 24px}
.cta-band h2{color:#fff;font-size:30px}
.cta-band p{color:#E0E7FF;max-width:48ch;margin:0 auto 22px}
.cta-band .btn-primary{background:#fff;color:var(--primary)}
.cta-band .btn-primary:hover{background:#F1F5F9}
/* ===== Footer ===== */
.site-footer{background:#0F172A;color:#CBD5E1;padding:48px 0 28px;margin-top:64px}
.footer-grid{display:flex;justify-content:space-between;gap:32px;flex-wrap:wrap}
.site-footer a{color:#CBD5E1}.site-footer a:hover{color:#fff}
.site-footer .brand{color:#fff}
.footer-legal{font-size:13px;color:var(--muted);margin-top:28px;border-top:1px solid #1E293B;padding-top:18px;display:flex;gap:18px;flex-wrap:wrap;justify-content:space-between}
.footer-legal a{color:var(--muted)}
@media(max-width:860px){.cta-band{padding:32px 20px}}
```

- [ ] **Step 2: Inserir FAQ + CTA em `index.html` (antes de `</main>`)**

```html
    <section class="section" id="faq">
      <div class="container">
        <div class="sec-head" style="text-align:center;margin-left:auto;margin-right:auto">
          <h2>Perguntas frequentes</h2>
        </div>
        <div class="faq">
          <div class="faq-item"><button type="button" class="faq-q">Preciso estar no Amazon Brand Registry?</button><div class="faq-a">Para os relatórios de Marketplace Analytics (Brand Analytics), a Amazon exige que a marca esteja registrada no Brand Registry. Os demais recursos de gestão e lucratividade funcionam independentemente disso.</div></div>
          <div class="faq-item"><button type="button" class="faq-q">Como o Atlas Seller se conecta à minha conta?</button><div class="faq-a">Pela autorização oficial da Amazon (SP-API via OAuth). Você aprova o acesso no painel da Amazon e pode revogar quando quiser. Não pedimos nem armazenamos sua senha.</div></div>
          <div class="faq-item"><button type="button" class="faq-q">Meus dados ficam seguros?</button><div class="faq-a">Sim. Tokens e segredos são cifrados em repouso e os dados são usados apenas para servir a sua própria operação, em conformidade com a LGPD e as políticas da Amazon. Veja a Política de Privacidade.</div></div>
          <div class="faq-item"><button type="button" class="faq-q">Posso cancelar a qualquer momento?</button><div class="faq-a">Sim. A assinatura é mensal e pode ser cancelada quando você quiser, sem fidelidade.</div></div>
          <div class="faq-item"><button type="button" class="faq-q">Quais marketplaces são suportados?</button><div class="faq-a">O foco é a Amazon Brasil (amazon.com.br). Outras integrações podem ser avaliadas conforme a evolução do produto.</div></div>
        </div>
      </div>
    </section>

    <section class="section" id="contato">
      <div class="container">
        <div class="cta-band">
          <h2>Pronto para enxergar o lucro de cada venda?</h2>
          <p>Agende uma demonstração e veja o Atlas Seller com os dados da sua operação.</p>
          <a class="btn btn-primary" href="mailto:admfsmundo@gmail.com?subject=Quero%20uma%20demo%20do%20Atlas%20Seller">Agendar demo</a>
        </div>
      </div>
    </section>
```

- [ ] **Step 3: Inserir Footer em `index.html` (após `</main>`, antes do `<script>`)**

```html
  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div style="max-width:300px">
          <a class="brand" href="#topo"><span class="sym"></span>Atlas <span style="color:var(--success)">Seller</span></a>
          <p style="color:var(--muted);font-size:13px;margin-top:12px">Gestão e analytics para quem vende na Amazon.</p>
        </div>
        <div>
          <strong style="color:#fff;font-size:13px;display:block;margin-bottom:10px">Produto</strong>
          <div style="display:flex;flex-direction:column;gap:8px;font-size:14px">
            <a href="#recursos">Recursos</a><a href="#analytics">Analytics</a><a href="#precos">Preços</a>
          </div>
        </div>
        <div>
          <strong style="color:#fff;font-size:13px;display:block;margin-bottom:10px">Legal</strong>
          <div style="display:flex;flex-direction:column;gap:8px;font-size:14px">
            <a href="privacidade.html">Política de Privacidade</a><a href="termos.html">Termos de Uso</a>
            <a href="mailto:admfsmundo@gmail.com">Contato</a>
          </div>
        </div>
      </div>
      <div class="footer-legal">
        <span>© 2026 MundoFS — Atlas Seller. Todos os direitos reservados.</span>
        <span>Atlas Seller não é afiliado nem endossado pela Amazon.</span>
      </div>
    </div>
  </footer>
```

- [ ] **Step 4: Validar + testar FAQ accordion**

Run:
```bash
cd "C:/Projects/ERP-AMAZON/landing-atlas" && npx --yes html-validate index.html
```
Expected: `0 errors`.

Abrir no navegador e clicar nas perguntas: cada item expande/colapsa (accordion). Footer escuro com razão social MundoFS e disclaimer de não-afiliação à Amazon.

- [ ] **Step 5: Commit**

```bash
cd "C:/Projects/ERP-AMAZON"
git add landing-atlas/index.html landing-atlas/styles.css
git commit -m "feat(landing): FAQ, CTA final e footer institucional"
```

---

### Task 7: Política de Privacidade (privacidade.html)

**Files:**
- Create: `landing-atlas/privacidade.html`
- Modify: `landing-atlas/styles.css` (classe `.legal`)

**Interfaces:**
- Consumes: `styles.css`, header/footer markup (copiar de `index.html`, ajustando links para âncoras absolutas `index.html#...`).
- Produces: página linkada pelo footer e pela seção Segurança.

**Requisito Amazon 6:** cobertura de coleta/uso/armazenamento/proteção/compartilhamento/exclusão + LGPD + DPP.

- [ ] **Step 1: Append CSS `.legal` em `styles.css`**

```css
/* ===== Páginas legais ===== */
.legal{max-width:760px;margin:0 auto;padding:56px 24px}
.legal h1{font-size:34px;margin-bottom:8px}
.legal .upd{color:var(--muted);font-size:13px;margin-bottom:32px}
.legal h2{font-size:20px;margin:32px 0 8px}
.legal p,.legal li{font-size:15px;color:var(--text-2)}
.legal ul{padding-left:20px}
```

- [ ] **Step 2: Criar `privacidade.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Política de Privacidade — Atlas Seller</title>
  <meta name="description" content="Como o Atlas Seller coleta, usa, armazena, protege e exclui dados, em conformidade com a LGPD e as políticas da Amazon.">
  <link rel="icon" href="assets/img/atlas-symbol.png">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="site-header">
    <div class="container nav">
      <a class="brand" href="index.html"><span class="sym"></span>Atlas <span class="accent">Seller</span></a>
      <nav class="nav-links"><a href="index.html#recursos">Recursos</a><a href="index.html#precos">Preços</a><a class="btn btn-primary" href="index.html#contato">Agendar demo</a></nav>
    </div>
  </header>
  <main class="legal">
    <h1>Política de Privacidade</h1>
    <div class="upd">Última atualização: 30 de junho de 2026</div>

    <p>Esta Política descreve como o <strong>Atlas Seller</strong>, operado pela <strong>MundoFS</strong>, trata os dados de quem utiliza a plataforma, em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018), a Acceptable Use Policy e a Data Protection Policy da Amazon.</p>

    <h2>1. Dados que coletamos</h2>
    <ul>
      <li><strong>Dados da conta Amazon</strong> (via SP-API, mediante sua autorização): pedidos, finanças e settlements, inventário e métricas de tráfego e analytics de marketplace.</li>
      <li><strong>Dados de cadastro</strong>: nome, e-mail e dados de acesso à plataforma.</li>
    </ul>

    <h2>2. Para que usamos</h2>
    <p>Os dados são usados <strong>exclusivamente para prestar o serviço ao próprio titular</strong> — ou seja, para que você visualize e gerencie a sua operação Amazon. Não vendemos, alugamos nem usamos seus dados para publicidade de terceiros.</p>

    <h2>3. Como armazenamos e protegemos</h2>
    <p>Os dados são armazenados em infraestrutura própria (banco de dados em servidor dedicado). Tokens de acesso e segredos são <strong>cifrados em repouso</strong> com AES-256-GCM. O acesso é restrito e há isolamento por conta de cliente.</p>

    <h2>4. Compartilhamento</h2>
    <p>Não compartilhamos seus dados com terceiros, exceto quando estritamente necessário para operar o serviço (por exemplo, a própria API da Amazon) ou por obrigação legal. Não há transferência de dados para fins comerciais.</p>

    <h2>5. Retenção e exclusão</h2>
    <p>Mantemos seus dados enquanto sua conta estiver ativa. Você pode solicitar a <strong>exclusão dos seus dados</strong> a qualquer momento pelo e-mail abaixo; ao revogar a autorização SP-API na Amazon, interrompemos a coleta. Dados podem ser retidos apenas pelo prazo exigido por lei.</p>

    <h2>6. Seus direitos (LGPD)</h2>
    <p>Você pode solicitar acesso, correção, portabilidade, anonimização ou exclusão dos seus dados, bem como informações sobre o tratamento, a qualquer momento.</p>

    <h2>7. Conformidade com a Amazon</h2>
    <p>O tratamento de dados obtidos via Amazon Selling Partner API segue a Acceptable Use Policy e a Data Protection Policy da Amazon. Dados de informações de pedidos (PII) são usados apenas para a finalidade autorizada e não são retidos além do permitido.</p>

    <h2>8. Contato / Encarregado (DPO)</h2>
    <p>Dúvidas ou solicitações: <a href="mailto:admfsmundo@gmail.com" style="color:var(--primary)">admfsmundo@gmail.com</a>.</p>
  </main>
  <footer class="site-footer">
    <div class="container">
      <div class="footer-legal" style="border:0;padding-top:0">
        <span>© 2026 MundoFS — Atlas Seller.</span>
        <span><a href="index.html">Início</a> · <a href="termos.html">Termos de Uso</a></span>
      </div>
    </div>
  </footer>
</body>
</html>
```

- [ ] **Step 3: Validar + conferir cobertura dos tópicos obrigatórios**

Run:
```bash
cd "C:/Projects/ERP-AMAZON/landing-atlas" && npx --yes html-validate privacidade.html
```
Expected: `0 errors`.

Run:
```bash
cd "C:/Projects/ERP-AMAZON/landing-atlas" && grep -Eio "coletamos|usamos|armazena|protege|compartilha|exclus|LGPD|Data Protection" privacidade.html | sort -u
```
Expected: cobre coleta, uso, armazenamento, proteção, compartilhamento, exclusão, LGPD e DPP.

- [ ] **Step 4: Commit**

```bash
cd "C:/Projects/ERP-AMAZON"
git add landing-atlas/privacidade.html landing-atlas/styles.css
git commit -m "feat(landing): Politica de Privacidade (LGPD + Amazon DPP)"
```

---

### Task 8: Termos de Uso (termos.html)

**Files:**
- Create: `landing-atlas/termos.html`

**Interfaces:**
- Consumes: `styles.css` `.legal` (Task 7), header/footer markup.
- Produces: página linkada pelo footer.

- [ ] **Step 1: Criar `termos.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Termos de Uso — Atlas Seller</title>
  <meta name="description" content="Termos de Uso da plataforma Atlas Seller.">
  <link rel="icon" href="assets/img/atlas-symbol.png">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="site-header">
    <div class="container nav">
      <a class="brand" href="index.html"><span class="sym"></span>Atlas <span class="accent">Seller</span></a>
      <nav class="nav-links"><a href="index.html#recursos">Recursos</a><a href="index.html#precos">Preços</a><a class="btn btn-primary" href="index.html#contato">Agendar demo</a></nav>
    </div>
  </header>
  <main class="legal">
    <h1>Termos de Uso</h1>
    <div class="upd">Última atualização: 30 de junho de 2026</div>
    <p>Ao utilizar o <strong>Atlas Seller</strong>, operado pela <strong>MundoFS</strong>, você concorda com estes Termos.</p>
    <h2>1. Objeto</h2>
    <p>O Atlas Seller é uma plataforma de gestão e analytics para vendedores da Amazon, que integra a conta do usuário via Amazon Selling Partner API mediante autorização.</p>
    <h2>2. Conta e responsabilidades</h2>
    <p>Você é responsável por manter a confidencialidade do seu acesso e pela veracidade dos dados informados. A autorização de integração com a Amazon é concedida e revogada por você.</p>
    <h2>3. Planos e pagamento</h2>
    <p>Os planos são mensais, nos valores divulgados na página de preços. O serviço é prestado mediante assinatura ativa.</p>
    <h2>4. Cancelamento</h2>
    <p>Você pode cancelar a qualquer momento, sem fidelidade. O acesso permanece até o fim do ciclo vigente.</p>
    <h2>5. Limitação de responsabilidade</h2>
    <p>O Atlas Seller fornece informações para apoio à decisão e não se responsabiliza por decisões comerciais tomadas pelo usuário nem por indisponibilidades de serviços de terceiros (incluindo a Amazon).</p>
    <h2>6. Privacidade</h2>
    <p>O tratamento de dados segue a nossa <a href="privacidade.html" style="color:var(--primary)">Política de Privacidade</a>.</p>
    <h2>7. Foro e contato</h2>
    <p>Estes Termos são regidos pela legislação brasileira. Contato: <a href="mailto:admfsmundo@gmail.com" style="color:var(--primary)">admfsmundo@gmail.com</a>.</p>
  </main>
  <footer class="site-footer">
    <div class="container">
      <div class="footer-legal" style="border:0;padding-top:0">
        <span>© 2026 MundoFS — Atlas Seller.</span>
        <span><a href="index.html">Início</a> · <a href="privacidade.html">Política de Privacidade</a></span>
      </div>
    </div>
  </footer>
</body>
</html>
```

- [ ] **Step 2: Validar**

Run:
```bash
cd "C:/Projects/ERP-AMAZON/landing-atlas" && npx --yes html-validate termos.html
```
Expected: `0 errors`.

- [ ] **Step 3: Commit**

```bash
cd "C:/Projects/ERP-AMAZON"
git add landing-atlas/termos.html
git commit -m "feat(landing): Termos de Uso"
```

---

### Task 9: Verificação de conformidade + acessibilidade + responsivo

**Files:**
- Modify: qualquer arquivo conforme achados (correções pontuais).

**Interfaces:**
- Consumes: todas as páginas (Tasks 2-8).
- Produces: relatório de conformidade (no corpo do commit/PR) garantindo os 6 requisitos Amazon.

- [ ] **Step 1: Checklist automatizado das 6 exigências da Amazon**

Run (uma checagem por requisito):
```bash
cd "C:/Projects/ERP-AMAZON/landing-atlas"
echo "R1 acessível/sem placeholder:"; grep -Eio "under construction|lorem ipsum|TODO|TBD|placeholder" index.html privacidade.html termos.html || echo "  OK (nenhum encontrado)"
echo "R2 marca/razão social:"; grep -o "Atlas Seller" index.html | head -1; grep -o "MundoFS" index.html | head -1
echo "R3 sem claims proibidos:"; grep -Eio "#1|número 1|o melhor|melhor app|o único|the only" index.html || echo "  OK (nenhum claim proibido)"
echo "R4 Brand Analytics features:"; grep -Eo "Marketplace Analytics|Brand Analytics|tráfego|conversão por sessão|Buy Box" index.html | sort -u
echo "R5 pricing:"; grep -Eo "R\\$ 89,99|R\\$ 159,99|R\\$ 219,99" index.html | sort -u
echo "R6 privacidade:"; grep -Eio "exclus|LGPD|Data Protection" privacidade.html | sort -u
```
Expected: R1 sem ocorrências; R2 mostra "Atlas Seller" e "MundoFS"; R3 sem ocorrências; R4 lista os 5 termos; R5 os 3 preços; R6 cobre exclusão/LGPD/DPP. **Qualquer falha bloqueia** — corrigir e repetir.

- [ ] **Step 2: Acessibilidade básica**

Verificar manualmente/por inspeção:
- `<html lang="pt-BR">` em todas as páginas.
- Todas as `<img>` com `alt` (o card de dashboard decorativo usa `aria-hidden="true"`).
- Botão de menu com `aria-label`.
- Contraste: texto `#475569` sobre `#FFFFFF` e branco sobre `#2563EB` — ambos passam AA.

Run (toda img tem alt ou aria-hidden):
```bash
cd "C:/Projects/ERP-AMAZON/landing-atlas" && grep -n "<img" index.html privacidade.html termos.html || echo "Sem <img> de conteúdo (logos via CSS/brand) — OK"
```
Expected: se houver `<img>`, cada uma tem `alt`. Se usar screenshots reais (assets/img/screenshots), garantir `alt` descritivo.

- [ ] **Step 3: Responsivo — conferência em 3 larguras**

Abrir `index.html` e testar em ~375px (mobile), ~768px (tablet), ~1280px (desktop):
- Mobile: nav vira hambúrguer e abre/fecha; grids viram 1 coluna; hero empilha; sem scroll horizontal.
- Desktop: hero 2 colunas; grids 3/4 colunas.

Expected: layout íntegro nas 3 larguras, sem overflow horizontal.

- [ ] **Step 4: Commit (se houve correção)**

```bash
cd "C:/Projects/ERP-AMAZON"
git add -A landing-atlas
git commit -m "fix(landing): ajustes de conformidade, acessibilidade e responsivo"
```
(Se nada precisou de correção, registrar no PR que a Task 9 passou sem alterações.)

---

### Task 10: Deploy — Nginx vhost + Let's Encrypt

**Files:**
- Create: `deploy/landing-atlas-nginx.conf`

**Interfaces:**
- Consumes: arquivos estáticos de `landing-atlas/`.
- Produces: vhost servindo o subdomínio em HTTPS.

**Pré-requisito externo:** criar o registro DNS `A`/`AAAA` do subdomínio (ex: `atlasseller.mundofs.cloud`) apontando para a VPS. Nome exato a confirmar com o usuário (item em aberto §13 do spec).

- [ ] **Step 1: Criar `deploy/landing-atlas-nginx.conf`**

```nginx
# Atlas Seller — landing estática
# Publicar arquivos em /var/www/atlas-landing (copiar conteúdo de landing-atlas/)
server {
    listen 80;
    listen [::]:80;
    server_name atlasseller.mundofs.cloud;   # <-- ajustar nome final

    root /var/www/atlas-landing;
    index index.html;

    # Cache de assets versionados
    location ~* \.(css|js|woff2|png|jpg|svg|ico)$ {
        expires 7d;
        add_header Cache-Control "public";
    }

    location / {
        try_files $uri $uri/ =404;
    }

    # Cabeçalhos de segurança básicos
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;
    add_header Referrer-Policy strict-origin-when-cross-origin;
}
```

- [ ] **Step 2: Documentar os comandos de publicação (no topo do .conf, como comentário, ou no PR)**

Sequência na VPS (rodar como o usuário com sudo):
```bash
# 1. Subir os arquivos (do dev, na raiz do repo):
#    rsync -avz --delete landing-atlas/ erp-vps:/tmp/atlas-landing/
# 2. Na VPS:
sudo mkdir -p /var/www/atlas-landing
sudo cp -r /tmp/atlas-landing/* /var/www/atlas-landing/
sudo cp /opt/erp-amazon/deploy/landing-atlas-nginx.conf /etc/nginx/sites-available/atlas-landing.conf
sudo ln -sf /etc/nginx/sites-available/atlas-landing.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
# 3. HTTPS:
sudo certbot --nginx -d atlasseller.mundofs.cloud
```

- [ ] **Step 3: Validar config localmente (sintaxe)**

A validação real (`nginx -t`) ocorre na VPS. Localmente, conferir que o arquivo não tem placeholder esquecido além do `server_name`:
```bash
cd "C:/Projects/ERP-AMAZON" && grep -n "server_name" deploy/landing-atlas-nginx.conf
```
Expected: linha com o subdomínio a confirmar.

- [ ] **Step 4: Commit**

```bash
cd "C:/Projects/ERP-AMAZON"
git add deploy/landing-atlas-nginx.conf
git commit -m "chore(landing): vhost Nginx e passos de deploy do subdominio"
```

---

### Task 11: Rascunho da resposta ao caso Amazon

**Files:**
- Create: `docs/amazon-case-20883425301-reply.md`

**Interfaces:**
- Consumes: URL pública da landing (após Task 10).
- Produces: texto pronto para colar no caso da Amazon.

- [ ] **Step 1: Criar `docs/amazon-case-20883425301-reply.md`**

```markdown
# Resposta — Case 20883425301 (SP-API · Brand Analytics)

> Enviar pela Contact Us do Solution Provider Portal. Substituir <URL> pela URL final
> publicada (ex: https://atlasseller.mundofs.cloud) antes de enviar. Texto em inglês.

---

Hello,

Thank you for the feedback. We have published a dedicated website for our application,
**Atlas Seller**, which now provides detailed information about the analytical services
we offer to Amazon Selling Partners, in line with sections 4.4 and 4.5 of the
Acceptable Use Policy.

Website: <URL>

Where each requested item is addressed:

- **Features and analytical services (Brand Analytics role):** the "Recursos / Marketplace
  Analytics" section (<URL>#analytics) describes the marketplace analytics we surface to
  sellers — traffic and conversion metrics by SKU and by day (sessions, page views, unit
  session conversion rate), Buy Box percentage, and insights into how customers discover
  and purchase products. This aligns directly with the Brand Analytics role we requested.
- **Other features:** profitability per order (Amazon referral, FBA, installments, freight,
  tax, cost and margin), advertising optimization (ACOS/ROAS/CTR/CPC), Buy Box monitoring,
  financial management and inventory coverage.
- **Pricing:** clearly displayed at <URL>#precos — three monthly plans (Starter R$ 89.99,
  Pro R$ 159.99, Scale R$ 219.99).
- **Privacy policy:** <URL>/privacidade.html — covers how data is collected, used, stored,
  protected, shared and deleted, in compliance with the LGPD and Amazon's Data Protection
  Policy.

The website is publicly accessible without authentication. Please let us know if any
additional information is needed.

Best regards,
MundoFS — Atlas Seller
```

- [ ] **Step 2: Commit**

```bash
cd "C:/Projects/ERP-AMAZON"
git add docs/amazon-case-20883425301-reply.md
git commit -m "docs(landing): rascunho de resposta ao caso Amazon 20883425301"
```

---

## Self-Review

**1. Spec coverage** (cada seção do spec → task):
- §3 Checklist Amazon R1-R6 → Task 9 (verificação) + onde cada um nasce (R2 Task 2/6, R3 copy global, R4 Task 4, R5 Task 5, R6 Task 7). ✔
- §4 Arquitetura/entregáveis (estrutura de arquivos) → Tasks 1-8. ✔
- §5 Estrutura da página (nav, hero, 01-05, FAQ, CTA, footer) → Tasks 2-6. ✔
- §6 Bloco Marketplace Analytics → Task 4 (com verificação de termos). ✔
- §7 Pricing 3 planos → Task 5 (com verificação de valores). ✔
- §8 Política de Privacidade → Task 7. ✔
- §9 Termos → Task 8. ✔
- §10 Design system (cores/tipografia/componentes) → Task 2 (Global Constraints + styles.css). ✔
- §11 Resposta ao caso → Task 11. ✔
- Deploy (Nginx/Let's Encrypt) → Task 10. ✔
- §13 Itens em aberto (subdomínio, email, screenshots) → tratados como pré-requisitos/decisões pontuais nas Tasks 10/7/1; **dependem de confirmação do usuário** (ver "Decisões pendentes" abaixo).

**2. Placeholder scan:** o plano não contém TODO/TBD em código. O único `<!-- ... -->` é marcador de ponto de inserção (intencional, com instrução clara). O `server_name` do Nginx é o único valor a ajustar e está sinalizado. ✔

**3. Type/identifier consistency:** classes CSS definidas na Task 2 e estendidas nas tasks seguintes batem com o HTML que as usa (`.dash-card`, `.eyebrow`, `.btn-primary`, `.plan.featured`, `.faq-item`, `.legal`). Funções de `app.js` (`initMobileMenu/initSmoothScroll/initFaqAccordion`) batem com os seletores usados no HTML (`.nav-toggle`, `.nav-links`, `a[href^="#"]`, `.faq-q/.faq-item`). Âncoras (`#recursos`, `#analytics`, `#seguranca`, `#precos`, `#contato`, `#topo`) referenciadas na nav/CTAs existem nas seções. ✔

## Decisões pendentes (confirmar com o usuário antes/durante a execução)

1. **Nome exato do subdomínio** — usado na Task 10 (Nginx) e na Task 11 (resposta). Default assumido: `atlasseller.mundofs.cloud`.
2. **E-mail de contato/DPO exibido** — Tasks 6/7/8/11 usam `admfsmundo@gmail.com`. Trocar por `contato@`/`privacidade@` do domínio se preferir.
3. **Screenshots reais** — Task 1 copia logos; o hero usa um mock CSS (não depende de imagem). Se quiser prints reais do dashboard nas seções, adicionar à `assets/img/screenshots/` e referenciar (decisão opcional, não bloqueia aprovação).
