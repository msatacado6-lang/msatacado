const crypto=require('node:crypto'),sharp=require('sharp'),shipping=require('./shipping.cjs'),r2=require('./r2.cjs');
const shippingSecret=()=>process.env.MS_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const clean=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max?v.trim():fail(400,'Confira os campos informados.');
const cleanPhone=v=>{if(v===undefined||v===null||v==='')return '';const d=String(v).replace(/\D/g,'');if(d.length<10||d.length>11)fail(400,'Informe um WhatsApp válido com DDD.');return d;};
const validHrefs=['#catalogo','#catalogo?tipo=Calças','#catalogo?tipo=Shorts','#como-comprar','#atendimento','#loja'];
const digest=t=>crypto.createHash('sha256').update(t).digest('hex');
const hash=(password,salt=crypto.randomBytes(16).toString('hex'))=>salt+':'+crypto.scryptSync(password,salt,64).toString('hex');
const config=()=>{if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)fail(503,'Integração indisponível.');return {url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY};};
async function remote(path,options={}){const {url,key}=config();return fetch(url+path,{...options,headers:{apikey:key,Authorization:'Bearer '+key,...options.headers},signal:AbortSignal.timeout(20000)});}
async function rpc(action,payload={},token='',fn='ms_store'){const r=await remote('/rest/v1/rpc/'+fn,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,payload,session_token:token})});const data=await r.json();if(!r.ok){const message=data.code==='P0001'?data.message:'Não foi possível concluir a operação.';fail(message.startsWith('Entre na')?401:message.includes('exclusivo')?403:message.includes('Estoque')||message.includes('estoque mudou')?409:400,message);}return data;}
// Product photos: Cloudflare R2 when R2_* is configured, Supabase Storage otherwise. Reads fall back to Supabase for files not yet migrated.
async function storePhoto(file,bytes){const r=r2.enabled()?await r2.put(file,bytes):await remote('/storage/v1/object/ms-product-photos/'+file,{method:'POST',headers:{'Content-Type':'image/webp'},body:bytes});if(!r.ok)fail(502,'Não foi possível salvar a foto.');}
async function dropPhoto(file){try{if(r2.enabled())await r2.remove(file);else await remote('/storage/v1/object/ms-product-photos',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[file]})});}catch{}}
async function readPhoto(file){if(r2.enabled()){try{const r=await r2.get(file);if(r.ok)return r;}catch{}}return remote('/storage/v1/object/authenticated/ms-product-photos/'+file);}
module.exports=async(req,res)=>{
 const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 try{
 const endpoint=req.url.split('?')[0],method=req.method;
 const allowed=(process.env.APP_ORIGINS||'').split(',').filter(Boolean);
 for(const d of ['https://msatacado-rs.com.br','https://www.msatacado-rs.com.br'])if(!allowed.includes(d))allowed.push(d);
 if(process.env.VERCEL_URL)allowed.push('https://'+process.env.VERCEL_URL);
 if(process.env.NODE_ENV!=='production')allowed.push('http://127.0.0.1:'+(process.env.PORT||4173));
 if(!allowed.length)fail(503,'Domínio ainda não configurado.');
 if(req.headers.origin&&!allowed.includes(req.headers.origin))fail(403,'Origem inválida.');
 const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('ms_session='))?.slice(11),sessionToken=token?digest(token):'';
 if(endpoint.startsWith('/api/images/')&&method==='GET'){const file=endpoint.slice(12);if(!/^[a-f0-9-]{36}\.webp$/.test(file))fail(404,'Imagem não encontrada.');const r=await readPhoto(file);if(!r.ok)fail(404,'Imagem não encontrada.');res.writeHead(200,{'Content-Type':'image/webp','Cache-Control':'public, max-age=31536000, s-maxage=31536000, immutable','X-Content-Type-Options':'nosniff'});return res.end(Buffer.from(await r.arrayBuffer()));}
 let body={};if(!['GET','HEAD'].includes(method)){
  if(!req.headers['content-type']?.startsWith('application/json'))fail(415,'Envie JSON.');
  // Vercel has a 4.5 MB request limit; browser uploads are resized before sending.
  const isPhoto=endpoint.endsWith('/photos')||endpoint==='/api/admin/home/photo';
  if(req.body!==undefined){body=typeof req.body==='string'?JSON.parse(req.body):req.body;}else{let raw='';for await(const c of req){raw+=c;if(Buffer.byteLength(raw)>(isPhoto?4000000:32768))fail(413,'Dados muito grandes.');}body=JSON.parse(raw||'{}');}
  if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'Dados inválidos.');
  if(Buffer.byteLength(JSON.stringify(body))>(isPhoto?4000000:32768))fail(413,'Dados muito grandes.');
 }
 if(['/api/sitemap','/sitemap.xml'].includes(endpoint)&&method==='GET'){const xml=require('./sitemap.cjs')(await rpc('products'));res.writeHead(200,{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=0, s-maxage=300'});return res.end(xml);}
 if(endpoint==='/api/session'&&method==='GET')return json(200,await rpc('session',{},sessionToken));
 if(endpoint==='/api/categories'&&method==='GET')return json(200,await rpc('list',{},'','ms_categories'));
 if(endpoint==='/api/products'&&method==='GET')return json(200,await rpc('products'));
 if(endpoint==='/api/home'&&method==='GET')return json(200,await rpc('home'));
 const clientIp=String((process.env.VERCEL?req.headers['x-vercel-forwarded-for']||req.socket?.remoteAddress:req.socket?.remoteAddress)||'unknown');
 if(endpoint==='/api/shipping/calculate'&&method==='POST'){const rate=await rpc('rate',{key:digest('ship:'+clientIp)});if(!rate.allowed)fail(429,'Muitas consultas de frete. Aguarde um minuto.');const [cfg,list]=await Promise.all([rpc('get_config',{},'','ms_shipping'),rpc('products')]);return json(200,await shipping.calculate(body,cfg||{},list||[],fail,shippingSecret()));}
 if(endpoint==='/api/setup')fail(404,'Rota não encontrada.');
 const cookie=(token,age)=>`ms_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.NODE_ENV==='production'?'; Secure':''}`;
 if(['/api/login','/api/register','/api/admin/login'].includes(endpoint)&&method==='POST'){
  const ip=process.env.VERCEL?req.headers['x-vercel-forwarded-for']||req.socket?.remoteAddress:req.socket?.remoteAddress;
  const rate=await rpc('rate',{key:digest(String(ip||'unknown'))});if(!rate.allowed)fail(429,'Muitas tentativas. Aguarde um minuto.');
  const email=clean(body.email,3,160).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Informe um e-mail válido.');
  let user=await rpc('login_lookup',{email});
  if(endpoint==='/api/admin/login'){
   if(typeof body.password!=='string'||body.password.length<10||body.password.length>128)fail(400,'Use uma senha entre 10 e 128 caracteres.');
   if(user&&user.role!=='admin')fail(403,'Acesso exclusivo da administração.');
   const stored=user?.password||hash('invalid-password');
   if(!stored.includes(':')||!crypto.timingSafeEqual(Buffer.from(hash(body.password,stored.split(':')[0])),Buffer.from(stored))||!user)fail(401,'E-mail ou senha incorretos.');
  }else if(endpoint==='/api/login'){
   if(!user)return json(200,{user:null,needsRegistration:true,email});
   if(user.role==='admin'){
    if(typeof body.password!=='string'||!user.password?.includes(':')||!crypto.timingSafeEqual(Buffer.from(hash(body.password,user.password.split(':')[0])),Buffer.from(user.password)))fail(401,'Para conta administrativa, acesse pelo painel /msadm.');
   }
  }else{
   const name=clean(body.name,2,100),phone=cleanPhone(body.phone);
   if(user){if(user.role==='admin')fail(409,'Este e-mail já está cadastrado.');}
   else user=await rpc('register',{id:crypto.randomUUID(),name,email,password:'',phone});
  }
  const t=crypto.randomBytes(32).toString('hex');await rpc('create_session',{token:digest(t),user_id:user.id,scope:endpoint==='/api/admin/login'?'admin':'customer',expires:Date.now()+86400000},sessionToken);res.setHeader('Set-Cookie',cookie(t,86400));return json(200,{user:{id:user.id,name:user.name,email:user.email,phone:user.phone||'',role:user.role}});
 }
 if(endpoint==='/api/logout'&&method==='POST'){await rpc('logout',{},sessionToken);res.setHeader('Set-Cookie',cookie('',0));return json(200,{ok:true});}
 if(endpoint==='/api/profile'&&method==='PATCH')return json(200,await rpc('profile',{name:clean(body.name,2,100),phone:body.phone!==undefined?cleanPhone(body.phone):undefined},sessionToken));
 if(endpoint==='/api/orders'&&method==='GET')return json(200,await rpc('orders',{},sessionToken));
 if(endpoint==='/api/orders'&&method==='POST'){const s=await rpc('session',{},sessionToken);if(!s.user)fail(401,'Entre na sua conta para continuar.');let ship=null;if(body.shipping!==undefined&&body.shipping!==null){const [cfg,list]=await Promise.all([rpc('get_config',{},'','ms_shipping'),rpc('products')]);ship=await shipping.resolveOrderShipping(body.shipping,cfg||{},body.items,list||[],fail,shippingSecret());}return json(201,await rpc('order_create',{items:body.items,shipping:ship},sessionToken));}
 if(endpoint.startsWith('/api/admin/')){
  const {user,adminAuthenticated}=await rpc('session',{},sessionToken);if(!user)fail(401,'Entre na sua conta para continuar.');if(user.role!=='admin'||!adminAuthenticated)fail(403,'Acesso exclusivo da administração.');
  if(endpoint==='/api/admin/shipping'&&method==='GET')return json(200,shipping.adminView(await rpc('get_config',{},sessionToken,'ms_shipping'),shippingSecret()));
  if(endpoint==='/api/admin/shipping'&&method==='PATCH'){const current=await rpc('get_config',{},sessionToken,'ms_shipping');const next=shipping.normalizeConfig(current||{},body,fail,shippingSecret());await rpc('save_config',next,sessionToken,'ms_shipping');return json(200,shipping.adminView(next,shippingSecret()));}
  if(endpoint==='/api/admin/home'&&method==='PATCH')return json(200,await rpc('home_update',{eyebrow:clean(body.eyebrow,2,60),headline:clean(body.headline,2,80),highlight:clean(body.highlight,2,60),subtitle:clean(body.subtitle,5,220),ctaText:clean(body.ctaText,2,36),ctaHref:validHrefs.includes(body.ctaHref)?body.ctaHref:fail(400,'Destino inválido.')},sessionToken));
  if(endpoint==='/api/admin/home'&&method==='DELETE')return json(200,await rpc('home_reset',{},sessionToken));
  if(endpoint==='/api/admin/home/photo'&&method==='POST'){
   if(typeof body.base64!=='string'||body.base64.length>3900000||! /^[A-Za-z0-9+/]*={0,2}$/.test(body.base64))fail(400,'Imagem inválida ou muito grande.');let output;
   try{const input=sharp(Buffer.from(body.base64,'base64'),{limitInputPixels:40000000,animated:false}),meta=await input.metadata();if(!['jpeg','png','webp'].includes(meta.format)||(meta.pages||1)>1)fail(400,'Use JPG, PNG ou WebP sem animação.');output=await input.rotate().resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer();}catch(e){if(e.status)throw e;fail(400,'Imagem inválida.');}
   const id=crypto.randomUUID(),file=id+'.webp';await storePhoto(file,output);
   try{return json(200,await rpc('home_photo',{image:'/api/images/'+file},sessionToken));}catch(e){await dropPhoto(file);throw e;}
  }
  if(endpoint==='/api/admin/categories'&&method==='POST')return json(201,await rpc('create',{name:clean(body.name,2,60)},sessionToken,'ms_categories'));
  if(/^\/api\/admin\/products\/[^/]+$/.test(endpoint)&&method==='DELETE')return json(200,await rpc('delete',{id:endpoint.split('/')[4]},sessionToken,'ms_delete_product'));
  if(endpoint==='/api/admin/products'&&method==='POST'){body.type=clean(body.type,2,60);return json(201,await rpc('product_create',{...body,name:clean(body.name,2,100),wash:clean(body.wash,2,80),description:clean(body.description,10,1500)},sessionToken));}
  if(endpoint==='/api/admin/overview'&&method==='GET')return json(200,await rpc('overview',{},sessionToken));
  if(/^\/api\/admin\/orders\/[^/]+$/.test(endpoint)&&method==='PATCH')return json(200,await rpc('order_status',{id:endpoint.split('/')[4],status:body.status},sessionToken));
  if(/^\/api\/admin\/products\/[^/]+$/.test(endpoint)&&method==='PATCH'){body.type=clean(body.type,2,60);return json(200,await rpc('product_update',{...body,id:endpoint.split('/')[4],name:clean(body.name,2,100),wash:clean(body.wash,2,80),description:clean(body.description,10,1500)},sessionToken));}
  if(/^\/api\/admin\/products\/[^/]+\/photos$/.test(endpoint)){
   const product_id=endpoint.split('/')[4];if(['PATCH','DELETE'].includes(method))return json(200,await rpc(method==='PATCH'?'photo_cover':'photo_delete',{product_id,id:body.id},sessionToken));
   if(method==='POST'){
    if(typeof body.base64!=='string'||body.base64.length>3900000||! /^[A-Za-z0-9+/]*={0,2}$/.test(body.base64))fail(400,'Imagem inválida ou muito grande.');let output;
    try{const input=sharp(Buffer.from(body.base64,'base64'),{limitInputPixels:40000000,animated:false}),meta=await input.metadata();if(!['jpeg','png','webp'].includes(meta.format)||(meta.pages||1)>1)fail(400,'Use JPG, PNG ou WebP sem animação.');output=await input.rotate().resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer();}catch(e){if(e.status)throw e;fail(400,'Imagem inválida.');}
    const id=crypto.randomUUID(),file=id+'.webp';await storePhoto(file,output);
    try{return json(200,await rpc('photo_add',{product_id,id,file},sessionToken));}catch(e){await dropPhoto(file);throw e;}
   }
  }
 }
 fail(404,'Rota não encontrada.');
 }catch(e){json(e.status||500,{error:e.status?e.message:'Não foi possível concluir. Tente novamente.'});}
};
