function editorAttemptKey() { return 'ms-fatek-product-intent-v1:' + location.origin + ':' + currentUser.id; }
function editorRow(variant, options) {
  return `<div class="stock-row" data-editor-variant="${esc(variant.id || '')}">${options.map((o, i) => `<label>${esc(o.name)}<input data-grade-value="${i}" value="${esc(variant.values[i] || '')}" required maxlength="80"></label>`).join('')}<label>Custo da combinação<input data-grade-price="costPrice" type="number" min="0" step="0.01" placeholder="Usar custo da peça" value="${variant.costPrice ?? ''}"></label><label>Venda da combinação<input data-grade-price="sellPrice" type="number" min="0" step="0.01" placeholder="Usar preço da peça" value="${variant.sellPrice ?? ''}"></label><label>Saldo no ERP<input value="${variant.stockQty || 0}" readonly aria-readonly="true"></label><label><input type="checkbox" data-grade-active ${variant.isActive !== false ? 'checked' : ''} ${variant.stockQty > 0 ? 'disabled' : ''}> Ativa</label>${options.length ? `<button type="button" data-remove-editor-row ${variant.stockQty > 0 ? 'disabled title="Variação com saldo: ajuste no ERP antes de remover"' : ''}>Remover</button>` : ''}</div>`;
}
function editorVariants(form) {
  return [...form.querySelectorAll('[data-editor-variant]')].map(row => {
    const previous = form.snapshot.grade.variants.find(v => v.id && v.id === row.dataset.editorVariant);
    const { stockQty, ...metadata } = previous || {};
    const price = key => { const value = row.querySelector(`[data-grade-price="${key}"]`).value; return value === '' ? null : Number(value); };
    return { ...metadata, values: [...row.querySelectorAll('[data-grade-value]')].map(i => i.value.trim()),
      costPrice: price('costPrice'), sellPrice: price('sellPrice'), isActive: row.querySelector('[data-grade-active]').checked };
  });
}
function editorMatrix(options, variants) {
  if (!options.length || !variants.length) return { options: [], missing: [] };
  if (variants.some(v => v.values.length !== options.length || v.values.some(v => !v))) throw Error('Preencha todos os valores da grade.');
  const axes = options.map((o, i) => ({ name: o.name, values: [...new Set(variants.map(v => v.values[i]))] }));
  if (axes.some(o => o.values.length > 100) || axes.reduce((n,o) => n * o.values.length, 1) > 500) throw Error('A grade permite até 100 valores por eixo e 500 combinações.');
  const keys = new Set(variants.map(v => JSON.stringify(v.values)));
  if (keys.size !== variants.length) throw Error('Existe uma combinação repetida na grade.');
  const matrix = axes.reduce((rows,o) => rows.flatMap(row => o.values.map(value => [...row,value])), [[]]);
  return { options: axes, missing: matrix.filter(values => !keys.has(JSON.stringify(values))) };
}
function renderEditorPhotos(form) {
  form.querySelector('[data-editor-photo-list]').innerHTML = form.photos.map((url,i) => `<article><img src="${productImage(url)}" alt="Foto ${i+1} da peça"><span>${i === 0 ? 'Capa do catálogo' : 'Foto '+(i+1)}</span><button type="button" data-editor-cover="${i}" ${i === 0 ? 'disabled' : ''}>Usar como capa</button><button type="button" data-editor-remove-photo="${i}">Remover foto</button></article>`).join('') || '<p class="muted">Nenhuma foto. Os arquivos escolhidos serão enviados ao salvar.</p>';
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
    modal.setAttribute('aria-labelledby','fatek-product-title');
    modal.innerHTML = `<div class="dialog-head"><h2 id="fatek-product-title">${id ? 'Editar peça' : 'Adicionar peça'}</h2><button type="button" data-close-product aria-label="Fechar cadastro">×</button></div><form data-fatek-product="${id || 'new'}">${field('Nome da peça','name',record.name,'text','required maxlength="200"')}${field('Categoria','category',record.category || '','text','maxlength="120"')}${field('Preço de custo da peça','costPrice',record.costPrice,'number','required min="0" step="0.01"')}${field('Preço de venda da peça','sellPrice',record.sellPrice,'number','required min="0" step="0.01"')}<label class="field">Descrição<textarea name="description" maxlength="500">${esc(record.description || '')}</textarea></label><label><input type="checkbox" name="catalogVisible" ${record.catalogVisible ? 'checked' : ''}> Exibir no catálogo</label><fieldset class="photo-editor"><legend>Fotos da peça</legend><p class="muted">Até 8 fotos JPG, PNG ou WebP, até 8 MB cada. Capa e remoções serão salvas junto com o cadastro.</p><div class="photo-list" data-editor-photo-list></div><input type="file" data-editor-photos multiple accept="image/jpeg,image/png,image/webp"></fieldset><fieldset class="stock-editor"><legend>Grade</legend><p class="muted">Preços de combinação em branco usam o preço da peça. Desmarque “Ativa” para combinações que não serão vendidas. O saldo e os ajustes continuam no ERP.</p><div data-editor-rows>${record.grade.variants.map(v => editorRow(v, options)).join('')}</div>${options.length ? '<button type="button" class="btn outline" data-add-editor-row>Adicionar combinação</button><button type="button" class="btn outline" data-complete-editor-grade>Completar combinações</button>' : '<p class="muted">Produto sem grade. Para configurar novos eixos, use o ERP.</p>'}</fieldset><p class="muted">Dados fiscais e demais configurações avançadas continuam no ERP e são preservados ao salvar aqui.</p><p class="form-error" role="alert"></p><div class="product-form-actions"><button type="button" class="btn outline" data-close-product>Cancelar</button><button type="submit" class="btn dark">Salvar peça no ERP</button></div></form>`;
    const form = modal.querySelector('form'); form.snapshot = record; form.pendingAttempt = pending;
    form.photos = [...new Set([record.imageUrl,...(record.images || record.gallery || [])].filter(Boolean))];
    form.initialPhotos = JSON.stringify(form.photos); renderEditorPhotos(form);
    modal.oncancel = e => { if (form.dataset.saving) e.preventDefault(); };
  } catch (error) { modal.innerHTML = `<p role="alert">${esc(error.message)}</p><button type="button" class="btn outline" data-close-product>Fechar</button>`; }
}
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button || !usesFatek() || button.disabled) return;
  const form = button.closest('[data-fatek-product]'); if (!form || form.dataset.saving) return;
  try {
    if (button.hasAttribute('data-add-editor-row')) form.querySelector('[data-editor-rows]').insertAdjacentHTML('beforeend', editorRow({ values: [] }, form.snapshot.grade.options));
    if (button.hasAttribute('data-remove-editor-row')) button.closest('[data-editor-variant]').remove();
    if (button.hasAttribute('data-complete-editor-grade')) {
      const matrix = editorMatrix(form.snapshot.grade.options, editorVariants(form));
      form.querySelector('[data-editor-rows]').insertAdjacentHTML('beforeend', matrix.missing.map(values => editorRow({ values }, matrix.options)).join(''));
      form.querySelector('.form-error').textContent = matrix.missing.length ? `${matrix.missing.length} combinação(ões) adicionada(s), sem saldo. Confira preços e disponibilidade.` : 'A grade já está completa.';
    }
    if (button.hasAttribute('data-editor-cover')) { const index = Number(button.dataset.editorCover); form.photos.unshift(...form.photos.splice(index,1)); renderEditorPhotos(form); }
    if (button.hasAttribute('data-editor-remove-photo')) { form.photos.splice(Number(button.dataset.editorRemovePhoto),1); renderEditorPhotos(form); }
  } catch (error) { form.querySelector('.form-error').textContent = error.message; }
});
document.addEventListener('submit', async event => {
  const form = event.target; if (!form.matches('[data-fatek-product]')) return;
  event.preventDefault(); event.stopImmediatePropagation(); if (form.dataset.saving) return;
  form.dataset.saving = 'true'; const message = form.querySelector('.form-error'); message.textContent = '';
  const controls = [...form.closest('dialog').querySelectorAll('button,input,textarea,select')].map(control => [control,control.disabled]);
  const priorPending = !!form.pendingAttempt;
  let dispatched = false, create = form.dataset.fatekProduct === 'new';
  try {
    const values = Object.fromEntries(new FormData(form)), snapshot = form.snapshot, variants = editorVariants(form);
    const matrix = editorMatrix(snapshot.grade.options, variants);
    if (matrix.missing.length) throw Error(`Faltam ${matrix.missing.length} combinações. Clique em “Completar combinações” e confira a grade antes de salvar.`);
    const input = { name: values.name, category: values.category, description: values.description,
      costPrice: Number(values.costPrice), sellPrice: Number(values.sellPrice), catalogVisible: values.catalogVisible === 'on',
      grade: { options: matrix.options, variants } };
    const files = [...form.querySelector('[data-editor-photos]').files];
    const photoFingerprint = JSON.stringify(files.map(f => [f.name,f.size,f.lastModified,f.type]));
    if (photoFingerprint !== form.photoFingerprint) {
      if (form.pendingAttempt && files.length) throw Error('Confirme primeiro o cadastro pendente com os mesmos dados.');
      form.uploadedPhotos = []; form.photoFingerprint = photoFingerprint;
    }
    if (((create || files.length || JSON.stringify(form.photos) !== form.initialPhotos) && files.length + form.photos.length > 8) || files.some(f => f.size > 8*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(f.type))) throw Error('Escolha até 8 fotos JPG, PNG ou WebP de até 8 MB cada.');
    controls.forEach(([control]) => control.disabled = true);
    form.uploadedPhotos ||= [];
    for (let i = form.uploadedPhotos.length; i < files.length; i++) {
      const result = await api('admin/product-media','POST',{base64:await prepareUpload(files[i])}); form.uploadedPhotos.push(result.imageUrl);
    }
    const photos = [...form.photos,...form.uploadedPhotos];
    if (create || form.uploadedPhotos.length || JSON.stringify(form.photos) !== form.initialPhotos) { input.imageUrl = photos[0] || null; input.gallery = photos.slice(1); }
    if (create) {
      input.requestId = form.pendingAttempt?.input.requestId || crypto.randomUUID();
      if (form.pendingAttempt && JSON.stringify(form.pendingAttempt.input) !== JSON.stringify(input)) throw Error('Confira o cadastro pendente antes de alterar os dados. Reenvie os mesmos dados para confirmar o resultado.');
      sessionStorage.setItem(editorAttemptKey(), JSON.stringify({ input }));
      form.pendingAttempt = { input };
    } else input.expectedRevision = snapshot.revision;
    if (new Blob([JSON.stringify(input)]).size > 524288) { if (create && !priorPending) { sessionStorage.removeItem(editorAttemptKey()); form.pendingAttempt = null; } throw Error('Cadastro muito grande. Reduza a grade ou os dados adicionais antes de salvar.'); }
    dispatched = true;
    const result = await api('admin/products' + (create ? '' : '/' + form.dataset.fatekProduct), create ? 'POST' : 'PATCH', input);
    if (create) sessionStorage.removeItem(editorAttemptKey());
    form.dataset.fatekProduct = result.id;
    document.querySelector('#product-dialog').close();
    try { await loadProducts(); renderAdminList(); toast('Peça salva no ERP.'); }
    catch { toast('Peça salva no ERP. Atualize o catálogo para conferir.'); }
  } catch (error) {
    // Only release a first attempt definitively rejected before commit. An earlier
    // uncertain attempt remains protected even if its retry now loses permission.
    if (create && dispatched && !priorPending && !error.outcomeUnknown &&
      ((error.status === 400 && error.code === 'INVALID_PRODUCT') || (error.status === 422 && error.code === 'INVALID_GRADE'))) {
      sessionStorage.removeItem(editorAttemptKey()); form.pendingAttempt = null;
    }
    message.textContent = error.message;
  } finally { delete form.dataset.saving; controls.forEach(([control,disabled]) => control.disabled = disabled); }
}, true);
