let fatekCartInitialized = false, fatekQuote = null;
function initializeFatekCart() {
  if (fatekCartInitialized) return;
  cartStorageKey = 'ms-fatek-cart-v1:' + integrationState.info.store.name + ':' + location.origin;
  try {
    const values = JSON.parse(localStorage.getItem(cartStorageKey) || '[]');
    const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
    cart = Array.isArray(values) ? values.filter(x => x && uuid.test(x.id) && uuid.test(x.size) && Number.isInteger(x.qty) && x.qty > 0 && x.qty <= 99) : [];
  } catch { cart = []; }
  fatekCartInitialized = true; save();
}
function fatekRecovery(reset) {
  return `<section class="info-page"><h1>${reset ? 'Definir nova senha' : 'Recuperar acesso'}</h1><form data-account-form="${reset ? 'new-password' : 'recover'}">${reset ? field('Nova senha','password','','password','required minlength="10" maxlength="128" autocomplete="new-password"') : field('E-mail','email','','email','required autocomplete="email"')}<p class="form-error" role="status"></p><button class="btn dark">${reset ? 'Salvar senha' : 'Receber instruções'}</button></form><p><a href="#conta">Voltar ao acesso</a></p></section>`;
}
function renderFatekCart() {
  fatekQuote = null;
  const n = cart.reduce((total, item) => total + item.qty, 0), min = minimumPieces();
  const lines = cart.map((item, index) => {
    const product = products.find(p => p.id === item.id), variant = product?.variants.find(v => v.size === item.size);
    return `<div class="cart-line"><img src="${productImage(product?.image || 'placeholder.svg')}" alt=""><div><h3>${esc(product?.name || 'Produto indisponível')}</h3><p>${esc(variant?.label || 'Combinação indisponível')}</p><p>${esc(priceLabel(variant?.price))}</p>${!variant || item.qty > variant.quantity ? '<p class="stock-warning">Confira a disponibilidade antes de continuar.</p>' : ''}<div class="cart-line-actions"><div class="quantity"><button data-cart-change="${index}" data-delta="-1" aria-label="Diminuir quantidade">−</button><span>${item.qty}</span><button data-cart-change="${index}" data-delta="1" aria-label="Aumentar quantidade">+</button></div><button class="remove" data-remove="${index}">Remover</button></div></div></div>`;
  }).join('');
  document.querySelector('#cart-body').innerHTML = n ? `<p class="hint">${n} peça(s) · mínimo de ${min}${integrationState.info.store.policy.minSubtotal ? ' · valor mínimo '+esc(priceLabel(integrationState.info.store.policy.minSubtotal)) : ''}</p>${lines}<button class="btn dark" data-review ${n < min ? 'disabled' : ''}>Consultar entrega e revisar</button>` : '<div class="empty"><h3>Sua sacola está vazia</h3><button class="btn" data-shop>Ver catálogo</button></div>';
}
function fatekCheckout() {
  const policy = integrationState.info.store.policy;
  const options = [policy.shippingEnabled ? '<option value="DELIVERY">Entrega por CEP</option>' : '', policy.pickupEnabled ? '<option value="PICKUP">Retirada</option>' : '', policy.shippingOnRequest ? '<option value="ARRANGE">Combinar entrega</option>' : ''].join('');
  if (!options) { document.querySelector('#cart-body').innerHTML = '<p>As opções de entrega ainda precisam ser configuradas pela loja.</p><button class="btn outline" data-back-cart>Voltar</button>'; return; }
  document.querySelector('#cart-body').innerHTML = `<form data-fatek-quote><h3>Contato e entrega</h3>${field('WhatsApp com DDD','phone','','tel','required autocomplete="tel"')}<label class="field">Forma de recebimento<select name="kind">${options}</select></label><div data-delivery-fields>${field('CEP','postalCode','','text','inputmode="numeric" autocomplete="postal-code"')}${field('Rua','street','','text','autocomplete="address-line1"')}${field('Número','number')}${field('Bairro','district')}${field('Complemento','complement')}</div><p class="form-error" role="alert"></p><button class="btn dark">Consultar e revisar pedido</button><button type="button" class="btn outline" data-back-cart>Voltar à sacola</button></form>`;
}
function showFatekReceipt(order) {
  // An uncertain request may be retried after the shopper edits their cart.
  // Remove only the quantities in this receipt; preserve newly added items.
  cart = cart.map(item => ({ ...item, qty: item.qty - order.items.filter(i => i.productId === item.id && i.variantId === item.size).reduce((n, i) => n + i.quantity, 0) })).filter(i => i.qty > 0);
  save(); fatekQuote = null;
  document.querySelector('#cart-body').innerHTML = `<div class="success"><h3>Pedido ${esc(order.reference)} registrado</h3><p>Pedido recebido. A equipe confirmará disponibilidade, pagamento e entrega.</p><p>${order.total == null ? 'Total a combinar' : esc(priceLabel(order.total))}</p>${order.whatsappUrl ? `<a class="btn dark" href="${esc(order.whatsappUrl)}" target="_blank" rel="noopener">Enviar pedido pelo WhatsApp</a>` : '<p>Consulte o andamento em Meus pedidos.</p>'}<button class="btn outline" data-fatek-orders>Meus pedidos</button></div>`;
}
function pendingMessage(error, target) {
  target.innerHTML = `<p role="alert">${esc(integrationState.client.friendly(error))}</p><button type="button" class="btn outline" data-fatek-retry-order>Conferir o mesmo pedido</button><button type="button" class="btn outline" data-fatek-orders>Meus pedidos</button>`;
}
document.addEventListener('click', async event => {
  if (!usesFatek()) return;
  const button = event.target.closest('button'); if (!button) return;
  if (button.hasAttribute('data-fatek-orders')) { event.stopImmediatePropagation(); dialog.close(); location.hash = 'conta'; await route(); return; }
  if (!button.hasAttribute('data-review') && !button.hasAttribute('data-save-order') && !button.hasAttribute('data-fatek-retry-order')) return;
  event.stopImmediatePropagation(); button.disabled = true;
  try {
    const session = await api('session');
    if (!session.user) { dialog.close(); if(location.hash === '#conta')await route();else location.hash = 'conta'; return; }
    if (button.hasAttribute('data-fatek-retry-order')) { showFatekReceipt(await integrationState.client.retry()); return; }
    if (await integrationState.client.pending()) { pendingMessage({ code: 'PENDING_ORDER' }, document.querySelector('#cart-body')); return; }
    if (cart.reduce((n, i) => n + i.qty, 0) < minimumPieces()) return;
    fatekCheckout();
  } catch (error) { toast(integrationState.client.friendly(error)); }
  finally { button.disabled = false; }
}, true);
document.addEventListener('submit', async event => {
  if (!usesFatek()) return;
  const form = event.target;
  if (!form.matches('[data-fatek-quote],[data-fatek-confirm]')) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const button = form.querySelector('[type=submit],button:not([type])'), errorBox = form.querySelector('.form-error');
  if (button.disabled) return; button.disabled = true; errorBox.textContent = '';
  try {
    if (form.hasAttribute('data-fatek-quote')) {
      const values = Object.fromEntries(new FormData(form));
      const input = { items: cart.map(i => ({ productId: i.id, variantId: i.size, quantity: i.qty })),
        delivery: values.kind === 'DELIVERY' ? { kind: 'DELIVERY', postalCode: values.postalCode } : { kind: values.kind } };
      const quote = await integrationState.client.quote(input);
      fatekQuote = { quote, values, cart: JSON.stringify(cart) };
      document.querySelector('#cart-body').innerHTML = `<form data-fatek-confirm><h3>Confira o pedido</h3>${quote.items.map(i => `<p>${esc(i.name)} · ${esc(i.label)} · ${i.quantity} un. × ${esc(priceLabel(i.unitPrice))}</p>`).join('')}<p>Produtos: ${esc(priceLabel(quote.subtotal))}</p><label class="field">Entrega<select name="shippingOption" required>${quote.options.map(option => `<option value="${esc(option.id)}">${esc(option.name)} — ${option.price == null ? 'a combinar' : esc(priceLabel(option.price))}${option.days == null ? ' · prazo a combinar' : ' · '+option.days+' dia(s)'}</option>`).join('')}</select></label><p>Válido até ${esc(new Date(quote.expiresAt).toLocaleTimeString('pt-BR'))}. O pedido não baixa estoque nem confirma pagamento.</p><div class="form-error" role="alert"></div><button type="submit" class="btn dark" ${quote.options.length ? '' : 'disabled'}>Registrar pedido</button><button type="button" class="btn outline" data-back-cart>Voltar à sacola</button></form>`;
    } else {
      if (!fatekQuote || fatekQuote.cart !== JSON.stringify(cart)) throw Object.assign(Error(), { code: 'QUOTE_STALE', status: 409 });
      const { quote, values } = fatekQuote;
      const input = { quoteId: quote.id, shippingOption: new FormData(form).get('shippingOption'), phone: values.phone,
        ...(values.kind === 'DELIVERY' ? { address: { street: values.street, number: values.number, district: values.district, complement: values.complement } } : {}) };
      showFatekReceipt(await integrationState.client.submit(input));
    }
  } catch (error) {
    let pending = false; try { pending = Boolean(await integrationState.client.pending()); } catch {}
    if (pending) pendingMessage(error, errorBox); else errorBox.textContent = integrationState.client.friendly(error);
  } finally { button.disabled = false; }
}, true);
