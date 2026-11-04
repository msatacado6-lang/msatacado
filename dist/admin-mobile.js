document.addEventListener('click',event=>{
 const toggle=event.target.closest('.admin-menu-toggle');
 if(toggle){const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));toggle.closest('.account-sidebar').classList.toggle('admin-menu-open',open);}
});
document.addEventListener('keydown',event=>{
 if(event.key!=='Escape')return;
 const toggle=document.querySelector('.admin-menu-toggle[aria-expanded="true"]');
 if(toggle){toggle.setAttribute('aria-expanded','false');toggle.closest('.account-sidebar').classList.remove('admin-menu-open');toggle.focus();}
});
