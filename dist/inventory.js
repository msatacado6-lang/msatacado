const stockSizes=['PP','P','M','G','GG','XG','XGG',...Array.from({length:15},(_,i)=>String(32+i*2))];
const availableStock=(id,size)=>products.find(p=>p.id===id)?.variants?.find(v=>v.size===size)?.quantity||0;
const inCart=(id,size)=>cart.find(i=>i.id===id&&i.size===size)?.qty||0;
function stockRow(size='M',quantity=0){return `<div class="stock-row"><label>Tamanho<select data-stock-size>${stockSizes.map(s=>`<option ${s===size?'selected':''}>${s}</option>`).join('')}</select></label><label>Unidades disponíveis<input data-stock-quantity type="number" min="0" max="99999" step="1" value="${quantity}" required></label><button type="button" data-remove-size aria-label="Remover tamanho">Remover</button></div>`;}
function stockEditor(p){return `<fieldset class="stock-editor" data-version="${p.inventoryVersion||0}"><legend>Estoque por tamanho</legend><p class="muted">Adicione a grade desta peça e informe quantas unidades estão disponíveis em cada tamanho. Zero aparece como esgotado.</p><div class="stock-rows">${(p.variants||[]).map(v=>stockRow(v.size,v.quantity)).join('')}</div><button type="button" class="btn outline" data-add-size>+ Adicionar tamanho</button><p class="muted">O pedido confirmado desconta estas unidades. Cancelar devolve o estoque. Quantidades deste ambiente local.</p></fieldset>`;}
function sizeChoices(p){return (p.variants||[]).length?p.variants.map(v=>`<button data-size="${v.size}" aria-pressed="false" ${v.quantity===0?'disabled':''}><strong>${v.size}</strong><small>${v.quantity===0?'Esgotado':v.quantity+' disponíveis'}</small></button>`).join(''):'<p class="muted">Grade ainda não cadastrada. Indisponível para pedido.</p>';}
function stockSummary(p){if(!p.variants?.length)return 'Grade a cadastrar';const available=p.variants.filter(v=>v.quantity>0);return available.length?'Disponível: '+available.map(v=>v.size).join(' · '):'Esgotado';}
document.addEventListener('click',e=>{
 const button=e.target.closest('button');if(!button||button.disabled)return;
 if(button.hasAttribute('data-add-size')){const rows=button.closest('fieldset').querySelector('.stock-rows');const used=[...rows.querySelectorAll('[data-stock-size]')].map(s=>s.value);const size=stockSizes.find(s=>!used.includes(s));if(!size)return;rows.insertAdjacentHTML('beforeend',stockRow(size));rows.lastElementChild.querySelector('select').focus();}
 if(button.hasAttribute('data-remove-size'))button.closest('.stock-row').remove();
 // Guard the legacy cart controls before they mutate quantities.
 const id=document.querySelector('[data-add]')?.dataset.add;
 if(button.hasAttribute('data-size')){quantity=1;document.querySelector('#product-qty').textContent=1;}
 if(button.hasAttribute('data-add')&&selectedSize&&quantity+inCart(id,selectedSize)>availableStock(id,selectedSize)){e.stopImmediatePropagation();toast('Quantidade acima do estoque disponível neste tamanho.');}
 if(button.dataset.qty==='1'&&selectedSize&&quantity+1+inCart(id,selectedSize)>availableStock(id,selectedSize)){e.stopImmediatePropagation();toast('Você atingiu o estoque disponível deste tamanho.');}
 if(button.hasAttribute('data-cart-change')&&button.dataset.delta==='1'){const item=cart[Number(button.dataset.cartChange)];if(item.qty>=availableStock(item.id,item.size)){e.stopImmediatePropagation();toast('Você atingiu o estoque disponível deste tamanho.');}}
},true);
