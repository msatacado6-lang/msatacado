// Fail closed: an unavailable configuration never switches a connected store to demo data.
const integrationState = { mode: null, client: null, info: null, error: null };
const integrationReady = (async () => {
  const response = await fetch('/api/integration', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error('Não foi possível conferir a conexão da loja. Tente novamente.');
  const config = await response.json();
  if (config.mode === 'LEGACY') { integrationState.mode = 'LEGACY'; return; }
  if (config.mode !== 'FATEK') throw Error('Configuração da loja inválida.');
  const { createAdapter } = await import('/fatek-client.js');
  integrationState.client = createAdapter(config);
  integrationState.mode = 'FATEK';
})().catch(error => { integrationState.error = error; });
function usesFatek() { return integrationState.mode === 'FATEK'; }
function minimumPieces() { return usesFatek() ? integrationState.info?.store.policy.minPieces ?? 1 : 6; }
function variantLabel(id, key) { return products.find(p => p.id === id)?.variants?.find(v => v.size === key)?.label || key; }
function priceLabel(value) { return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: integrationState.info?.store.currency || 'BRL' }).format(value) : 'Preço indisponível'; }
function commerceCopy(value) {
  if (!usesFatek()) return value;
  return value.replace(/6 peças/g, minimumPieces() + ' peças').replace(/<strong>06<\/strong>/g, '<strong>' + String(minimumPieces()).padStart(2, '0') + '</strong>');
}
