'use strict';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function productRequest(method, id, body, env = process.env, transport = fetch) {
  if (env.MS_FATEK_PRODUCT_WRITES !== '1' || !/^fprod_[a-f0-9]{48}$/.test(env.FATEK_PRODUCT_KEY || '') ||
    !/^https:\/\/[a-z0-9.-]+$/.test(env.FATEK_STORE_ORIGIN || '')) {
    return { status: 503, body: { error: 'O cadastro integrado ainda não foi liberado.', code: 'EDITOR_DISABLED' } };
  }
  if (!['GET','POST','PATCH'].includes(method) || id && !uuid.test(id) || method === 'POST' && id || method === 'PATCH' && !id) {
    return { status: 400, body: { error: 'Operação de produto inválida.', code: 'INVALID_PRODUCT' } };
  }
  try {
    const response = await transport('https://crm.fatek.solutions/api/store/editor/v1/products' + (id ? '/' + id : ''), {
      method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(25000),
      headers: { 'x-fatek-product-key': env.FATEK_PRODUCT_KEY, Origin: env.FATEK_STORE_ORIGIN,
        ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }) },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
    const value = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid upstream');
    if (!response.ok) return { status: response.status, body: {
      error: response.status === 409 ? 'O produto mudou. Reabra o cadastro antes de salvar; preserve suas alterações.' : 'Não foi possível concluir o cadastro no ERP.',
      code: /^[A-Z_]{1,64}$/.test(value.error) ? value.error : 'PRODUCT_WRITE_UNAVAILABLE',
    } };
    return { status: response.status, body: value };
  } catch { return { status: 503, body: { error: 'Não foi possível confirmar o resultado. Preserve o formulário e repita o mesmo cadastro.', code: 'PRODUCT_OUTCOME_UNKNOWN' } }; }
}
module.exports = { productRequest };
