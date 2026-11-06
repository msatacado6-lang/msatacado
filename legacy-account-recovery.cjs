const { randomBytes, createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const nodemailer = require('nodemailer');

const emailPattern = /^[^\s@<>,;]+@[^\s@<>,;]+$/;
const hashCode = value => createHash('sha256').update(value).digest('hex');

function config(env = process.env) {
  if (env.MS_LEGACY_RECOVERY_ENABLED !== '1') return null;
  const host = env.MS_RECOVERY_SMTP_HOST;
  const port = Number(env.MS_RECOVERY_SMTP_PORT);
  const user = env.MS_RECOVERY_SMTP_USER;
  const pass = env.MS_RECOVERY_SMTP_PASSWORD;
  const from = env.MS_RECOVERY_FROM;
  if (!host || ![465, 587].includes(port) || !user || !pass || !emailPattern.test(from || '')) return null;
  return { from, smtp: {
    host, port, auth: { user, pass }, secure: port === 465, requireTLS: port === 587,
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000, dnsTimeout: 3000,
    disableFileAccess: true, disableUrlAccess: true,
  } };
}

async function recover({ action, body, clientIp, rpc, hashPassword, fail }) {
  const settings = config();
  if (!settings) fail(503, 'Recuperação por e-mail indisponível. Fale com o atendimento.');
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 160 || !emailPattern.test(email)) fail(400, 'Informe um e-mail válido.');
  const limit = await rpc('rate', { key: hashCode('legacy-recovery:' + clientIp) });
  if (!limit?.allowed) fail(429, 'Muitas tentativas. Aguarde um minuto.');

  if (action === 'start') {
    const started = Date.now();
    const code = randomBytes(18).toString('base64url');
    const result = await rpc('start', { email, code_hash: hashCode(code) }, '', 'ms_legacy_recovery');
    if (result?.email === email) {
      try {
        await nodemailer.createTransport(settings.smtp).sendMail({
          from: settings.from, to: { address: result.email, name: '' },
          subject: 'Recupere sua conta na MS Atacado',
          text: `Cole este código na tela de recuperação para criar sua senha:\n\n${code}\n\nO código expira em 15 minutos. Se você não fez o pedido, ignore este e-mail.`,
        });
      } catch {
        // Keep the response identical for existing and unknown addresses.
        console.warn('MS_LEGACY_RECOVERY_MAIL_FAILED');
      }
    }
    await delay(Math.max(0, 700 - (Date.now() - started)));
    return { status: 202, data: { ok: true } };
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!/^[A-Za-z0-9_-]{24}$/.test(code)) fail(400, 'Confira o código de recuperação.');
  if (typeof body.password !== 'string' || body.password.length < 10 || body.password.length > 128) {
    fail(400, 'Use uma senha entre 10 e 128 caracteres.');
  }
  const result = await rpc('finish', { email, code_hash: hashCode(code), password_hash: hashPassword(body.password) }, '', 'ms_legacy_recovery');
  if (!result?.ok) fail(400, 'Código inválido ou vencido. Solicite um novo código.');
  return { status: 200, data: { ok: true } };
}

module.exports = { enabled: () => Boolean(config()), recover };
