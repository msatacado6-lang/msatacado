'use strict';
const {createHash}=require('node:crypto');
// Public identifiers only. Secrets stay in server environment variables.
const SUPABASE_ORIGIN='https://qdjjcewniayemmsiinec.supabase.co';
const ADMIN_BOOTSTRAP='if(/^\\/msadm\\/?$/.test(location.pathname))document.documentElement.classList.add("admin-route");';
const bootstrapHash=createHash('sha256').update(ADMIN_BOOTSTRAP).digest('base64');
const headers={
  'Content-Security-Policy':[
    "default-src 'self'",
    `script-src 'self' 'sha256-${bootstrapHash}'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${SUPABASE_ORIGIN} https://crm.fatek.solutions`,
    "font-src 'self'",
    `connect-src 'self' ${SUPABASE_ORIGIN}`,
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Referrer-Policy':'same-origin',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
};
function applySecurityHeaders(res){for(const [key,value]of Object.entries(headers))res.setHeader(key,value);}
module.exports={SUPABASE_ORIGIN,ADMIN_BOOTSTRAP,headers,applySecurityHeaders};
