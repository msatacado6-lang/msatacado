(() => {
  const main = document.querySelector('main');
  if (!main || !('IntersectionObserver' in window)) return;
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const pending = new Set();
  const seen = new WeakSet();
  const selector = '.hero-copy > *, .hero-photo, .section-head, .product-card, .wholesale > div:first-child, .step, .faq-layout > div:first-child, .faq-layout details, .store-banner > *, .info-page > *, .catalog-heading';
  function reveal(element) {
    element.classList.remove('scroll-pending');
    observer.unobserve(element);
    pending.delete(element);
  }
  const observer = new IntersectionObserver(entries => {
    entries.filter(entry => entry.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top || a.boundingClientRect.left-b.boundingClientRect.left).forEach((entry,index) => { entry.target.style.setProperty('--reveal-delay', Math.min(index * 90, 270) + 'ms'); reveal(entry.target); });
  }, { threshold: 0, rootMargin: '0px 0px -24px 0px' });
  function scan() {
    pending.forEach(element => { if (!element.isConnected) { observer.unobserve(element); pending.delete(element); } });
    if (preference.matches || location.pathname.startsWith('/msadm') || /^(#admin|#conta|#cadastro)/.test(location.hash)) return;
    main.querySelectorAll(selector).forEach(element => {
      if (seen.has(element)) return;
      seen.add(element);
      const kind=element.matches('.product-card, .hero-photo')?'image':element.matches('.section-head, .catalog-heading, .wholesale > div:first-child, .faq-layout > div:first-child')?'side':'rise';
      element.dataset.revealKind=kind;
      if (element.getBoundingClientRect().top < innerHeight) {
        if(element.matches('.hero-copy > *, .hero-photo') && element.animate){
          const index=element.matches('.hero-photo')?1:Array.from(element.parentElement.children).indexOf(element);
          element.animate([{opacity:0,transform:kind==='image'?'scale(1.035)':'translateY(28px)'},{opacity:1,transform:'none'}],{duration:850,delay:index*95,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'});
        }
        return;
      }
      element.classList.add('scroll-reveal', 'scroll-pending');
      pending.add(element);
      observer.observe(element);
    });
  }
  new MutationObserver(scan).observe(main, { childList: true, subtree: true });
  main.addEventListener('focusin', event => {
    const target = event.target.closest('.scroll-pending');
    if (target) reveal(target);
  });
  preference.addEventListener('change', () => { if (preference.matches) { [...pending].forEach(reveal); main.getAnimations({subtree:true}).forEach(animation=>animation.cancel()); } else scan(); });
  scan();
})();
