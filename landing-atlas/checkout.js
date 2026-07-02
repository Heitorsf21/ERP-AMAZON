(function(){
  'use strict';
  // ERP que cria a sessão (CORS liberado p/ esta origem via CHECKOUT_PUBLICO_ORIGEM).
  var API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : 'https://erp.mundofs.cloud';

  var PLANOS = {
    starter: { nome: 'Starter', base: 8999, features: ['1 conta Amazon', 'Até ~500 vendas/mês', 'Dashboards e DRE', 'Lucratividade por venda'] },
    pro:     { nome: 'Pro',     base: 15999, features: ['Até ~3.000 vendas/mês', 'Marketplace Analytics (tráfego/Brand Analytics)', 'Otimizador de Ads', 'Resumo de estoque no WhatsApp'] },
    scale:   { nome: 'Scale',   base: 21999, features: ['Até 10.000+ vendas/mês', 'Multi-conta', 'Tudo do Pro', 'Suporte premium'] }
  };
  // [meses, desconto, rótulo] — MESMA fórmula do app.js; bate com os prices do Stripe.
  var CICLOS = { mensal: [1, 0, '/mês'], trimestral: [3, .05, '/trimestre'], semestral: [6, .10, '/semestre'], anual: [12, .20, '/ano'] };

  var qs = new URLSearchParams(location.search);
  var plano = PLANOS[qs.get('plano')] ? qs.get('plano') : 'pro';
  var ciclo = CICLOS[qs.get('ciclo')] ? qs.get('ciclo') : 'mensal';

  var estadoEl = document.getElementById('estadoPagamento');
  var embedEl = document.getElementById('checkout-embed');
  var checkoutAtual = null; // instância do Embedded Checkout (para destroy)
  var geracao = 0;          // invalida respostas de fetch antigas ao trocar plano/ciclo

  function fmt(c){ return 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function renderResumo(){
    var p = PLANOS[plano];
    var c = CICLOS[ciclo];
    var total = Math.round(p.base * c[0] * (1 - c[1]));
    document.getElementById('resumoNome').textContent = p.nome;
    document.getElementById('resumoValor').textContent = fmt(total);
    document.getElementById('resumoPer').textContent = c[2];
    document.getElementById('resumoEquiv').textContent = c[0] > 1 ? 'equivale a ' + fmt(Math.round(total / c[0])) + '/mês' : '';
    var ul = document.getElementById('resumoFeatures');
    ul.innerHTML = '';
    p.features.forEach(function(f){
      var li = document.createElement('li');
      li.textContent = f;
      ul.appendChild(li);
    });
    document.querySelectorAll('#trocaPlano button').forEach(function(b){ b.classList.toggle('active', b.dataset.plan === plano); });
    document.querySelectorAll('#trocaCiclo button').forEach(function(b){ b.classList.toggle('active', b.dataset.period === ciclo); });
    var url = new URL(location.href);
    url.searchParams.set('plano', plano);
    url.searchParams.set('ciclo', ciclo);
    history.replaceState(null, '', url);
  }

  function mostrarErro(){
    estadoEl.innerHTML = 'Não foi possível carregar o pagamento agora. Tente de novo em instantes ou ' +
      '<a href="index.html#contato">fale com a gente</a>.';
    estadoEl.hidden = false;
  }

  function carregarCheckout(){
    var minhaGeracao = ++geracao;
    estadoEl.textContent = 'Carregando pagamento seguro…';
    estadoEl.hidden = false;
    if (checkoutAtual) { checkoutAtual.destroy(); checkoutAtual = null; }
    embedEl.innerHTML = '';

    fetch(API_BASE + '/api/checkout-publico/sessao', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plano: plano, ciclo: ciclo })
    })
      .then(function(res){ if (!res.ok) throw new Error('http ' + res.status); return res.json(); })
      .then(function(data){
        if (minhaGeracao !== geracao) return; // usuário já trocou de plano/ciclo
        var stripe = Stripe(data.publishableKey);
        return stripe.initEmbeddedCheckout({ clientSecret: data.clientSecret })
          .then(function(checkout){
            if (minhaGeracao !== geracao) { checkout.destroy(); return; }
            checkoutAtual = checkout;
            estadoEl.hidden = true;
            checkout.mount('#checkout-embed');
          });
      })
      .catch(function(){ if (minhaGeracao === geracao) mostrarErro(); });
  }

  document.getElementById('trocaPlano').addEventListener('click', function(e){
    var b = e.target.closest('button[data-plan]');
    if (!b || b.dataset.plan === plano) return;
    plano = b.dataset.plan;
    renderResumo();
    carregarCheckout();
  });
  document.getElementById('trocaCiclo').addEventListener('click', function(e){
    var b = e.target.closest('button[data-period]');
    if (!b || b.dataset.period === ciclo) return;
    ciclo = b.dataset.period;
    renderResumo();
    carregarCheckout();
  });

  renderResumo();
  carregarCheckout();
})();
