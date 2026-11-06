'use strict';

/** Deployment selection only. No secret is included in the public configuration. */
function publicConfig(env = process.env) {
  const mode = env.MS_COMMERCE_MODE || 'LEGACY';
  if (mode === 'LEGACY') return { mode };
  if (mode !== 'FATEK' || !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(env.SUPABASE_URL || '') ||
      !/^sb_publishable_[A-Za-z0-9_-]{8,480}$/.test(env.SUPABASE_PUBLISHABLE_KEY || '')) {
    throw new Error('INVALID_INTEGRATION_CONFIG');
  }
  return { mode, supabaseUrl: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
    capabilities: { productWrites: env.MS_FATEK_PRODUCT_WRITES === '1' }, erpUrl: 'https://crm.fatek.solutions/inventory' };
}

function withIntegration(legacy) {
  return async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    let config;
    try { config = publicConfig(); }
    catch { return reply(503, { error: 'Integração ainda não configurada.', code: 'INTEGRATION_UNAVAILABLE' }); }
    const route = req.url.split('?')[0];
    if (route === '/api/integration') {
      const legacyRecovery = config.mode === 'LEGACY' && legacy.legacyRecoveryAvailable?.() === true;
      return req.method === 'GET' ? reply(200, legacyRecovery ? { ...config, legacyRecovery } : config) : reply(405, { error: 'Método não permitido.' });
    }
    if (config.mode === 'FATEK') {
      // Prevent direct requests from continuing to sell/edit against the old stock.
      // Presentation and existing admin authentication/history remain with the store.
      const productEditor = process.env.MS_FATEK_PRODUCT_WRITES === '1' && /^\/api\/admin\/products(?:\/[0-9a-f-]{36})?$/.test(route) && ['GET','POST','PATCH'].includes(req.method);
      const productMedia = process.env.MS_FATEK_PRODUCT_WRITES === '1' && req.method === 'POST' && route === '/api/admin/product-media';
      const allowed = productEditor || productMedia || (req.method === 'GET' && ['/api/home', '/api/session', '/api/admin/overview'].includes(route)) ||
        (req.method === 'GET' && /^\/api\/images\/[a-f0-9-]{36}\.webp$/.test(route)) ||
        (req.method === 'POST' && ['/api/admin/login', '/api/logout'].includes(route)) ||
        (['PATCH', 'DELETE'].includes(req.method) && route === '/api/admin/home') ||
        (req.method === 'POST' && route === '/api/admin/home/photo');
      if (!allowed) return reply(409, { error: 'Esta operação pertence ao ERP. O estoque anterior não foi alterado.', code: 'ERP_OPERATION_REQUIRED' });
    }
    return legacy(req, res);
  };
}

module.exports = { publicConfig, withIntegration };
