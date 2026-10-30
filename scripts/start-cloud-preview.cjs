const {keys}=require('./cloud-access.cjs');
const {url,key}=keys();process.env.SUPABASE_URL=url;process.env.SUPABASE_SERVICE_ROLE_KEY=key;process.env.MS_USE_CLOUD='1';process.env.APP_ORIGINS='http://127.0.0.1:4173,http://localhost:4173';require('../server.cjs');
