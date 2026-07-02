(function(){
  'use strict';
  // ERP que cria a assinatura (CORS liberado p/ esta origem via CHECKOUT_PUBLICO_ORIGEM).
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

  var formDados = document.getElementById('formDados');
  var fieldsetDados = document.getElementById('fieldsetDados');
  var btnContinuar = document.getElementById('btnContinuar');
  var erroSubmissaoEl = document.getElementById('erroSubmissao');
  var formPagamento = document.getElementById('formPagamento');
  var btnAlterarPlano = document.getElementById('btnAlterarPlano');
  var checkTermos = document.getElementById('checkTermos');
  var btnAssinar = document.getElementById('btnAssinar');
  var erroPagamentoEl = document.getElementById('erroPagamento');
  var trocaPlanoEl = document.getElementById('trocaPlano');
  var trocaCicloEl = document.getElementById('trocaCiclo');

  var enviandoDados = false;
  var confirmandoPagamento = false;
  var stripe = null;
  var elements = null;

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

  trocaPlanoEl.addEventListener('click', function(e){
    var b = e.target.closest('button[data-plan]');
    if (!b || b.disabled || b.dataset.plan === plano) return;
    plano = b.dataset.plan;
    renderResumo();
  });
  trocaCicloEl.addEventListener('click', function(e){
    var b = e.target.closest('button[data-period]');
    if (!b || b.disabled || b.dataset.period === ciclo) return;
    ciclo = b.dataset.period;
    renderResumo();
  });

  // Máscara leve: CPF/CNPJ só aceita dígitos (até 14 — CNPJ).
  var cpfCnpjEl = document.getElementById('cpfCnpj');
  cpfCnpjEl.addEventListener('input', function(){
    cpfCnpjEl.value = cpfCnpjEl.value.replace(/\D/g, '').slice(0, 14);
  });

  function soDigitos(v){ return (v || '').replace(/\D/g, ''); }

  function limparErros(){
    ['erroNome', 'erroEmail', 'erroEmailConfirma', 'erroCpfCnpj', 'erroCelular', 'erroSubmissao'].forEach(function(id){
      document.getElementById(id).textContent = '';
    });
    ['nome', 'email', 'emailConfirma', 'cpfCnpj', 'celular'].forEach(function(id){
      document.getElementById(id).removeAttribute('aria-invalid');
    });
  }

  function marcarErro(campoId, erroId, msg){
    document.getElementById(erroId).textContent = msg;
    document.getElementById(campoId).setAttribute('aria-invalid', 'true');
  }

  function coletarDados(){
    return {
      nome: document.getElementById('nome').value.trim(),
      email: document.getElementById('email').value.trim(),
      emailConfirma: document.getElementById('emailConfirma').value.trim(),
      cpfCnpj: soDigitos(document.getElementById('cpfCnpj').value),
      celular: soDigitos(document.getElementById('celular').value),
      nomeEmpresa: document.getElementById('nomeEmpresa').value.trim()
    };
  }

  function validar(dados){
    var valido = true;
    if (dados.nome.length < 2) {
      marcarErro('nome', 'erroNome', 'Informe seu nome completo.');
      valido = false;
    }
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(dados.email)) {
      marcarErro('email', 'erroEmail', 'Informe um e-mail válido.');
      valido = false;
    } else if (dados.email.toLowerCase() !== dados.emailConfirma.toLowerCase()) {
      marcarErro('emailConfirma', 'erroEmailConfirma', 'Os e-mails não são iguais.');
      valido = false;
    }
    if (dados.cpfCnpj.length !== 11 && dados.cpfCnpj.length !== 14) {
      marcarErro('cpfCnpj', 'erroCpfCnpj', 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.');
      valido = false;
    }
    if (dados.celular.length < 10 || dados.celular.length > 13) {
      marcarErro('celular', 'erroCelular', 'Informe um celular válido com DDD.');
      valido = false;
    }
    return valido;
  }

  function setBotao(btn, desabilitado, texto){
    btn.disabled = desabilitado;
    if (texto) btn.textContent = texto;
  }

  function travarEtapa1(){
    fieldsetDados.disabled = true;
    setBotao(btnContinuar, true, 'Dados confirmados ✓');
    document.querySelectorAll('#trocaPlano button, #trocaCiclo button').forEach(function(b){ b.disabled = true; });
  }

  function mostrarErroSubmissao(msg){
    erroSubmissaoEl.textContent = msg + ' Tente de novo ou ';
    var link = document.createElement('a');
    link.href = 'index.html#contato';
    link.textContent = 'fale com a gente';
    erroSubmissaoEl.appendChild(link);
    erroSubmissaoEl.appendChild(document.createTextNode('.'));
    erroSubmissaoEl.hidden = false;
  }

  formDados.addEventListener('submit', function(e){
    e.preventDefault();
    if (enviandoDados) return;
    limparErros();
    var dados = coletarDados();
    if (!validar(dados)) return;

    enviandoDados = true;
    setBotao(btnContinuar, true, 'Enviando…');

    fetch(API_BASE + '/api/checkout-publico/assinatura', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        plano: plano,
        ciclo: ciclo,
        nome: dados.nome,
        email: dados.email,
        cpfCnpj: dados.cpfCnpj,
        celular: dados.celular,
        nomeEmpresa: dados.nomeEmpresa
      })
    })
      .then(function(res){
        return res.json().catch(function(){ return {}; }).then(function(body){
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .then(function(r){
        enviandoDados = false;
        if (!r.ok) {
          if (r.body && r.body.erro === 'CPF_CNPJ_INVALIDO') {
            marcarErro('cpfCnpj', 'erroCpfCnpj', 'CPF/CNPJ inválido. Confira os números e tente de novo.');
          } else if (r.status === 429) {
            mostrarErroSubmissao('Muitas tentativas em pouco tempo.');
          } else {
            mostrarErroSubmissao('Não foi possível continuar agora.');
          }
          setBotao(btnContinuar, false, 'Continuar para pagamento');
          return;
        }
        iniciarPagamento(r.body.clientSecret, r.body.publishableKey);
      })
      .catch(function(){
        enviandoDados = false;
        mostrarErroSubmissao('Não foi possível continuar agora. Verifique sua conexão.');
        setBotao(btnContinuar, false, 'Continuar para pagamento');
      });
  });

  function iniciarPagamento(clientSecret, publishableKey){
    if (typeof Stripe === 'undefined') {
      mostrarErroSubmissao('Não foi possível carregar o pagamento seguro. Desative bloqueadores de anúncio para esta página e tente novamente.');
      setBotao(btnContinuar, false, 'Continuar para pagamento');
      return;
    }

    try {
      stripe = Stripe(publishableKey);
      elements = stripe.elements({
        clientSecret: clientSecret,
        appearance: {
          theme: 'stripe',
          variables: { colorPrimary: '#2563EB', fontFamily: 'Inter, system-ui, sans-serif', borderRadius: '8px' }
        }
      });
      var paymentElement = elements.create('payment');
      paymentElement.mount('#payment-element');

      travarEtapa1();
      formPagamento.hidden = false;
      formPagamento.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      mostrarErroSubmissao('Não foi possível carregar o pagamento seguro. Desative bloqueadores de anúncio para esta página e tente novamente.');
      setBotao(btnContinuar, false, 'Continuar para pagamento');
    }
  }

  btnAlterarPlano.addEventListener('click', function(e){
    e.preventDefault();
    location.reload();
  });

  checkTermos.addEventListener('change', function(){
    btnAssinar.disabled = !checkTermos.checked;
  });

  formPagamento.addEventListener('submit', function(e){
    e.preventDefault();
    if (confirmandoPagamento || !checkTermos.checked || !stripe || !elements) return;
    confirmandoPagamento = true;
    erroPagamentoEl.textContent = '';
    setBotao(btnAssinar, true, 'Processando…');

    stripe.confirmPayment({
      elements: elements,
      confirmParams: { return_url: API_BASE + '/ativar' }
    }).then(function(result){
      // Sucesso = redirect automático do Stripe para return_url; só chegamos
      // aqui em caso de falha na confirmação (cartão recusado, etc).
      if (result && result.error) {
        confirmandoPagamento = false;
        erroPagamentoEl.textContent = result.error.message || 'Não foi possível confirmar o pagamento. Tente de novo.';
        setBotao(btnAssinar, false, 'Assinar agora 🔒');
        btnAssinar.disabled = !checkTermos.checked;
      }
    }).catch(function(){
      confirmandoPagamento = false;
      erroPagamentoEl.textContent = 'Não foi possível confirmar o pagamento. Tente de novo.';
      setBotao(btnAssinar, false, 'Assinar agora 🔒');
      btnAssinar.disabled = !checkTermos.checked;
    });
  });

  renderResumo();
})();
