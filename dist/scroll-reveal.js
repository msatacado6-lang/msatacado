(() => {
  const main = document.querySelector('main');
  if (!main || !('IntersectionObserver' in window)) return;
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const pending = new Set();
  const seen = new WeakSet();
  const selector = '.section-head, .product-card, .wholesale > div:first-child, .step, .faq-layout > div:first-child, .faq-layout details, .store-banner > *, .info-page > *, .catalog-heading';
  function reveal(element) {
    element.classList.remove('scroll-pending');
    observer.unobserve(element);
    pending.delete(element);
  }
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => { if (entry.isIntersecting) reveal(entry.target); });
  }, { threshold: 0, rootMargin: '0px 0px -24px 0px' });
  function scan() {
    pending.forEach(element => { if (!element.isConnected) { observer.unobserve(element); pending.delete(element); } });
    if (preference.matches || location.pathname.startsWith('/msadm') || /^(#admin|#conta|#cadastro)/.test(location.hash)) return;
    main.querySelectorAll(selector).forEach(element => {
      if (seen.has(element)) return;
      seen.add(element);
      // Keep the initial viewport immediate; animate each lower element only once.
      if (element.getBoundingClientRect().top < innerHeight) return;
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
  preference.addEventListener('change', () => { if (preference.matches) [...pending].forEach(reveal); else scan(); });
  scan();
})();
