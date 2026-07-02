function initMobileMenu(){
  const t=document.querySelector('.nav-toggle');
  const l=document.querySelector('.nav-links');
  if(!t||!l)return;
  function setOpen(open){
    l.classList.toggle('open',open);
    t.setAttribute('aria-expanded',String(open));
    t.setAttribute('aria-label',open?'Fechar menu':'Abrir menu');
  }
  t.addEventListener('click',()=>setOpen(!l.classList.contains('open')));
  l.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>setOpen(false)));
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
  document.querySelectorAll('.faq-item').forEach((item,i)=>{
    const q=item.querySelector('.faq-q');
    const a=item.querySelector('.faq-a');
    if(!q||!a)return;
    const answerId=a.id||`faq-answer-${i+1}`;
    a.id=answerId;
    q.setAttribute('aria-expanded',String(item.classList.contains('open')));
    q.setAttribute('aria-controls',answerId);
    a.hidden=!item.classList.contains('open');
    q.addEventListener('click',()=>{
      const open=!item.classList.contains('open');
      item.classList.toggle('open',open);
      q.setAttribute('aria-expanded',String(open));
      a.hidden=!open;
    });
  });
}
function initScrollReveal(){
  const sel='.sec-head, .problema, .passo, .feat, .plan, .trust, .analytics-block, .faq-item, .cta-band, .hero-grid > *';
  const targets=document.querySelectorAll(sel);
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduced || !('IntersectionObserver' in window)){
    targets.forEach(el=>el.classList.add('is-visible'));return;
  }
  targets.forEach(el=>el.classList.add('reveal'));
  const io=new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if(e.isIntersecting){e.target.classList.add('is-visible');io.unobserve(e.target)}
    });
  },{threshold:0.12,rootMargin:'0px 0px -40px 0px'});
  // stagger leve por grupo (efeito cascata como na Eluria)
  targets.forEach((el,i)=>{el.style.setProperty('--reveal-delay',(i%6)*70+'ms');io.observe(el)});
}
function initPricing(){
  const toggle=document.getElementById('priceToggle');
  if(!toggle)return;
  // [meses, desconto, rótulo]
  const periods={mensal:[1,0,'/mês'],trimestral:[3,.05,'/trimestre'],semestral:[6,.10,'/semestre'],anual:[12,.20,'/ano']};
  const notes={mensal:'Cobrança todo mês, cancele quando quiser',trimestral:'Economize 5% pagando a cada 3 meses',
    semestral:'Economize 10% pagando a cada 6 meses',anual:'Economize 20% pagando uma vez por ano'};
  const note=document.getElementById('toggleNote');
  const fmt=c=>'R$ '+(c/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  function apply(p){
    const [m,d,lbl]=periods[p];
    document.querySelectorAll('.plan .price').forEach(el=>{
      const base=+el.dataset.base;
      const total=Math.round(base*m*(1-d));
      el.querySelector('.amount').textContent=fmt(total);
      el.querySelector('.per').textContent=lbl;
      const eq=el.querySelector('.equiv');
      eq.textContent = m>1 ? 'equivale a '+fmt(Math.round(total/m))+'/mês' : '';
    });
    if(note) note.textContent = notes[p];
    toggle.querySelectorAll('button').forEach(b=>{
      const active=b.dataset.period===p;
      b.classList.toggle('active',active);
      b.setAttribute('aria-pressed',String(active));
    });
    document.querySelectorAll('.plan a[data-plan]').forEach(a=>a.dataset.period=p);
  }
  toggle.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>apply(b.dataset.period)));
  apply('mensal');
}
document.addEventListener('DOMContentLoaded',()=>{
  initMobileMenu();initSmoothScroll();initFaqAccordion();initScrollReveal();initPricing();
});
