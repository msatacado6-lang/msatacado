let shippingCep='';try{shippingCep=localStorage.getItem('ms-shipping-cep')||'';}catch{}
let cartShippingQuotes=null,cartShippingError='',cartShippingLoading=false,selectedShipping=null,cartShippingSignature='';
let productShippingQuotes=null,productShippingError='',productShippingLoading=false,productShippingFor='';
let adminShippingConfig=null;
const formatCep=v=>{const d=String(v||'').replace(/\D/g,'').slice(0,8);return d.length>5?d.slice(0,5)+'-'+d.slice(5):d;};
const formatBrl=n=>n==null?'A combinar':Number(n)===0?'Grátis':Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const daysLabel=(d,id)=>id==='pickup'?'Retirada local':d==null?'Prazo a combinar':d===0?'Hoje':d===1?'1 dia útil':d+' dias úteis';
const currentCartSignature=()=>cart.map(x=>x.id+':'+x.size+':'+x.qty).join('|')+'@'+shippingCep.replace(/\D/g,'');

function renderQuoteList(quotes,error,loading,selectable=false){
 if(loading)return '<p class="shipping-status" role="status">Calculando opções de entrega…</p>';
 if(error&&(!quotes||!quotes.length))return `<p class="shipping-error" role="alert">${esc(error)}</p>`;
 if(!quotes||!quotes.length)return '';
 return `<div class="shipping-quotes" role="${selectable?'radiogroup':'list'}" aria-label="Opções de entrega">${quotes.map(q=>{
  const checked=selectable&&selectedShipping?.id===q.id;
  return selectable
   ?`<label class="shipping-option ${checked?'selected':''}"><input type="radio" name="cart-shipping-choice" value="${esc(q.id)}" ${checked?'checked':''} data-select-shipping="${esc(q.id)}"><div class="shipping-option-main"><strong>${esc(q.name)}</strong><small>${esc(daysLabel(q.days,q.id))}${q.note?' · '+esc(q.note):''}</small></div><span class="shipping-price">${esc(formatBrl(q.price))}</span></label>`
   :`<div class="shipping-option" role="listitem"><div class="shipping-option-main"><strong>${esc(q.name)}</strong><small>${esc(daysLabel(q.days,q.id))}${q.note?' · '+esc(q.note):''}</small></div><span class="shipping-price">${esc(formatBrl(q.price))}</span></div>`;
 }).join('')}</div>${error?`<small class="shipping-note">${esc(error)}</small>`:''}`;
}

function productShippingBox(p){
 if(usesFatek()&&!integrationState.info?.store.policy.shippingEnabled)return '<p class="shipping-note">Confira as opções de recebimento na revisão do pedido.</p>';
 const simQty=Math.max(quantity||1,minimumPieces());
 const showQuotes=productShippingFor===p.id?productShippingQuotes:null;
 const showErr=productShippingFor===p.id?productShippingError:'';
 return `<div class="shipping-box" data-product-shipping="${esc(p.id)}"><div class="shipping-head"><span>FRETE E PRAZO</span><small>Simulação para <b data-ship-qty>${simQty}</b> peças</small></div><div class="shipping-form"><input type="text" inputmode="numeric" maxlength="9" placeholder="Digite seu CEP (00000-000)" value="${esc(formatCep(shippingCep))}" aria-label="CEP para cálculo de frete" data-cep-input="product"><button type="button" class="btn outline" data-calc-shipping="product" data-product-id="${esc(p.id)}" ${productShippingLoading?'disabled':''}>${productShippingLoading?'Calculando…':'Calcular'}</button></div><div data-shipping-results="product">${renderQuoteList(showQuotes,showErr,productShippingLoading,false)}</div></div>`;
}

function cartShippingBox(){
 if(usesFatek())return '';
 if(cartShippingSignature&&cartShippingSignature!==currentCartSignature()){
  cartShippingQuotes=null;cartShippingError='';selectedShipping=null;cartShippingSignature='';
 }
 return `<div class="shipping-box cart-shipping-box"><div class="shipping-head"><span>CALCULAR FRETE</span><small>Melhor Envio / Retirada</small></div><div class="shipping-form"><input type="text" inputmode="numeric" maxlength="9" placeholder="CEP de entrega (00000-000)" value="${esc(formatCep(shippingCep))}" aria-label="CEP de entrega do pedido" data-cep-input="cart"><button type="button" class="btn outline" data-calc-shipping="cart" ${cartShippingLoading?'disabled':''}>${cartShippingLoading?'Calculando…':'Calcular'}</button></div><div data-shipping-results="cart">${renderQuoteList(cartShippingQuotes,cartShippingError,cartShippingLoading,true)}</div></div>`;
}

function cartShippingSummaryRow(){
 if(!selectedShipping)return '';
 return `<div class="summary-row shipping-summary-row"><span>Entrega · ${esc(selectedShipping.name)}</span><b>${esc(formatBrl(selectedShipping.price))}</b></div>`;
}

function orderShippingBadge(o){
 if(!o?.shipping||!o.shipping.name)return '';
 const s=o.shipping;
 return `<p class="order-shipping">Entrega: <strong>${esc(s.name)}</strong> · ${esc(formatBrl(s.price))}${s.days?` · ${esc(daysLabel(s.days))}`:''}${s.cep?` · CEP ${esc(formatCep(s.cep))}`:''}</p>`;
}

async function runShippingCalc(mode,productId){
 if(usesFatek()&&mode!=='product')return;
 const input=document.querySelector(`[data-cep-input="${mode}"]`);
 const rawCep=(input?input.value:shippingCep).replace(/\D/g,'');
 if(rawCep.length!==8){
  const msg='Informe um CEP válido com 8 dígitos.';
  if(mode==='cart'){cartShippingError=msg;cartShippingQuotes=null;renderCart();}
  else{productShippingFor=productId;productShippingError=msg;productShippingQuotes=null;const box=document.querySelector('[data-shipping-results="product"]');if(box)box.innerHTML=renderQuoteList(null,msg,false,false);}
  return;
 }
 shippingCep=rawCep;
 try{localStorage.setItem('ms-shipping-cep',shippingCep);}catch{}
 if(mode==='cart'){
  cartShippingLoading=true;cartShippingError='';renderCart();
  try{
   const res=await api('shipping/calculate','POST',{cep:rawCep,items:cart.map(x=>({id:x.id,qty:x.qty}))});
   cartShippingQuotes=res.quotes||[];
   cartShippingError=res.carrierError||'';
   cartShippingSignature=currentCartSignature();
   if(selectedShipping){selectedShipping=cartShippingQuotes.find(q=>q.id===selectedShipping.id)||null;}
   if(!selectedShipping&&cartShippingQuotes.length){const q=cartShippingQuotes[0];selectedShipping={cep:rawCep,id:q.id,name:q.name,price:q.price,days:q.days};}
  }catch(err){
   cartShippingQuotes=null;selectedShipping=null;cartShippingError=err.message||'Não foi possível calcular o frete.';
  }finally{
   cartShippingLoading=false;renderCart();
  }
 }else{
  productShippingLoading=true;productShippingFor=productId;productShippingError='';
  const box=document.querySelector('[data-shipping-results="product"]');
  if(box)box.innerHTML=renderQuoteList(null,'',true,false);
  try{
   const simQty=Math.max(quantity||1,minimumPieces());
   let res;
   if(usesFatek()){
    if(!selectedSize)throw Error('Escolha a cor e o tamanho antes de consultar a entrega.');
    const session=await api('session');if(!session.user)throw Error('Entre na sua conta para consultar a entrega.');
    const quote=await integrationState.client.quote({items:[{productId,variantId:selectedSize,quantity:simQty}],delivery:{kind:'DELIVERY',postalCode:rawCep}});
    res={quotes:quote.options,carrierError:''};
   }else res=await api('shipping/calculate','POST',{cep:rawCep,items:[{id:productId,qty:simQty}]});
   productShippingQuotes=res.quotes||[];
   productShippingError=res.carrierError||'';
  }catch(err){
   productShippingQuotes=null;productShippingError=err.message||'Não foi possível calcular o frete.';
  }finally{
   productShippingLoading=false;
   const target=document.querySelector('[data-shipping-results="product"]');
   if(target)target.innerHTML=renderQuoteList(productShippingQuotes,productShippingError,false,false);
  }
 }
}

function shippingAdmin(){
 const cfg=adminShippingConfig||{originCep:'95900018',environment:'production',hasToken:false,tokenSource:'none',tokenHint:'Não configurado',pickupEnabled:true,pickupLabel:'Retirada na loja · Lajeado/RS',defaultWidth:28,defaultLength:36,defaultHeight:4,defaultWeight:0.5,insurancePerPiece:75,categoryWeights:{'Calças':0.55,'Shorts':0.35}};
 const cats=categoryNames();
 return `<div class="shipping-admin"><div class="order-card shipping-status-card"><div class="order-heading"><div><strong>Integração Melhor Envio</strong><p>${cfg.hasToken?`Token ativo (${esc(cfg.tokenHint)}) · Ambiente de ${cfg.environment==='sandbox'?'testes (Sandbox)':'produção'}`:'Token ainda não configurado · Exibindo retirada local até conectar o Melhor Envio'}</p></div><span class="status-pill">${cfg.hasToken?'Conectado':'Pendente'}</span></div></div><form data-shipping-admin-form class="order-card"><h2>Credenciais e origem</h2><div class="product-fields-row">${field('CEP de origem (loja)','originCep',formatCep(cfg.originCep),'text','required maxlength="9" placeholder="95900-018"')}<label class="field">Ambiente Melhor Envio<select name="environment"><option value="production" ${cfg.environment==='production'?'selected':''}>Produção (melhorenvio.com.br)</option><option value="sandbox" ${cfg.environment==='sandbox'?'selected':''}>Sandbox / Testes</option></select></label><label class="field">Token Bearer do Melhor Envio<input name="token" type="password" autocomplete="off" placeholder="${cfg.hasToken?'Token salvo (preencha apenas para trocar)':'Cole aqui o token gerado no Melhor Envio'}"></label></div>${cfg.tokenSource==='panel'?'<label class="shipping-toggle"><input type="checkbox" name="clearToken" value="1"> Remover token salvo no painel</label>':''}<h2>Retirada na loja física</h2><div class="product-fields-row"><label class="field shipping-checkbox-field">Disponibilidade<span class="shipping-toggle"><input type="checkbox" name="pickupEnabled" ${cfg.pickupEnabled?'checked':''}> Permitir retirada gratuita em Lajeado/RS</span></label>${field('Nome da opção de retirada','pickupLabel',cfg.pickupLabel,'text','required minlength="2" maxlength="80"')}</div><h2>Medidas padrão e peso por categoria</h2><div class="product-fields-row">${field('Largura do pacote (cm)','defaultWidth',cfg.defaultWidth,'number','required min="11" max="100" step="1"')}${field('Comprimento (cm)','defaultLength',cfg.defaultLength,'number','required min="16" max="100" step="1"')}${field('Altura por peça (cm)','defaultHeight',cfg.defaultHeight,'number','required min="2" max="50" step="1"')}</div><div class="product-fields-row">${field('Valor segurado por peça (R$)','insurancePerPiece',cfg.insurancePerPiece,'number','required min="0" max="5000" step="0.01"')}${field('Peso padrão (kg)','defaultWeight',cfg.defaultWeight,'number','required min="0.05" max="15" step="0.01"')}</div><div class="shipping-weights-grid">${cats.map(c=>`<label class="field">Peso · ${esc(c)} (kg)<input type="number" data-category-weight="${esc(c)}" value="${esc(cfg.categoryWeights?.[c]??cfg.defaultWeight??0.5)}" required min="0.05" max="15" step="0.01"></label>`).join('')}</div><p class="form-error" role="alert"></p><div class="product-form-actions"><button type="submit" class="btn dark">Salvar configurações de frete</button></div></form></div>`;
}

document.addEventListener('input',e=>{
 if(e.target.matches('[data-cep-input]')){
  e.target.value=formatCep(e.target.value);
 }
});
document.addEventListener('keydown',e=>{
 if(e.key==='Enter'&&e.target.matches('[data-cep-input]')){
  e.preventDefault();
  const mode=e.target.dataset.cepInput;
  const btn=document.querySelector(`[data-calc-shipping="${mode}"]`);
  if(btn)btn.click();
 }
});
document.addEventListener('click',e=>{
 const btn=e.target.closest('[data-calc-shipping]');
 if(btn){
  runShippingCalc(btn.dataset.calcShipping,btn.dataset.productId||'');
  return;
 }
 const qtyBtn=e.target.closest('[data-qty]');
 if(qtyBtn){
  const el=document.querySelector('[data-ship-qty]');
  if(el)setTimeout(()=>{el.textContent=String(Math.max(quantity||1,minimumPieces()));},0);
 }
});
document.addEventListener('change',e=>{
 const radio=e.target.closest('[data-select-shipping]');
 if(!radio||!cartShippingQuotes)return;
 const chosen=cartShippingQuotes.find(q=>q.id===radio.dataset.selectShipping);
 if(chosen){
  selectedShipping={cep:shippingCep,id:chosen.id,name:chosen.name,price:chosen.price,days:chosen.days};
  renderCart();
 }
});
document.addEventListener('submit',async e=>{
 const form=e.target;
 if(!form.matches('[data-shipping-admin-form]'))return;
 if(usesFatek()){e.preventDefault();return;}
 e.preventDefault();
 const button=form.querySelector('[type="submit"]'),error=form.querySelector('.form-error');
 button.disabled=true;error.textContent='';
 try{
  const fd=new FormData(form);
  const categoryWeights={};
  form.querySelectorAll('[data-category-weight]').forEach(inp=>{categoryWeights[inp.dataset.categoryWeight]=Number(inp.value);});
  const payload={
   originCep:fd.get('originCep'),
   environment:fd.get('environment'),
   token:fd.get('token')||'',
   clearToken:fd.get('clearToken')==='1',
   pickupEnabled:form.querySelector('[name="pickupEnabled"]').checked,
   pickupLabel:fd.get('pickupLabel'),
   defaultWidth:Number(fd.get('defaultWidth')),
   defaultLength:Number(fd.get('defaultLength')),
   defaultHeight:Number(fd.get('defaultHeight')),
   insurancePerPiece:Number(fd.get('insurancePerPiece')),
   defaultWeight:Number(fd.get('defaultWeight')),
   categoryWeights
  };
  adminShippingConfig=await api('admin/shipping','PATCH',payload);
  await route();
  toast('Configurações de frete salvas.');
 }catch(err){
  error.textContent=err.message;
 }finally{
  button.disabled=false;
 }
});
