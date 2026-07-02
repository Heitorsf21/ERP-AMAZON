/* Atlas Seller — demo timeline (determinística, loop, capturável) */
(function(){
  const LOOP = 35000;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const stage = $('#stage');
  const orders = $$('#orders .order');
  const salecard = $('#salecard');
  const breakdown = $('#breakdown');
  const bdrows = $$('#breakdown .bd-row');
  const bdprofit = $('#bdprofit');
  const sVendas = $('#s-vendas'), sDash = $('#s-dash'), sAna = $('#s-analytics');
  const urltext = $('#urltext');
  const navItems = $$('.side .it');
  const dkpis = $$('#s-dash .dkpi');
  const akpis = $$('#s-analytics .akpi');
  const fills = $$('#s-analytics .fill');
  const chartsvg = $('#chartsvg');
  const cap = $('#cap'), capnum = $('#capnum'), captext = $('#captext');
  const endcard = $('#endcard');
  const progress = $('#progress');
  const liveDot = $('.live .dot');

  /* ---- helpers ---- */
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const prog = (T,a,b) => clamp01((T - a) / (b - a));
  const ease = t => 1 - Math.pow(1 - t, 3);              // easeOutCubic
  const easeIO = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;

  function fmt(kind, v){
    switch(kind){
      case 'int':  return Math.round(v).toLocaleString('pt-BR');
      case 'brl':  return 'R$ ' + Math.round(v).toLocaleString('pt-BR');
      case 'brlc': return 'R$ ' + (v/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
      case 'pct1': return (v/10).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1}) + '%';
      case 'pct0': return Math.round(v/10) + '%';
      default:     return Math.round(v);
    }
  }
  function countGroup(sel, T, cs, ce){
    const p = ease(prog(T, cs, ce));
    $$(sel + ' [data-count]').forEach(el=>{
      el.textContent = fmt(el.dataset.fmt, (+el.dataset.count) * p);
    });
  }

  /* ---- chart paths (built once) ---- */
  let chartBuilt = false;
  function buildChart(){
    if(chartBuilt) return; chartBuilt = true;
    const W = 900, H = 170, N = 12;
    const fat = [.30,.35,.32,.42,.47,.44,.53,.60,.57,.68,.77,.86];
    const mk = (arr, scale) => {
      let top = 'M0,' + H;
      const pts = arr.map((f,i)=>{
        const x = (i/(N-1))*W;
        const y = H - (f*scale) * H * 0.92;
        return [x,y];
      });
      top = 'M' + pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' L');
      const d = top + ' L' + W + ',' + H + ' L0,' + H + ' Z';
      return d;
    };
    $('#area1').setAttribute('d', mk(fat, 1.0));
    $('#area2').setAttribute('d', mk(fat, 0.80));
    $('#area3').setAttribute('d', mk(fat, 0.34));
  }

  /* ---- screens ---- */
  function showScreens(T){
    const v = prog(T,0,350) * (1 - prog(T,17000,17600));
    const d = prog(T,17000,17600) * (1 - prog(T,26000,26600));
    const a = prog(T,26000,26600) * (1 - prog(T,31000,31400));
    sVendas.style.opacity = v;
    sDash.style.opacity = d;
    sAna.style.opacity = a;
    // url + nav
    let url, nav;
    if(T < 17000){ url='atlasseller.mundofs.cloud/vendas'; nav='vendas'; }
    else if(T < 26000){ url='atlasseller.mundofs.cloud/dashboard-ecommerce'; nav='dash'; }
    else { url='atlasseller.mundofs.cloud/publicidade'; nav='analytics'; }
    urltext.textContent = url;
    navItems.forEach(it => it.classList.toggle('on', it.dataset.nav === nav));
  }

  /* ---- caption ---- */
  const scenes = [
    {a:900,  b:9000,  n:'01', t:'A venda cai da Amazon',                        cls:''},
    {a:9000, b:17000, n:'02', t:'Atlas calcula o lucro real — taxas, FBA e custo', cls:'step2'},
    {a:17000,b:26000, n:'03', t:'Dashboard e margem se atualizam sozinhos',      cls:'step3'},
    {a:26000,b:31000, n:'04', t:'Analytics de tráfego e Ads no mesmo lugar',     cls:'step4'},
  ];
  function updateCaption(T){
    if(T < scenes[0].a || T > 31000){ cap.style.opacity = 0; return; }
    const s = scenes.find(s => T >= s.a && T < s.b) || scenes[scenes.length-1];
    capnum.textContent = s.n;
    captext.textContent = s.t;
    cap.className = 'cap-pill ' + s.cls;
    const enter = ease(prog(T, s.a, s.a+400));
    const exit  = prog(T, s.b-350, s.b);
    cap.style.opacity = clamp01(enter - exit);
    cap.style.transform = `translateY(${(1-enter)*20}px)`;
  }

  /* ---- main render ---- */
  function render(T){
    progress.style.width = (T/LOOP*100) + '%';
    liveDot.style.opacity = 0.45 + 0.55*Math.abs(Math.sin(T/480));

    // orders drop in
    const ot = [700,2400,4000,5600,7000];
    orders.forEach((el,i)=>{
      const p = ease(prog(T, ot[i], ot[i]+700));
      el.style.opacity = p;
      el.style.transform = `translateY(${(1-p)*18}px)`;
    });
    orders[0].classList.toggle('hot', T > 1400);

    showScreens(T);

    // sale card + expand + breakdown
    const scp = ease(prog(T,1300,2100));
    salecard.style.opacity = scp;
    salecard.style.transform = `translateY(${(1-scp)*20}px)`;
    const ex = ease(prog(T,9000,9800));
    breakdown.style.maxHeight = (ex*380) + 'px';
    breakdown.style.opacity = clamp01(ex*3);
    const bt = [9600,10500,11400,12300];
    bdrows.forEach((el,i)=>{
      const p = ease(prog(T, bt[i], bt[i]+600));
      el.style.opacity = p;
      el.style.transform = `translateX(${(1-p)*-14}px)`;
    });
    const pp = ease(prog(T,13600,14500));
    bdprofit.style.opacity = pp;
    bdprofit.style.transform = `scale(${0.95 + 0.05*pp})`;

    // vendas kpis
    countGroup('#s-vendas', T, 1500, 4500);

    // dashboard
    const kt = [17800,18150,18500,18850];
    dkpis.forEach((el,i)=>{
      const p = ease(prog(T, kt[i], kt[i]+600));
      el.style.opacity = p;
      el.style.transform = `translateY(${(1-p)*16}px)`;
    });
    countGroup('#s-dash', T, 18000, 22000);
    buildChart();
    const cr = easeIO(prog(T,19000,24000));
    chartsvg.style.clipPath = `inset(0 ${(1-cr)*100}% 0 0)`;

    // analytics
    const at = [26800,27150,27500,27850];
    akpis.forEach((el,i)=>{
      const p = ease(prog(T, at[i], at[i]+600));
      el.style.opacity = p;
      el.style.transform = `translateY(${(1-p)*16}px)`;
    });
    countGroup('#s-analytics', T, 27000, 30000);
    fills.forEach(el=>{
      const p = ease(prog(T,27200,30000));
      el.style.width = ((+el.dataset.w)*p) + '%';
    });

    updateCaption(T);

    // end card
    const ein = ease(prog(T,31200,32400));
    const eout = ease(prog(T,34700,35000));
    endcard.style.opacity = clamp01(ein - eout);
  }

  /* ---- fit to viewport (preview) ---- */
  function fit(){
    const s = Math.min(window.innerWidth/1920, window.innerHeight/1080);
    stage.style.transform = `scale(${s})`;
  }
  window.addEventListener('resize', fit); fit();

  /* ---- run / capture API ---- */
  let start = null, paused = false;
  function loop(now){
    if(!paused){
      if(start == null) start = now;
      render((now - start) % LOOP);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // capture hooks
  window.__LOOP = LOOP;
  window.seek = ms => { paused = true; render(((ms % LOOP) + LOOP) % LOOP); };
  window.play = () => { paused = false; start = null; };
})();
