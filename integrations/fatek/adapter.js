import { createClient } from '@supabase/supabase-js';
import { createStorefrontApi } from './vendor/storefront-api.ts';

const messages = {
  PRODUCT_OUTCOME_UNKNOWN: 'Não foi possível confirmar o cadastro. Preserve os mesmos dados e reenvie para confirmar.', PRODUCT_CONFLICT: 'O produto mudou. Reabra o cadastro antes de salvar; suas alterações foram preservadas.', EDITOR_DISABLED: 'O cadastro pelo painel ainda precisa ser liberado pelo responsável.',
  LOGIN_REQUIRED: 'Entre na sua conta para continuar.', INVALID_CREDENTIALS: 'Entre novamente na sua conta.',
  CONNECTION_UNAVAILABLE: 'Conexão indisponível. Seu pedido foi preservado.', STORE_UNAVAILABLE: 'A integração da loja ainda não está disponível.',
  PROFILE_STALE: 'Seus dados mudaram. Recarregue e confira antes de salvar.',
  CLIENT_REVIEW_REQUIRED: 'Seu cadastro está aguardando conferência da equipe.',
  CLIENT_LIMIT_REACHED: 'A loja precisa concluir a liberação do seu cadastro.',
  PENDING_ORDER: 'Há um pedido aguardando resposta. Confira ou repita esse mesmo pedido antes de iniciar outro.',
  ERP_OPERATION_REQUIRED: 'O cadastro deste produto é gerenciado no ERP. A escrita pelo painel está em preparação.',
};
export function friendly(error) {
  return messages[error?.code] || (error?.status === 401 ? messages.LOGIN_REQUIRED :
    error?.status === 409 ? 'Confira preço, estoque e cotação antes de continuar. Seu carrinho foi preservado.' :
    error?.status === 429 ? 'Muitas tentativas. Aguarde um momento.' : 'Não foi possível concluir. Seus dados foram preservados.');
}
function failure(code) { return Object.assign(new Error(messages[code] || code), { code }); }
export function safeImage(value) {
  if (typeof value !== 'string') return '/assets/placeholder.svg';
  if (/^\/(?:assets|api\/images)\/[A-Za-z0-9/_.-]+$/.test(value)) return value;
  try { const u = new URL(value); if (u.protocol === 'https:' && !u.username && !u.password) return u.href; } catch {}
  return '/assets/placeholder.svg';
}
export function mapProduct(product) {
  return {
    id: product.id, name: product.name, type: product.category || 'Outros', description: product.description || '',
    wash: product.axes.join(' × '), image: safeImage(product.imageUrl),
    photos: product.images.map((url, i) => ({ id: String(i), url: safeImage(url) })),
    variants: product.variants.map(v => ({
      size: v.id, label: v.values.filter(Boolean).join(' · ') || 'Única',
      // Missing quantity/price is not a zero-price product or unlimited stock.
      quantity: v.available && Number.isInteger(v.availableQuantity) && v.availableQuantity > 0 ? v.availableQuantity : 0,
      ...(typeof v.price === 'number' && Number.isFinite(v.price) ? { price: v.price } : {}),
      productId: product.id, variantId: v.id,
    })),
    source: 'FATEK',
  };
}
export function mapOrder(order) {
  let whatsappUrl = '';
  try { const u = new URL(order.whatsappUrl); if (u.protocol === 'https:' && u.hostname === 'wa.me' && /^\/\d+$/.test(u.pathname)) whatsappUrl = u.href; } catch {}
  return { ...order, whatsappUrl, created: order.createdAt,
    items: order.items.map(i => ({ ...i, qty: i.quantity, size: i.label, image: '/assets/placeholder.svg' })) };
}

export function createAdapter(config, dependencies = {}) {
  if (config.mode !== 'FATEK') throw failure('INVALID_CONFIG');
  const storage = dependencies.storage || window.localStorage;
  const auth = dependencies.auth || createClient(config.supabaseUrl, config.publishableKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  }).auth;
  const api = dependencies.api || createStorefrontApi({
    supabaseUrl: config.supabaseUrl, publishableKey: config.publishableKey,
    getAccessToken: async () => { const { data, error } = await auth.getSession(); if (error) throw error; return data.session?.access_token || null; },
  });
  let buyer = null, profile = null;
  async function identity() {
    const { data, error } = await auth.getSession();
    if (error) throw failure('LOGIN_REQUIRED');
    return data.session?.user || null;
  }
  const keyFor = async () => {
    const user = await identity(); if (!user) throw failure('LOGIN_REQUIRED');
    return 'ms-fatek-order-v1:' + config.supabaseUrl + ':' + user.id;
  };
  const pending = async () => {
    const raw = storage.getItem(await keyFor());
    if (!raw) return null;
    try { const value = JSON.parse(raw); if (typeof value.key === 'string' && value.input && typeof value.input === 'object') return value; } catch {}
    throw failure('PENDING_ORDER');
  };
  async function submit(input) {
    const saved = await pending(), serialized = JSON.stringify(input);
    if (saved && JSON.stringify(saved.input) !== serialized) throw failure('PENDING_ORDER');
    const attempt = saved || { key: crypto.randomUUID(), input };
    const slot = await keyFor();
    storage.setItem(slot, JSON.stringify(attempt)); // Must persist before dispatch.
    try {
      const receipt = await api.placeOrder(attempt.input, attempt.key);
      storage.removeItem(slot);
      return mapOrder(receipt);
    } catch (error) {
      // Keep uncertain/in-flight requests. These definite rejections can be requoted.
      if (([400, 403, 404, 410, 422].includes(error.status) ||
        (error.status === 409 && ['QUOTE_EXPIRED', 'STOCK_CHANGED', 'PRICE_CHANGED'].includes(error.code))) && !error.outcomeUnknown) storage.removeItem(slot);
      throw error;
    }
  }
  async function session() {
    if (!await identity()) { buyer = null; profile = null; return { user: null, adminAuthenticated: false, setupNeeded: false }; }
    const result = await api.me(); buyer = result.buyer;
    return { user: { id: buyer.id, name: buyer.name, email: buyer.email, role: 'customer' }, adminAuthenticated: false, setupNeeded: false };
  }
  return {
    api, auth, friendly, pending, canEditProducts: config.capabilities.productWrites,
    async catalog() {
      const items = [], cursors = new Set(); let cursor;
      do {
        const page = await api.products(cursor ? { cursor } : {});
        items.push(...page.items.map(mapProduct));
        if (items.length > 10000 || (page.nextCursor && cursors.has(page.nextCursor))) throw failure('INVALID_RESPONSE');
        cursor = page.nextCursor; if (cursor) cursors.add(cursor);
      } while (cursor);
      return items;
    },
    quote: async input => { if (await pending()) throw failure('PENDING_ORDER'); return api.quote(input); },
    submit,
    async retry() { const attempt = await pending(); if (!attempt) throw failure('INVALID_ORDER'); return submit(attempt.input); },
    async profile() { const result = await api.profile(); profile = result.profile; return result; },
    async request(path, method, body, legacy, admin = false) {
      try {
        if (path === 'products' && method === 'GET') {
          if (admin && config.capabilities.productWrites) {
            const result = await legacy('admin/products', 'GET');
            return result.items.map(p => ({ ...mapProduct({ ...p, axes: p.grade.options.map(o => o.name), images: p.images || [], imageUrl: p.imageUrl || null,
              variants: p.grade.variants.map(v => ({ ...v, price: v.sellPrice ?? p.sellPrice, available: v.isActive && v.stockQty > 0, availableQuantity: v.stockQty })) }),
              inventoryVersion: p.revision, catalogVisible: p.catalogVisible }));
          }
          return this.catalog();
        }
        if (path === 'categories' && method === 'GET') return (await api.categories()).categories.map(name => ({ name }));
        // Existing administrator is deliberately separate from a buyer's Auth session.
        if (admin && (path === 'session' || path === 'logout' || path.startsWith('admin/'))) {
          if (path === 'admin/product-media' && method === 'POST' && config.capabilities.productWrites) return legacy(path, method, body);
          if (/^admin\/products(?:\/[a-f0-9-]{36})?$/.test(path) && ['GET','POST','PATCH'].includes(method) && config.capabilities.productWrites) return legacy(path, method, body);
          if (/^admin\/(?:products|categories|orders)(\/|$)/.test(path)) throw failure('ERP_OPERATION_REQUIRED');
          return legacy(path, method, body);
        }
        if (path === 'home') return legacy(path, method, body);
        if (path === 'session') return session();
        if (path === 'login' || path === 'register') {
          const credentials = { email: body.email, password: body.password };
          const result = path === 'login' ? await auth.signInWithPassword(credentials) : await auth.signUp({ ...credentials,
            options: { data: { name: body.name }, emailRedirectTo: window.location.origin + '/#conta' } });
          if (result.error) throw failure('AUTH_FAILED');
          if (!result.data.session) return { confirmationRequired: true };
          await api.syncCustomer(); return session();
        }
        if (path === 'logout') { const { error } = await auth.signOut(); if (error) throw failure('AUTH_FAILED'); buyer = null; profile = null; return { ok: true }; }
        if (path === 'profile' && method === 'PATCH') {
          const result = await api.updateProfile({ revision: body.revision, name: body.name }); profile = result.profile;
          return { user: { id: buyer?.id, name: profile?.name, email: buyer?.email, role: 'customer' } };
        }
        if (path === 'recover') {
          const { error } = await auth.resetPasswordForEmail(body.email, { redirectTo: window.location.origin + '/#conta/nova-senha' });
          if (error) throw failure('AUTH_FAILED'); return { message: 'Se o e-mail estiver cadastrado, você receberá as instruções.' };
        }
        if (path === 'new-password') {
          const { error } = await auth.updateUser({ password: body.password }); if (error) throw failure('AUTH_FAILED');
          return { message: 'Senha atualizada. Entre novamente para continuar.' };
        }
        if (path === 'orders' && method === 'GET') return (await api.orders()).orders.map(mapOrder);
        throw failure('ERP_OPERATION_REQUIRED');
      } catch (error) { error.message = friendly(error); throw error; }
    },
  };
}
