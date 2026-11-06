const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const handler = require('../api/index.js');

const origin = 'http://127.0.0.1:4173';
const rpcOrigin = 'https://abcdefghijklmnopqrst.supabase.co';
const sandbox = 'https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const shopUser = { id: 'fixture-buyer', name: 'Comprador', email: 'buyer@example.test', role: 'customer' };
const staff = { id: 'fixture-staff', name: 'Admin', role: 'admin' };

async function call(url, method = 'GET', body, cookie) {
  const headers = { origin, ...(body ? { 'content-type': 'application/json' } : {}),
    ...(cookie ? { cookie: 'ms_session=' + cookie } : {}) };
  const response = { headers: {} };
  await handler({ url, method, body, headers, socket: { remoteAddress: '127.0.0.1' } }, {
    setHeader(key, value) { response.headers[key] = value; },
    writeHead(status, values) { response.status = status; Object.assign(response.headers, values); },
    end(value) { response.data = JSON.parse(value); },
  });
  return response;
}

test('recovered Vercel routes preserve protected phone accounts and persist the canonical freight price', async t => {
  for (const [key, value] of Object.entries({
    NODE_ENV: 'test', PORT: '4173', APP_ORIGINS: origin, MS_COMMERCE_MODE: 'LEGACY',
    SUPABASE_URL: rpcOrigin, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
    MELHOR_ENVIO_TOKEN: 'synthetic-sandbox-token', MELHOR_ENVIO_API_URL: sandbox.split('/api/')[0],
  })) setEnv(t, key, value);

  const persisted = [];
  let providerCalls = 0, noService = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    if (url === sandbox) {
      providerCalls++;
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-sandbox-token');
      assert.equal(body.products[0].quantity, 6);
      return Response.json(noService ? [{ id: 1, price: ' ' }] : [
        { id: 1, name: 'PAC', company: { name: 'Correios' }, price: 24, custom_price: 0, custom_delivery_time: 5 },
        { id: 2, name: 'Inválido', company: { name: 'Correios' }, price: ' ' },
      ]);
    }
    assert(url.startsWith(rpcOrigin + '/rest/v1/rpc/'), 'unexpected outbound request');
    assert.equal(options.headers.apikey, 'synthetic-service-key');
    switch (body.action) {
      case 'rate': return Response.json({ allowed: true });
      case 'login_lookup': return Response.json({ ...shopUser, password: '' });
      case 'session':
        return Response.json(body.session_token === sha('staff')
          ? { user: staff, adminAuthenticated: true }
          : { user: body.session_token === sha('buyer') ? shopUser : null, adminAuthenticated: false });
      case 'get_config': return Response.json({ environment: 'sandbox', originCep: '95900018', pickupEnabled: false });
      case 'products': return Response.json([{ id: 'wide', type: 'Calças' }]);
      case 'order_create':
        persisted.push(body.payload);
        return Response.json({ id: 'fixture-order' });
      default: assert.fail('unexpected RPC: ' + body.action);
    }
  });
  assert.equal((await call('/api/login', 'POST', { email: shopUser.email })).status, 400);
  const invalid = await call('/api/login', 'POST', { email: shopUser.email, password: 'invalid-password' });
  assert.equal(invalid.status, 401);
  assert.equal(invalid.headers['Set-Cookie'], undefined);
  assert.equal((await call('/api/admin/shipping', 'GET', null, 'buyer')).status, 403);
  const admin = await call('/api/admin/shipping', 'GET', null, 'staff');
  assert.equal(admin.status, 200);
  assert(!JSON.stringify(admin.data).includes('synthetic-sandbox-token'));

  const items = [{ id: 'wide', size: 'M', qty: 6 }];
  const quote = await call('/api/shipping/calculate', 'POST', { cep: '90010000', items });
  assert.equal(quote.status, 200);
  assert.deepEqual(quote.data.quotes.map(({ id, price }) => ({ id, price })), [{ id: 'me_1', price: 0 }]);
  const body = { items, shipping: { id: 'me_1', cep: '90010000', price: 999 } };
  assert.equal((await call('/api/orders', 'POST', body, 'buyer')).status, 201);
  assert.equal(persisted[0].shipping.price, 0);
  noService = true;
  assert.equal((await call('/api/orders', 'POST', body, 'buyer')).status, 502);
  assert.equal(persisted.length, 1);
  assert.equal(providerCalls, 3);
});

function setEnv(t, key, value) {
  const previous = process.env[key];
  process.env[key] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
}
