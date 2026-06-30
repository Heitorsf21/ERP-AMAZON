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
document.addEventListener('DOMContentLoaded',()=>{
  initMobileMenu();initSmoothScroll();initFaqAccordion();initScrollReveal();
});
