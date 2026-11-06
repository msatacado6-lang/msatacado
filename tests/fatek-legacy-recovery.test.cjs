const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const nodemailer = require('nodemailer');
const api = require('../api/index.js');

const origin = 'http://127.0.0.1:4173';
const project = 'https://abcdefghijklmnopqrst.supabase.co';
const customer = { id: 'original-buyer', email: 'buyer@example.test', phone: '51999999999', role: 'customer' };
const admin = { id: 'staff', email: 'staff@example.test', role: 'admin' };
const historicalOrders = [{ id: 'original-order', shipping: { id: 'me_1', price: 24.90 } }];
const oldBuyer = 'b'.repeat(64);
const oldAdmin = 'a'.repeat(64);
const sha = value => createHash('sha256').update(value).digest('hex');

async function request(path, { body, token } = {}) {
  let status, payload;
  const headers = {};
  await api({
    url: '/api/' + path, method: body ? 'POST' : 'GET', body,
    headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { cookie: 'ms_session=' + token } : {}) },
    socket: { remoteAddress: '127.0.0.1' },
  }, {
    setHeader(key, value) { headers[key] = value; },
    writeHead(code) { status = code; },
    end(value) { payload = JSON.parse(value); },
  });
  return { status, payload, cookie: headers['Set-Cookie'] };
}

function environment(t, extra = {}) {
  const config = {
    NODE_ENV: 'test', PORT: '4173', APP_ORIGINS: origin,
    SUPABASE_URL: project, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
    MS_COMMERCE_MODE: 'LEGACY', MS_LEGACY_RECOVERY_ENABLED: '1',
    MS_RECOVERY_FROM: 'recovery@example.test', MS_RECOVERY_SMTP_HOST: 'smtp.example.test',
    MS_RECOVERY_SMTP_PORT: '587', MS_RECOVERY_SMTP_USER: 'fixture',
    MS_RECOVERY_SMTP_PASSWORD: 'fixture', ...extra,
  };
  for (const [key, value] of Object.entries(config)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
  }
}

test('only a mailed code resets the original buyer and new sessions can read the original orders', async t => {
  environment(t);
  const mail = [];
  t.mock.method(nodemailer, 'createTransport', options => {
    assert.equal(options.requireTLS, true);
    assert.equal(options.disableUrlAccess, true);
    return { sendMail: async message => { mail.push(message); } };
  });
  let codeHash, passwordHash, newSession;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert(url.startsWith(project + '/rest/v1/rpc/'));
    const { action, payload, session_token: session } = JSON.parse(options.body);
    if (url.endsWith('/ms_legacy_recovery')) {
      assert.equal(session, '');
      if (action === 'start' && payload.email === customer.email && !codeHash) {
        codeHash = payload.code_hash;
        return Response.json({ email: customer.email });
      }
      if (action === 'finish' && payload.email === customer.email && payload.code_hash === codeHash) {
        assert.match(payload.password_hash, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
        passwordHash = payload.password_hash;
        codeHash = undefined;
        return Response.json({ ok: true });
      }
      return Response.json(null);
    }
    if (action === 'rate') return Response.json({ allowed: true });
    if (action === 'session') {
      if (session === sha(oldAdmin)) return Response.json({ user: admin, adminAuthenticated: true });
      if (session === sha(oldBuyer) || session && session === newSession) {
        return Response.json({ user: customer, adminAuthenticated: false });
      }
      return Response.json({ user: null, adminAuthenticated: false });
    }
    if (action === 'login_lookup') return Response.json({ ...customer, password: passwordHash || '' });
    if (action === 'create_session') {
      assert.equal(payload.user_id, customer.id);
      assert.equal(payload.scope, 'customer');
      assert.match(payload.token, /^v2:[a-f0-9]{64}$/);
      newSession = payload.token;
      return Response.json({});
    }
    if (action === 'orders') {
      return session && session === newSession ? Response.json(historicalOrders)
        : Response.json({ code: 'P0001', message: 'Entre na sua conta para continuar.' }, { status: 400 });
    }
    assert.fail('Unexpected RPC ' + action);
  });

  assert.deepEqual((await request('integration')).payload, { mode: 'LEGACY', legacyRecovery: true });
  const expired = await request('session', { token: oldBuyer });
  assert.equal(expired.payload.user, null);
  assert.match(expired.cookie, /Max-Age=0/);
  assert.equal((await request('orders', { token: oldBuyer })).status, 401);
  assert.equal((await request('session', { token: oldAdmin })).payload.adminAuthenticated, true);

  const [requested, unknown] = await Promise.all([
    request('account-recovery/start', { body: { email: ' BUYER@example.test ' } }),
    request('account-recovery/start', { body: { email: admin.email } }),
  ]);
  assert.deepEqual(requested, { status: 202, payload: { ok: true }, cookie: undefined });
  assert.deepEqual(unknown, requested);
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to.address, customer.email);
  const code = mail[0].text.split('\n\n')[1];
  assert.equal(sha(code), codeHash);
  assert.notEqual(code, codeHash);

  const password = 'VerifiedBuyerPassword123!';
  const finish = (email, value) => request('account-recovery/finish', { body: { email, code: value, password } });
  assert.equal((await finish(admin.email, code)).status, 400);
  assert.equal((await finish(customer.email, 'Z'.repeat(24))).status, 400);
  const finished = await finish(customer.email, code);
  assert.deepEqual(finished, { status: 200, payload: { ok: true }, cookie: undefined });
  assert.equal((await finish(customer.email, code)).status, 400);
  const login = await request('login', { body: { email: customer.email, password } });
  assert.equal(login.payload.user.id, customer.id);
  assert.match(login.cookie, /^ms_session=v2_[a-f0-9]{64}; HttpOnly; SameSite=Strict/);
  const token = login.cookie.split(';')[0].slice(11);
  assert.deepEqual((await request('orders', { token })).payload, historicalOrders);
});

test('the recovery flag hides the flow and connected mode cannot use legacy recovery', async t => {
  environment(t, { MS_LEGACY_RECOVERY_ENABLED: '0' });
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No network with recovery disabled'));
  assert.deepEqual((await request('integration')).payload, { mode: 'LEGACY' });
  assert.equal((await request('account-recovery/start', { body: { email: customer.email } })).status, 503);
  process.env.MS_LEGACY_RECOVERY_ENABLED = '1';
  process.env.MS_COMMERCE_MODE = 'FATEK';
  const previous = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_synthetic_key';
  t.after(() => previous === undefined ? delete process.env.SUPABASE_PUBLISHABLE_KEY : process.env.SUPABASE_PUBLISHABLE_KEY = previous);
  assert.equal((await request('integration')).payload.legacyRecovery, undefined);
  assert.equal((await request('account-recovery/finish', { body: {} })).status, 409);
});
