const crypto=require('node:crypto'),sharp=require('sharp');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const clean=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max?v.trim():fail(400,'Confira os campos informados.');
const digest=t=>crypto.createHash('sha256').update(t).digest('hex');
const hash=(password,salt=crypto.randomBytes(16).toString('hex'))=>salt+':'+crypto.scryptSync(password,salt,64).toString('hex');
const config=()=>{if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)fail(503,'Integração indisponível.');return {url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY};};
async function remote(path,options={}){const {url,key}=config();return fetch(url+path,{...options,headers:{apikey:key,Authorization:'Bearer '+key,...options.headers},signal:AbortSignal.timeout(20000)});}
async function rpc(action,payload={},token=''){const r=await remote('/rest/v1/rpc/ms_store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,payload,session_token:token})});const data=await r.json();if(!r.ok){const message=data.code==='P0001'?data.message:'Não foi possível concluir a operação.';fail(message.startsWith('Entre na')?401:message.includes('exclusivo')?403:message.includes('Estoque')||message.includes('estoque mudou')?409:400,message);}return data;}
module.exports=async(req,res)=>{
 const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 try{
 const endpoint=req.url.split('?')[0],method=req.method;
 const allowed=(process.env.APP_ORIGINS||'').split(',').filter(Boolean);if(process.env.VERCEL_URL)allowed.push('https://'+process.env.VERCEL_URL);
 if(process.env.NODE_ENV!=='production')allowed.push('http://127.0.0.1:'+(process.env.PORT||4173));
 if(!allowed.length)fail(503,'Domínio ainda não configurado.');
 if(req.headers.origin&&!allowed.includes(req.headers.origin))fail(403,'Origem inválida.');
 const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('ms_session='))?.slice(11),sessionToken=token?digest(token):'';
 if(endpoint.startsWith('/api/images/')&&method==='GET'){const file=endpoint.slice(12);if(!/^[a-f0-9-]{36}\.webp$/.test(file))fail(404,'Imagem não encontrada.');const r=await remote('/storage/v1/object/authenticated/ms-product-photos/'+file);if(!r.ok)fail(404,'Imagem não encontrada.');res.writeHead(200,{'Content-Type':'image/webp','Cache-Control':'public,max-age=86400','X-Content-Type-Options':'nosniff'});return res.end(Buffer.from(await r.arrayBuffer()));}
 let body={};if(!['GET','HEAD'].includes(method)){
  if(!req.headers['content-type']?.startsWith('application/json'))fail(415,'Envie JSON.');
  // Vercel has a 4.5 MB request limit; browser uploads are resized before sending.
  if(req.body!==undefined){body=typeof req.body==='string'?JSON.parse(req.body):req.body;}else{let raw='';for await(const c of req){raw+=c;if(Buffer.byteLength(raw)>(endpoint.endsWith('/photos')?4000000:32768))fail(413,'Dados muito grandes.');}body=JSON.parse(raw||'{}');}
  if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'Dados inválidos.');
  if(Buffer.byteLength(JSON.stringify(body))>(endpoint.endsWith('/photos')?4000000:32768))fail(413,'Dados muito grandes.');
 }
 if(endpoint==='/api/session'&&method==='GET')return json(200,await rpc('session',{},sessionToken));
 if(endpoint==='/api/products'&&method==='GET')return json(200,await rpc('products'));
 if(endpoint==='/api/setup')fail(404,'Rota não encontrada.');
 const cookie=(token,age)=>`ms_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.NODE_ENV==='production'?'; Secure':''}`;
 if(['/api/login','/api/register'].includes(endpoint)&&method==='POST'){
  const ip=process.env.VERCEL?req.headers['x-vercel-forwarded-for']||req.socket?.remoteAddress:req.socket?.remoteAddress;
  const rate=await rpc('rate',{key:digest(String(ip||'unknown'))});if(!rate.allowed)fail(429,'Muitas tentativas. Aguarde um minuto.');
  const email=clean(body.email,3,160).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Informe um e-mail válido.');
  if(typeof body.password!=='string'||body.password.length<10||body.password.length>128)fail(400,'Use uma senha entre 10 e 128 caracteres.');
  let user;
  if(endpoint==='/api/login'){user=await rpc('login_lookup',{email});const stored=user?.password||hash('invalid-password');if(!crypto.timingSafeEqual(Buffer.from(hash(body.password,stored.split(':')[0])),Buffer.from(stored))||!user)fail(401,'E-mail ou senha incorretos.');}
  else user=await rpc('register',{id:crypto.randomUUID(),name:clean(body.name,2,100),email,password:hash(body.password)});
  const t=crypto.randomBytes(32).toString('hex');await rpc('create_session',{token:digest(t),user_id:user.id,expires:Date.now()+86400000},sessionToken);res.setHeader('Set-Cookie',cookie(t,86400));return json(200,{user:{id:user.id,name:user.name,email:user.email,role:user.role}});
 }
 if(endpoint==='/api/logout'&&method==='POST'){await rpc('logout',{},sessionToken);res.setHeader('Set-Cookie',cookie('',0));return json(200,{ok:true});}
 if(endpoint==='/api/profile'&&method==='PATCH')return json(200,await rpc('profile',{name:clean(body.name,2,100)},sessionToken));
 if(endpoint==='/api/orders'&&method==='GET')return json(200,await rpc('orders',{},sessionToken));
 if(endpoint==='/api/orders'&&method==='POST')return json(201,await rpc('order_create',{items:body.items},sessionToken));
 if(endpoint.startsWith('/api/admin/')){
  const {user}=await rpc('session',{},sessionToken);if(!user)fail(401,'Entre na sua conta para continuar.');if(user.role!=='admin')fail(403,'Acesso exclusivo da administração.');
  if(endpoint==='/api/admin/overview'&&method==='GET')return json(200,await rpc('overview',{},sessionToken));
  if(/^\/api\/admin\/orders\/[^/]+$/.test(endpoint)&&method==='PATCH')return json(200,await rpc('order_status',{id:endpoint.split('/')[4],status:body.status},sessionToken));
  if(/^\/api\/admin\/products\/[^/]+$/.test(endpoint)&&method==='PATCH'){if(!['Calças','Shorts'].includes(body.type))fail(400,'Categoria inválida.');return json(200,await rpc('product_update',{...body,id:endpoint.split('/')[4],name:clean(body.name,2,100),wash:clean(body.wash,2,80),description:clean(body.description,10,1500)},sessionToken));}
  if(/^\/api\/admin\/products\/[^/]+\/photos$/.test(endpoint)){
   const product_id=endpoint.split('/')[4];if(['PATCH','DELETE'].includes(method))return json(200,await rpc(method==='PATCH'?'photo_cover':'photo_delete',{product_id,id:body.id},sessionToken));
   if(method==='POST'){
    if(typeof body.base64!=='string'||body.base64.length>3900000||! /^[A-Za-z0-9+/]*={0,2}$/.test(body.base64))fail(400,'Imagem inválida ou muito grande.');let output;
    try{const input=sharp(Buffer.from(body.base64,'base64'),{limitInputPixels:40000000,animated:false}),meta=await input.metadata();if(!['jpeg','png','webp'].includes(meta.format)||(meta.pages||1)>1)fail(400,'Use JPG, PNG ou WebP sem animação.');output=await input.rotate().resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer();}catch(e){if(e.status)throw e;fail(400,'Imagem inválida.');}
    const id=crypto.randomUUID(),file=id+'.webp';const uploaded=await remote('/storage/v1/object/ms-product-photos/'+file,{method:'POST',headers:{'Content-Type':'image/webp'},body:output});if(!uploaded.ok)fail(502,'Não foi possível salvar a foto.');
    try{return json(200,await rpc('photo_add',{product_id,id,file},sessionToken));}catch(e){await remote('/storage/v1/object/ms-product-photos',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[file]})});throw e;}
   }
  }
 }
 fail(404,'Rota não encontrada.');
 }catch(e){json(e.status||500,{error:e.status?e.message:'Não foi possível concluir. Tente novamente.'});}
};
