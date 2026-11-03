const stockSizes=['PP','P','M','G','GG','XG','XGG',...Array.from({length:15},(_,i)=>String(32+i*2))];
const availableStock=(id,size)=>products.find(p=>p.id===id)?.variants?.find(v=>v.size===size)?.quantity||0;
const inCart=(id,size)=>cart.find(i=>i.id===id&&i.size===size)?.qty||0;
function stockRow(size='M',quantity=0){return `<div class="stock-row"><label>Tamanho<select data-stock-size>${stockSizes.map(s=>`<option ${s===size?'selected':''}>${s}</option>`).join('')}</select></label><label>Quantidade<input data-stock-quantity type="number" min="0" max="99999" step="1" value="${quantity}" required></label><button type="button" data-remove-size aria-label="Remover tamanho">Remover</button></div>`;}
function stockEditor(p){return `<fieldset class="stock-editor" data-version="${p.inventoryVersion||0}"><legend>Estoque por tamanho</legend><p class="muted">Confira os tamanhos e as quantidades cadastradas.</p><div class="stock-rows">${(p.variants||[]).map(v=>stockRow(v.size,v.quantity)).join('')}</div><button type="button" class="btn outline" data-add-size>+ Adicionar tamanho</button><p class="muted">O pedido confirmado desconta estas unidades. Cancelar devolve o estoque. Quantidades deste ambiente local.</p></fieldset>`;}
function sizeChoices(p){return (p.variants||[]).length?p.variants.map(v=>`<button data-size="${esc(v.size)}" aria-pressed="false" ${v.quantity===0?'disabled':''}><strong>${esc(v.label||v.size)}</strong>${usesFatek()?'<span>'+esc(priceLabel(v.price))+'</span>':''}<small>${v.quantity===0?'Esgotado':v.quantity+' un.'}</small></button>`).join(''):'<p class="muted">Grade ainda não cadastrada. Indisponível para pedido.</p>';}
function stockSummary(p){if(!p.variants?.length)return 'Grade a cadastrar';const available=p.variants.filter(v=>v.quantity>0);return available.length?'Disponível: '+available.map(v=>v.label||v.size).join(' · '):'Esgotado';}
document.addEventListener('click',e=>{
 const button=e.target.closest('button');if(!button||button.disabled)return;
 if(button.hasAttribute('data-add-size')){const rows=button.closest('fieldset').querySelector('.stock-rows');const used=[...rows.querySelectorAll('[data-stock-size]')].map(s=>s.value);const size=stockSizes.find(s=>!used.includes(s));if(!size)return;rows.insertAdjacentHTML('beforeend',stockRow(size));rows.lastElementChild.querySelector('select').focus();}
 if(button.hasAttribute('data-remove-size'))button.closest('.stock-row').remove();
 // Guard the legacy cart controls before they mutate quantities.
 const id=document.querySelector('[data-add]')?.dataset.add;
 if(button.hasAttribute('data-size')){const remaining=Math.min(99-inCart(id,button.dataset.size),availableStock(id,button.dataset.size)-inCart(id,button.dataset.size));quantity=Math.max(1,Math.min(quantity,remaining));const input=document.querySelector('#product-qty');input.value=quantity;input.max=Math.max(1,remaining);}
 if(button.hasAttribute('data-add')&&selectedSize&&quantity+inCart(id,selectedSize)>Math.min(99,availableStock(id,selectedSize))){e.stopImmediatePropagation();toast('Quantidade acima do estoque disponível neste tamanho.');}
 if(button.dataset.qty==='1'&&selectedSize&&quantity+1+inCart(id,selectedSize)>Math.min(99,availableStock(id,selectedSize))){e.stopImmediatePropagation();toast('Você atingiu o estoque disponível deste tamanho.');}
 if(button.hasAttribute('data-cart-change')&&button.dataset.delta==='1'){const item=cart[Number(button.dataset.cartChange)];if(item.qty>=availableStock(item.id,item.size)){e.stopImmediatePropagation();toast('Você atingiu o estoque disponível deste tamanho.');}}
},true);

document.addEventListener('input',e=>{if(e.target.id!=='product-qty')return;const value=Number(e.target.value);if(Number.isInteger(value)&&value>0)quantity=value;});
document.addEventListener('change',e=>{if(e.target.id!=='product-qty')return;const id=document.querySelector('[data-add]').dataset.add;const limit=selectedSize?Math.max(1,Math.min(99,availableStock(id,selectedSize))-inCart(id,selectedSize)):99;const value=Number(e.target.value);quantity=Math.max(1,Math.min(limit,Number.isFinite(value)?Math.floor(value):1));e.target.value=quantity;});
