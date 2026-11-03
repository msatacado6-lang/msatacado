const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const data=process.env.MS_DATA_DIR||path.join(__dirname,'data');fs.mkdirSync(data,{recursive:true});
const db=new DatabaseSync(path.join(data,'store.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT,role TEXT,created TEXT); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT,expires INTEGER); CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name TEXT,type TEXT,wash TEXT,image TEXT,description TEXT); CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,user_id TEXT,items TEXT,status TEXT,created TEXT); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);`);
const defaultHome={eyebrow:'ATACADO EM LAJEADO · RS',headline:'Sua próxima vitrine',highlight:'começa aqui.',subtitle:'Jeans de giro rápido para abastecer sua loja perto de você.',ctaText:'VER CATÁLOGO',ctaHref:'#catalogo',image:'/assets/hero.webp'};
const validHrefs=['#catalogo','#catalogo?tipo=Calças','#catalogo?tipo=Shorts','#como-comprar','#atendimento','#loja'];
const readHome=()=>{try{const r=db.prepare("SELECT value FROM settings WHERE key='home_banner'").get();return {...defaultHome,...(r?JSON.parse(r.value):{})};}catch{return {...defaultHome};}};
for(const p of [['wide','Jeans Wide Leg','Calças','Azul médio','wide.webp','Modelagem ampla de cintura alta e caimento estruturado.'],['reta','Jeans Reta','Calças','Índigo escuro','reta.webp','Corte reto clássico em lavagem índigo escura.'],['short','Short Jeans','Shorts','Azul claro','short.webp','Short jeans de cintura alta com barra dobrada.']])db.prepare('INSERT OR IGNORE INTO products VALUES(?,?,?,?,?,?)').run(...p);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const inventory=require('./inventory.cjs')(db,fail);
const photos=require('./photos.cjs')(db,data,fail);
const clean=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max?v.trim():fail(400,'Confira os campos informados.');
const hash=(p,s=crypto.randomBytes(16).toString('hex'))=>s+':'+crypto.scryptSync(p,s,64).toString('hex');
const digest=t=>crypto.createHash('sha256').update(t).digest('hex');
const publicUser=u=>u?{id:u.id,name:u.name,email:u.email,role:u.role}:null;
if(!db.prepare('PRAGMA table_info(sessions)').all().some(c=>c.name==='access_scope'))db.exec("ALTER TABLE sessions ADD COLUMN access_scope TEXT NOT NULL DEFAULT 'customer'");
db.exec('CREATE TABLE IF NOT EXISTS categories(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE)');
for(const p of db.prepare('SELECT DISTINCT type FROM products').all())db.prepare('INSERT OR IGNORE INTO categories VALUES(?,?)').run(crypto.randomUUID(),p.type);
db.exec('CREATE TABLE IF NOT EXISTS archived_products(product_id TEXT PRIMARY KEY)');
const attempts=new Map();
module.exports=async function api(req,res){
 const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value))};
 try{
 const port=process.env.PORT||4173,hosts=['127.0.0.1:'+port,'localhost:'+port];
 if(!hosts.includes(req.headers.host)||req.headers.origin&&!hosts.map(h=>'http://'+h).includes(req.headers.origin))fail(403,'Origem inválida.');
 if(req.url.startsWith('/api/images/')&&req.method==='GET')return await photos.serve(req.url.split('?')[0],res);
 let b={};if(!['GET','HEAD'].includes(req.method)){if(!req.headers['content-type']?.startsWith('application/json'))fail(415,'Envie JSON.');let raw='';for await(const c of req){raw+=c;if(Buffer.byteLength(raw)>((req.url.startsWith('/api/admin/products/')&&req.url.endsWith('/photos'))||req.url==='/api/admin/home/photo'?11300000:32768))fail(413,'Dados muito grandes.');}try{b=JSON.parse(raw||'{}')}catch{fail(400,'JSON inválido.')}if(!b||typeof b!=='object'||Array.isArray(b))fail(400,'Dados inválidos.');}
 const endpoint=req.url.split('?')[0],method=req.method;
 const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('ms_session='))?.slice(11);
 const user=token?db.prepare('SELECT u.*,s.access_scope FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?').get(digest(token),Date.now()):null;
 const auth=()=>{if(!user)fail(401,'Entre na sua conta para continuar.')};
 // First-admin provisioning is never exposed by the production web API.
 const setup=()=>process.env.NODE_ENV!=='production'&&!db.prepare("SELECT id FROM users WHERE role='admin'").get();
 if(endpoint==='/api/session'&&method==='GET')return json(200,{user:publicUser(user),setupNeeded:setup(),adminAuthenticated:user?.role==='admin'&&user?.access_scope==='admin'});
 if(endpoint==='/api/categories'&&method==='GET')return json(200,db.prepare('SELECT c.id,c.name,(SELECT COUNT(*) FROM products p WHERE p.type=c.name AND p.id NOT IN (SELECT product_id FROM archived_products)) AS productCount FROM categories c ORDER BY name').all());
 if(endpoint==='/api/products'&&method==='GET')return json(200,db.prepare('SELECT * FROM products WHERE id NOT IN (SELECT product_id FROM archived_products) ORDER BY rowid').all().map(inventory.read).map(photos.read));
 if(endpoint==='/api/home'&&method==='GET')return json(200,readHome());
 if(['/api/login','/api/register','/api/setup','/api/admin/login'].includes(endpoint)&&method==='POST'){
  const key=req.socket.remoteAddress;let rate=attempts.get(key);if(!rate||rate.until<Date.now())rate={n:0,until:Date.now()+60000};attempts.set(key,rate);if(++rate.n>20)fail(429,'Muitas tentativas. Aguarde um minuto.');
  const email=clean(b.email,3,160).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Informe um e-mail válido.');
  if(typeof b.password!=='string'||b.password.length<10||b.password.length>128)fail(400,'Use uma senha entre 10 e 128 caracteres.');
  let account;
  if(endpoint==='/api/login'||endpoint==='/api/admin/login'){account=db.prepare('SELECT * FROM users WHERE email=?').get(email);const stored=account?.password||hash('invalid-password');if(!crypto.timingSafeEqual(Buffer.from(hash(b.password,stored.split(':')[0])),Buffer.from(stored))||!account)fail(401,'E-mail ou senha incorretos.');}
  else{if(endpoint==='/api/setup'&&!setup())fail(403,'A administração já foi configurada.');const name=clean(b.name,2,100);if(db.prepare('SELECT id FROM users WHERE email=?').get(email))fail(409,'Este e-mail já está cadastrado.');account={id:crypto.randomUUID(),name,email,role:endpoint==='/api/setup'?'admin':'customer'};db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(account.id,name,email,hash(b.password),account.role,new Date().toISOString());}
  if(endpoint==='/api/admin/login'&&account.role!=='admin')fail(403,'Acesso exclusivo da administração.');
  if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());const t=crypto.randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions(token,user_id,expires,access_scope) VALUES(?,?,?,?)').run(digest(t),account.id,Date.now()+86400000,['/api/admin/login','/api/setup'].includes(endpoint)?'admin':'customer');res.setHeader('Set-Cookie',`ms_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);return json(200,{user:publicUser(account)});
 }
 if(endpoint==='/api/logout'&&method==='POST'){if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));res.setHeader('Set-Cookie','ms_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(200,{ok:true});}
 if(endpoint==='/api/profile'&&method==='PATCH'){auth();const name=clean(b.name,2,100);db.prepare('UPDATE users SET name=? WHERE id=?').run(name,user.id);return json(200,{user:{...publicUser(user),name}});}
 if(endpoint==='/api/orders'&&method==='POST'){
  auth();if(!Array.isArray(b.items)||!b.items.length||b.items.length>30)fail(400,'Seleção inválida.');const seen=new Set();
  const items=b.items.map(i=>{if(!i||typeof i!=='object')fail(400,'Peça inválida.');const p=db.prepare('SELECT * FROM products WHERE id=?').get(String(i.id));if(!p||!inventory.sizes.includes(i.size)||!Number.isInteger(i.qty)||i.qty<1||i.qty>99||seen.has(i.id+':'+i.size))fail(400,'Peça, tamanho ou quantidade inválida.');seen.add(i.id+':'+i.size);return {id:p.id,name:p.name,image:p.image,size:i.size,qty:i.qty};});
  if(items.reduce((n,i)=>n+i.qty,0)<6)fail(400,'O pedido mínimo é de 6 peças.');const id=crypto.randomUUID();inventory.transaction(()=>{inventory.reserve(items);db.prepare('INSERT INTO orders(id,user_id,items,status,created,stock_reserved) VALUES(?,?,?,?,?,1)').run(id,user.id,JSON.stringify(items),'Salvo',new Date().toISOString());});return json(201,{id});
 }
 if(endpoint==='/api/orders'&&method==='GET'){auth();return json(200,db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created DESC').all(user.id).map(o=>({...o,items:JSON.parse(o.items)})));}
 if(endpoint.startsWith('/api/admin/')){
  auth();if(user.role!=='admin'||user.access_scope!=='admin')fail(403,'Acesso exclusivo da administração.');
  if(process.env.MS_COMMERCE_MODE==='FATEK'&&/^\/api\/admin\/products(?:\/[0-9a-f-]{36})?$/.test(endpoint)){const result=await require('./fatek-product-admin.cjs').productRequest(method,endpoint.split('/')[4],b);return json(result.status,result.body);}
  if(endpoint==='/api/admin/home'&&method==='PATCH'){
   const next={...readHome(),eyebrow:clean(b.eyebrow,2,60),headline:clean(b.headline,2,80),highlight:clean(b.highlight,2,60),subtitle:clean(b.subtitle,5,220),ctaText:clean(b.ctaText,2,36),ctaHref:validHrefs.includes(b.ctaHref)?b.ctaHref:fail(400,'Destino inválido.')};
   db.prepare("INSERT OR REPLACE INTO settings VALUES('home_banner',?)").run(JSON.stringify(next));return json(200,next);
  }
  if(endpoint==='/api/admin/home/photo'&&method==='POST'){
   const {file}=await photos.saveImage(b.base64);const next={...readHome(),image:'/api/images/'+file};
   db.prepare("INSERT OR REPLACE INTO settings VALUES('home_banner',?)").run(JSON.stringify(next));return json(200,next);
  }
  if(endpoint==='/api/admin/home'&&method==='DELETE'){
   db.prepare("DELETE FROM settings WHERE key='home_banner'").run();return json(200,{...defaultHome});
  }
  if(endpoint.startsWith('/api/admin/products/')&&endpoint.endsWith('/photos'))return json(200,await photos.mutate(endpoint.split('/')[4],method,b));
  if(endpoint==='/api/admin/categories'&&method==='POST'){const name=clean(b.name,2,60).replace(/\s+/g,' ');if(name.toLowerCase()==='todos')fail(400,'Escolha outro nome para a categoria.');if(db.prepare('SELECT id FROM categories WHERE name=? COLLATE NOCASE').get(name))fail(409,'Essa categoria já está cadastrada.');const id=crypto.randomUUID();db.prepare('INSERT INTO categories VALUES(?,?)').run(id,name);return json(201,{id,name,productCount:0});}
  if(/^\/api\/admin\/products\/[^/]+$/.test(endpoint)&&method==='DELETE'){const id=endpoint.split('/')[4];if(!db.prepare('SELECT id FROM products WHERE id=?').get(id))fail(404,'Produto não encontrado.');db.prepare('INSERT OR IGNORE INTO archived_products VALUES(?)').run(id);return json(200,{ok:true});}
  if(endpoint==='/api/admin/products'&&method==='POST'){const name=clean(b.name,2,100),wash=clean(b.wash,2,80),description=clean(b.description,10,1500);if(!db.prepare('SELECT id FROM categories WHERE name=?').get(typeof b.type==='string'?b.type:''))fail(400,'Categoria inválida.');const id=crypto.randomUUID();inventory.transaction(()=>{db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?)').run(id,name,b.type,wash,'placeholder.svg',description);inventory.replace(id,b.variants||[],0);});return json(201,photos.read(inventory.read(db.prepare('SELECT * FROM products WHERE id=?').get(id))));}
  if(endpoint==='/api/admin/overview'&&method==='GET')return json(200,{orders:db.prepare('SELECT o.*,u.name,u.email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.created DESC').all().map(o=>({...o,items:JSON.parse(o.items)})),customers:db.prepare("SELECT id,name,email,created FROM users WHERE role='customer' ORDER BY created DESC").all()});
  if(endpoint.startsWith('/api/admin/orders/')&&method==='PATCH'){if(!['Salvo','Em análise','Concluído','Cancelado'].includes(b.status))fail(400,'Situação inválida.');inventory.status(endpoint.split('/').pop(),b.status);return json(200,{ok:true});}
  if(endpoint.startsWith('/api/admin/products/')&&method==='PATCH'){const name=clean(b.name,2,100),wash=clean(b.wash,2,80),description=clean(b.description,10,1500);if(!db.prepare('SELECT id FROM categories WHERE name=?').get(typeof b.type==='string'?b.type:''))fail(400,'Categoria inválida.');inventory.transaction(()=>{const id=endpoint.split('/').pop();if(!db.prepare('UPDATE products SET name=?,type=?,wash=?,description=? WHERE id=?').run(name,b.type,wash,description,id).changes)fail(404,'Produto não encontrado.');if(b.variants!==undefined)inventory.replace(id,b.variants,b.inventoryVersion);});return json(200,{ok:true});}
 }
 fail(404,'Rota não encontrada.');
 }catch(e){json(e.status||500,{error:e.status?e.message:'Não foi possível concluir. Tente novamente.'});}
};
