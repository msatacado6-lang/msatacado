function editorAttemptKey() { return 'ms-fatek-product-intent-v1:' + location.origin + ':' + currentUser.id; }
function editorRow(variant, options) {
  return `<div class="stock-row" data-editor-variant="${esc(variant.id || '')}">${options.map((o, i) => `<label>${esc(o.name)}<input data-grade-value="${i}" value="${esc(variant.values[i] || '')}" required maxlength="80"></label>`).join('')}<label>Saldo no ERP<input value="${variant.stockQty || 0}" readonly aria-readonly="true"></label><button type="button" data-remove-editor-row ${variant.stockQty > 0 ? 'disabled title="Variação com saldo: ajuste no ERP antes de remover"' : ''}>Remover</button></div>`;
}
async function openFatekProductEditor(id) {
  let modal = document.querySelector('#product-dialog');
  if (!modal) { modal = document.createElement('dialog'); modal.id = 'product-dialog'; modal.className = 'product-modal'; document.body.append(modal); }
  modal.innerHTML = '<p role="status">Carregando cadastro do ERP…</p>'; if (!modal.open) modal.showModal();
  try {
    if (!integrationState.client || !integrationState.client.canEditProducts) throw Error('O cadastro pelo painel ainda precisa ser liberado pelo responsável.');
    let pending = null;
    if (!id) { const raw = sessionStorage.getItem(editorAttemptKey()); if (raw) pending = JSON.parse(raw); }
    const record = id ? await api('admin/products/' + id) : pending?.input || {
      name: '', category: '', description: '', costPrice: '', sellPrice: '', catalogVisible: false,
      grade: { options: [{ name: 'Cor', values: [] }, { name: 'Tamanho', values: [] }], variants: [] },
    };
    const options = record.grade.options;
    modal.innerHTML = `<div class="dialog-head"><h2>${id ? 'Editar peça' : 'Adicionar peça'}</h2><button type="button" data-close-product aria-label="Fechar cadastro">×</button></div><form data-fatek-product="${id || 'new'}">${field('Nome da peça','name',record.name,'text','required maxlength="200"')}${field('Categoria','category',record.category || '','text','maxlength="120"')}${field('Preço de custo','costPrice',record.costPrice,'number','required min="0" step="0.01"')}${field('Preço de venda','sellPrice',record.sellPrice,'number','required min="0" step="0.01"')}<label class="field">Descrição<textarea name="description" maxlength="500">${esc(record.description || '')}</textarea></label><label><input type="checkbox" name="catalogVisible" ${record.catalogVisible ? 'checked' : ''}> Exibir no catálogo</label><fieldset><legend>Fotos da peça</legend><p class="muted">Até 8 fotos JPG, PNG ou WebP, até 8 MB cada.</p><input type="file" data-editor-photos multiple accept="image/jpeg,image/png,image/webp"></fieldset><fieldset><legend>Grade</legend><p class="muted">O saldo é consultado do ERP. Registre entradas e ajustes no ERP; salvar o cadastro não muda o estoque.</p><div data-editor-rows>${record.grade.variants.map(v => editorRow(v, options)).join('')}</div><button type="button" class="btn outline" data-add-editor-row>Adicionar combinação</button></fieldset><p class="muted">Dados fiscais e demais configurações avançadas continuam no ERP e são preservados ao salvar aqui.</p><p class="form-error" role="alert"></p><div class="product-form-actions"><button type="button" class="btn outline" data-close-product>Cancelar</button><button type="submit" class="btn dark">Salvar peça no ERP</button></div></form>`;
    const form = modal.querySelector('form'); form.snapshot = record; form.pendingAttempt = pending;
    modal.oncancel = e => { if (form.dataset.saving) e.preventDefault(); };
  } catch (error) { modal.innerHTML = `<p role="alert">${esc(error.message)}</p><button type="button" class="btn outline" data-close-product>Fechar</button>`; }
}
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button || !usesFatek()) return;
  if (button.hasAttribute('data-add-editor-row')) {
    const form = button.closest('form');
    form.querySelector('[data-editor-rows]').insertAdjacentHTML('beforeend', editorRow({ values: [] }, form.snapshot.grade.options));
  }
  if (button.hasAttribute('data-remove-editor-row')) button.closest('[data-editor-variant]').remove();
});
document.addEventListener('submit', async event => {
  const form = event.target; if (!form.matches('[data-fatek-product]')) return;
  event.preventDefault(); event.stopImmediatePropagation(); if (form.dataset.saving) return;
  form.dataset.saving = 'true'; const button = form.querySelector('[type=submit]'), message = form.querySelector('.form-error'); button.disabled = true; message.textContent = '';
  try {
    const values = Object.fromEntries(new FormData(form)), snapshot = form.snapshot;
    const variants = [...form.querySelectorAll('[data-editor-variant]')].map(row => {
      const previous = snapshot.grade.variants.find(v => v.id && v.id === row.dataset.editorVariant);
      const { stockQty, ...metadata } = previous || {};
      return { ...metadata, values: [...row.querySelectorAll('[data-grade-value]')].map(i => i.value.trim()) };
    });
    const input = { name: values.name, category: values.category, description: values.description,
      costPrice: Number(values.costPrice), sellPrice: Number(values.sellPrice), catalogVisible: values.catalogVisible === 'on',
      grade: { options: snapshot.grade.options.map((option, i) => ({ name: option.name, values: [...new Set(variants.map(v => v.values[i]))] })), variants } };
    const files=[...form.querySelector('[data-editor-photos]').files];
    const photoFingerprint=JSON.stringify(files.map(f=>[f.name,f.size,f.lastModified,f.type]));
    if(photoFingerprint!==form.photoFingerprint){if(form.pendingAttempt&&files.length)throw Error('Confirme primeiro o cadastro pendente com os mesmos dados.');form.uploadedPhotos=[];form.photoFingerprint=photoFingerprint;}
    const existing=[...new Set([snapshot.imageUrl,...(snapshot.images||snapshot.gallery||[])].filter(Boolean))];
    if((files.length>0&&files.length+existing.length>8)||files.some(f=>f.size>8*1024*1024||!['image/jpeg','image/png','image/webp'].includes(f.type)))throw Error('Escolha até 8 fotos JPG, PNG ou WebP de até 8 MB cada.');
    form.uploadedPhotos ||= [];
    for(let i=form.uploadedPhotos.length;i<files.length;i++){
      const result=await api('admin/product-media','POST',{base64:await prepareUpload(files[i])});form.uploadedPhotos.push(result.imageUrl);
    }
    const photos=[...existing,...form.uploadedPhotos];
    if(photos.length&&(form.dataset.fatekProduct==='new'||form.uploadedPhotos.length)){input.imageUrl=photos[0];input.gallery=photos.slice(1);}
    const create = form.dataset.fatekProduct === 'new';
    if (create) {
      input.requestId = form.pendingAttempt?.input.requestId || crypto.randomUUID();
      if (form.pendingAttempt && JSON.stringify(form.pendingAttempt.input) !== JSON.stringify(input)) throw Error('Confira o cadastro pendente antes de alterar os dados. Reenvie os mesmos dados para confirmar o resultado.');
      form.pendingAttempt = { input };
      sessionStorage.setItem(editorAttemptKey(), JSON.stringify(form.pendingAttempt));
    } else input.expectedRevision = snapshot.revision;
    const result = await api('admin/products' + (create ? '' : '/' + form.dataset.fatekProduct), create ? 'POST' : 'PATCH', input);
    if (create) sessionStorage.removeItem(editorAttemptKey());
    form.dataset.fatekProduct = result.id;
    document.querySelector('#product-dialog').close();
    try { await loadProducts(); renderAdminList(); toast('Peça salva no ERP.'); }
    catch { toast('Peça salva no ERP. Atualize o catálogo para conferir.'); }
  } catch (error) { message.textContent = error.message; }
  finally { delete form.dataset.saving; button.disabled = false; }
}, true);
