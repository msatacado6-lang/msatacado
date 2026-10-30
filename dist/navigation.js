(() => {
 const toggle=document.querySelector('.menu-toggle');
 const navigation=document.querySelector('#main-navigation');
 const mobile=matchMedia('(max-width:800px)');
 function close(restoreFocus=false){
  navigation.classList.remove('is-open');
  toggle.setAttribute('aria-expanded','false');
  toggle.setAttribute('aria-label','Abrir menu');
  if(restoreFocus)toggle.focus();
 }
 toggle.addEventListener('click',()=>{
  const open=toggle.getAttribute('aria-expanded')!=='true';
  navigation.classList.toggle('is-open',open);
  toggle.setAttribute('aria-expanded',String(open));
  toggle.setAttribute('aria-label',open?'Fechar menu':'Abrir menu');
 });
 navigation.addEventListener('click',e=>{if(mobile.matches&&e.target.closest('a'))close(true);});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&toggle.getAttribute('aria-expanded')==='true')close(true);});
 document.addEventListener('click',e=>{if(!e.target.closest('header'))close();});
 window.addEventListener('hashchange',()=>close());
 mobile.addEventListener('change',()=>close());
})();
