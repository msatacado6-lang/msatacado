const { createHash, randomBytes } = require('node:crypto');

function sessionKey(token) {
  if (!/^(?:v2_)?[a-f0-9]{64}$/.test(token)) return '';
  const digest = createHash('sha256').update(token).digest('hex');
  return token.startsWith('v2_') ? 'v2:' + digest : digest;
}

function readSession(cookie = '') {
  const token = cookie.split(';').map(part => part.trim())
    .find(part => part.startsWith('ms_session='))?.slice(11) || '';
  return sessionKey(token);
}

function issueSession() {
  const token = 'v2_' + randomBytes(32).toString('hex');
  return { token, key: sessionKey(token) };
}

function sessionCookie(token, maxAge) {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '';
  return `ms_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

module.exports = { readSession, issueSession, sessionCookie };
