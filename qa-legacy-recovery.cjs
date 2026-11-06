const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const puppeteer = require('puppeteer');
const { applySecurityHeaders } = require('./security-headers.cjs');

const root = path.join(__dirname, 'dist');
const code = 'X'.repeat(24);
const email = 'buyer@example.test';
const password = 'SyntheticRecovery123!';
const buyer = { id: 'original-buyer', name: 'Cliente original', email, role: 'customer' };
const history = [{ id: 'a1b2c3d4-0000-4000-8000-000000000001', created: '2026-10-30T12:00:00Z',
  status: 'Salvo', items: [{ name: 'Peça histórica', qty: 6, size: 'M' }] }];
let reset = false;
const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};
const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);
  const route = new URL(req.url, 'http://127.0.0.1').pathname;
  const loggedIn = req.headers.cookie?.includes('fixture-buyer=1');
  try {
    if (route === '/api/integration') return json(res, 200, { mode: 'LEGACY', legacyRecovery: true });
    if (route === '/api/session') return json(res, 200, { user: loggedIn ? buyer : null });
    if (route === '/api/orders') return json(res, loggedIn ? 200 : 401, loggedIn ? history : {});
    if (req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      assert.equal(body.email, email);
      if (route === '/api/account-recovery/start') return json(res, 202, { ok: true });
      if (route === '/api/account-recovery/finish') {
        if (body.code !== code) return json(res, 400, { error: 'Código inválido ou vencido. Solicite um novo código.' });
        assert.equal(body.password, password);
        reset = true;
        return json(res, 200, { ok: true });
      }
      if (route === '/api/login' && reset) {
        assert.equal(body.password, password);
        res.setHeader('Set-Cookie', 'fixture-buyer=1; HttpOnly; SameSite=Strict; Path=/');
        return json(res, 200, { user: buyer });
      }
      return json(res, 404, { error: 'Rota inválida na fixture.' });
    }
    const file = path.resolve(root, route === '/' ? 'index.html' : /^\/conta(?:\/|$)/.test(route) ? 'customer.html' : '.' + route);
    if (!file.startsWith(root + path.sep)) return json(res, 404, {});
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
      '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[path.extname(file)];
    if (type) res.setHeader('Content-Type', type);
    res.end(await fs.readFile(file));
  } catch {
    json(res, 500, { error: 'Falha na fixture.' });
  }
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    for (const width of [390, 1440]) {
      reset = false;
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewport({ width, height: 844 });
      await page.setRequestInterception(true);
      page.on('request', request => new URL(request.url()).origin === origin ? request.continue() : request.abort());
      await page.goto(origin + '/#conta');
      await page.waitForSelector('a[href$="conta/recuperar-legado"]');
      await page.click('a[href$="conta/recuperar-legado"]');
      await page.waitForSelector('[data-legacy-recovery="start"]');
      await page.type('[name="email"]', email);
      await page.click('[data-legacy-recovery] [type="submit"]');
      await page.waitForSelector('[data-legacy-recovery="finish"]');
      assert.equal(await page.$eval('[name="email"]', el => el.readOnly), true);
      await page.type('[name="code"]', 'Y'.repeat(24));
      await page.type('[name="password"]', password);
      await page.click('[data-legacy-recovery] [type="submit"]');
      await page.waitForFunction(() => document.querySelector('.form-error')?.textContent.includes('inválido'));
      await page.$eval('[name="code"]', el => { el.value = ''; });
      await page.type('[name="code"]', code);
      await page.click('[data-legacy-recovery] [type="submit"]');
      await page.waitForSelector('[data-account-form="login"]');
      await page.type('[name="email"]', email);
      await page.type('[name="password"]', password);
      await page.click('[data-account-form="login"] [type="submit"]');
      await page.waitForSelector('.order-card');
      assert.match(await page.$eval('.order-card', el => el.textContent), /A1B2C3D4.*Peça histórica/s);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('PASS: legacy recovery at 390 and 1440, invalid code retry, fresh login and original order.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
