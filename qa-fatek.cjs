const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),puppeteer=require('puppeteer');
const productId='10000000-0000-4000-8000-000000000001',variantId='10000000-0000-4000-8000-000000000002',secondId='10000000-0000-4000-8000-000000000003',buyerId='20000000-0000-4000-8000-000000000001';
const product={id:productId,name:'Camiseta da integração',category:'Roupas',description:'Peça com grade canônica.',imageUrl:'https://crm.fatek.solutions/api/images/cover.webp',images:['https://crm.fatek.solutions/api/images/extra.webp'],axes:['Cor','Tamanho'],variants:[{id:variantId,values:['Preto','M',null],available:true,availableQuantity:3,price:89.9},{id:secondId,values:['Azul','M',null],available:false,availableQuantity:0,price:89.9}]};
const policy={enabled:true,frontend:'EXTERNAL',authProvider:'SUPABASE',checkout:'WHATSAPP',registration:'OPEN',catalogVisibility:'PUBLIC',priceVisibility:'PUBLIC',minPieces:1,minSubtotal:0,quantityMultiple:1,shippingEnabled:true,pickupEnabled:true,shippingOnRequest:false};
const store={version:1,store:{name:'MS Atacado',currency:'BRL',locale:'pt-BR',policy,handlingDays:null,shippingSupported:true},buyer:null,access:{catalog:true,prices:true,order:true}};
let record={id:productId,name:product.name,category:'Roupas',description:'Peça com grade canônica.',costPrice:30,sellPrice:89.9,revision:5,catalogVisible:true,imageUrl:product.imageUrl,images:product.images,grade:{options:[{name:'Cor',values:['Preto','Azul']},{name:'Tamanho',values:['M']}],variants:[{id:variantId,values:['Preto','M'],stockQty:3,isActive:true,costPrice:null,sellPrice:99.9,sku:null,barcode:null,imageUrl:null},{id:secondId,values:['Azul','M'],stockQty:0,isActive:true,costPrice:null,sellPrice:null,sku:null,barcode:null,imageUrl:null}]}};
const orderCalls=[],productCalls=[],orders=[];let profileInput,quoteInput,createdProduct=null,creationAttempts=0,rejectNextCreate=true,denyNextRetry=false;
const reply=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const server=http.createServer(async(req,res)=>{
 require('./security-headers.cjs').applySecurityHeaders(res);
 const route=req.url.split('?')[0];let body={};if(req.method!=='GET'){let raw='';for await(const c of req)raw+=c;body=JSON.parse(raw||'{}');}
 const admin=(req.headers.cookie||'').includes('fixture-admin=1');
 if(route==='/api/integration')return reply(res,200,{mode:'FATEK',supabaseUrl:'https://qdjjcewniayemmsiinec.supabase.co',publishableKey:'sb_publishable_synthetic_public_key',capabilities:{productWrites:true}});
 if(route==='/api/home')return reply(res,200,{});
 if(route==='/api/session')return reply(res,200,{user:admin?{id:'staff',name:'Gestão fixture',email:'admin@example.test',role:'admin'}:null,adminAuthenticated:admin,setupNeeded:false});
 if(route==='/api/admin/login'){assert.equal(body.email,'admin@example.test');res.setHeader('Set-Cookie','fixture-admin=1; HttpOnly; SameSite=Strict; Path=/');return reply(res,200,{user:{id:'staff',role:'admin'}});}
 if(route.startsWith('/api/admin/')&&!admin)return reply(res,403,{error:'Acesso restrito.'});
 if(route==='/api/admin/product-media'){assert.equal(req.method,'POST');return reply(res,201,{imageUrl:'https://crm.fatek.solutions/api/images/10000000-0000-4000-8000-000000000099.webp'});}
 if(route==='/api/admin/overview')return reply(res,200,{orders:[],customers:[]});
 if(route==='/api/admin/products'&&req.method==='GET')return reply(res,200,{items:[record,...(createdProduct?[createdProduct]:[])]});
 if(route==='/api/admin/products/'+productId&&req.method==='GET')return reply(res,200,record);
 if(createdProduct&&route==='/api/admin/products/'+createdProduct.id&&req.method==='GET')return reply(res,200,createdProduct);
 if(route==='/api/admin/products/'+productId&&req.method==='PATCH'){
  productCalls.push(body);if(body.expectedRevision!==record.revision)return reply(res,409,{error:'Cadastro mudou.',code:'PRODUCT_CONFLICT'});
  record={...record,...body,...(body.gallery?{images:body.gallery}:{}),grade:body.grade?{...body.grade,variants:body.grade.variants.map(v=>({...v,stockQty:record.grade.variants.find(old=>old.id===v.id)?.stockQty||0}))}:record.grade,revision:record.revision+1};return reply(res,200,{id:productId,revision:record.revision});
 }
 if(route==='/api/admin/products'&&req.method==='POST'){
  productCalls.push(body);
  if(rejectNextCreate){rejectNextCreate=false;return reply(res,422,{error:'Grade rejeitada antes de gravar.',code:'INVALID_GRADE'});}
  if(denyNextRetry){denyNextRetry=false;return reply(res,403,{error:'Permissão suspensa.',code:'FORBIDDEN'});}
  creationAttempts++;
  if(!createdProduct)createdProduct={...body,id:'10000000-0000-4000-8000-000000000099',revision:1,grade:{...body.grade,variants:body.grade.variants.map((v,i)=>({...v,id:'10000000-0000-4000-8000-00000000009'+i,stockQty:0,isActive:true}))}};
  if(creationAttempts===1){await new Promise(r=>setTimeout(r,500));return reply(res,503,{error:'Não foi possível confirmar o resultado. Preserve o formulário e repita o mesmo cadastro.',code:'PRODUCT_OUTCOME_UNKNOWN'});}
  return reply(res,200,{id:createdProduct.id,revision:1,replayed:true});
 }
 const file=path.join(__dirname,'dist',route==='/'||route==='/msadm'?'index.html':route);
 try{const content=fs.readFileSync(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.webp')?'image/webp':'application/octet-stream');res.end(content);}catch{res.writeHead(404);res.end();}
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;let browser;
 try{
 browser=await puppeteer.launch({headless:true});const page=await browser.newPage(),errors=[],popups=[],violations=[];page.on('pageerror',e=>errors.push(e.message));page.on('popup',p=>popups.push(p));
 await page.evaluateOnNewDocument(()=>{window.cspViolations=[];document.addEventListener('securitypolicyviolation',e=>window.cspViolations.push({directive:e.violatedDirective,blocked:e.blockedURI}));});
 await page.setRequestInterception(true);page.on('request',request=>{
  const url=new URL(request.url());if(url.origin===base)return request.continue();
  if(url.hostname==='crm.fatek.solutions'&&url.pathname.startsWith('/api/images/'))return request.respond({status:200,contentType:'image/webp',body:fs.readFileSync('dist/assets/wide.webp')});
  if(url.hostname!=='qdjjcewniayemmsiinec.supabase.co')return request.abort();
  const headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Headers':'authorization,apikey,content-type,idempotency-key,x-client-info,x-supabase-api-version','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
  const send=(value,status=200)=>request.respond({status,contentType:'application/json',headers,body:JSON.stringify(value)});
  if(request.method()==='OPTIONS')return request.respond({status:204,headers});
  if(url.pathname.startsWith('/auth/v1/')){
   const now=Math.floor(Date.now()/1000),user={id:buyerId,email:'buyer@example.test',aud:'authenticated',role:'authenticated',email_confirmed_at:new Date().toISOString(),user_metadata:{name:'Comprador',role:'admin'}};
   const token=Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:buyerId,exp:now+3600,iat:now,role:'authenticated'})).toString('base64url')+'.synthetic';
   return send({access_token:token,refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,expires_at:now+3600,user});
  }
  const route=url.pathname.split('/functions/v1/storefront/')[1];
  if(route==='store')return send(store);
  if(route==='products')return send({items:[product],nextCursor:null,pricesVisible:true});
  if(route==='categories')return send({categories:['Roupas']});
  if(route==='me')return send({buyer:{id:buyerId,name:'Comprador',email:'buyer@example.test',approved:true}});
  if(route==='me/sync'||route==='me/profile'){if(route==='me/profile'&&request.method()==='POST')profileInput=JSON.parse(request.postData());return send({syncState:'LINKED',profile:{name:'Comprador',phone:profileInput?.phone||null,revision:'2026-11-03T12:00:00Z'}});}
  if(route==='cart/quote'){quoteInput=JSON.parse(request.postData());return send({id:'30000000-0000-4000-8000-000000000001',items:[{...quoteInput.items[0],name:product.name,label:'Preto · M',unitPrice:89.9}],subtotal:89.9,pieces:1,delivery:quoteInput.delivery,options:[{id:'shipping',name:'Entrega fixture',price:12,days:null}],expiresAt:new Date(Date.now()+900000).toISOString()});}
  if(route==='orders'){
   const body=JSON.parse(request.postData()),key=request.headers()['idempotency-key'];orderCalls.push({body,key});
   const receipt={id:'40000000-0000-4000-8000-000000000001',reference:'MS-FIXTURE',status:'RECEIVED',items:[{productId,variantId,quantity:1,name:product.name,label:'Preto · M',unitPrice:89.9}],subtotal:89.9,shippingCost:12,total:101.9,createdAt:new Date().toISOString(),whatsappUrl:'https://wa.me/5551999999999?text=Pedido'};
   if(!orders.length)orders.push(receipt);return orderCalls.length===1?send({error:'CONNECTION_UNAVAILABLE'},503):send(receipt);
  }
  if(route==='me/orders')return send({orders});return send({error:'NOT_FOUND'},404);
 });
 await page.setViewport({width:390,height:844});await page.goto(base+'/#produto/'+productId);await page.waitForSelector('[data-size="'+variantId+'"]');
 assert.equal(await page.$eval('[data-size="'+secondId+'"]',e=>e.disabled),true);assert(await page.$eval('main',e=>e.textContent.includes('Preto · M')));
 await page.waitForSelector('[data-gallery]');assert.equal(await page.$$eval('[data-gallery]',els=>els.length),2);await page.click('[data-gallery="'+product.images[0]+'"]');assert.equal(await page.$eval('.gallery-main',e=>e.src),product.images[0]);await page.click('[data-gallery="'+product.imageUrl+'"]');assert.equal(await page.$eval('.gallery-main',e=>e.src),product.imageUrl);
 await page.click('[data-size="'+variantId+'"]');await page.click('[data-add]');await page.click('#open-cart');await page.click('[data-review]');
 await page.waitForSelector('[data-account-form="login"]');await page.type('[name=email]','buyer@example.test');await page.type('[name=password]','SyntheticPassword123!');await page.click('[data-account-form] button');await page.waitForSelector('.account-sidebar').catch(async e=>{console.log('LOGIN UI:',await page.$eval('main',e=>e.innerText),errors);throw e;});
 assert.equal(await page.$eval('.account-sidebar',e=>e.textContent.includes('Administração')),false);
 await page.evaluate(()=>location.hash='conta/dados');await page.waitForSelector('[data-account-form="profile"]');await page.type('[data-account-form="profile"] [name=phone]','51999991234');await page.click('[data-account-form="profile"] button');await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Dados atualizados.');assert.deepEqual(profileInput,{revision:'2026-11-03T12:00:00Z',name:'Comprador',phone:'51999991234'});
 await page.evaluate(id=>location.hash='produto/'+id,productId);await page.waitForSelector('[data-size="'+variantId+'"]');await page.click('[data-size="'+variantId+'"]');
 await page.type('[data-cep-input="product"]','95900000');await page.click('[data-calc-shipping="product"]');await page.waitForSelector('[data-shipping-results="product"] .shipping-quotes');assert.equal(quoteInput.items[0].variantId,variantId);assert.equal(quoteInput.items[0].quantity,1);
 await page.click('#open-cart');await page.click('[data-review]');await page.waitForSelector('[data-fatek-quote]');
 for(const [name,value] of Object.entries({phone:'51999999999',postalCode:'95900000',street:'Rua teste',number:'10',district:'Centro'}))await page.type('[data-fatek-quote] [name='+name+']',value);
 await page.click('[data-fatek-quote] button');await page.waitForSelector('[data-fatek-confirm]');assert.equal(quoteInput.items[0].variantId,variantId);assert.equal(quoteInput.delivery.postalCode,'95900000');
 await page.click('[data-fatek-confirm] [type=submit]');await page.waitForSelector('[data-fatek-retry-order]');assert.equal(orderCalls.length,1);await page.click('[data-fatek-retry-order]');await page.waitForSelector('a[href^="https://wa.me/"]');assert.deepEqual(orderCalls[0],orderCalls[1]);assert.equal(popups.length,0);assert.equal(await page.$eval('#cart-count',e=>e.textContent),'0');
 fs.mkdirSync('qa',{recursive:true});await page.screenshot({path:'qa/fatek-receipt-mobile.png'});
 await page.goto(base+'/msadm#admin/produtos');await page.waitForSelector('[data-admin="true"]');await page.type('[name=email]','admin@example.test');await page.type('[name=password]','SyntheticPassword123!');await page.click('[data-account-form] button');await page.waitForSelector('.stats');await page.evaluate(()=>location.hash='admin/produtos');await page.waitForSelector('[data-edit-product]');await page.click('[data-edit-product]');await page.waitForSelector('[data-fatek-product]');
 await page.click('[data-close-product]');await page.evaluate(()=>location.hash='admin/frete');await page.waitForSelector('a[href="https://crm.fatek.solutions/settings/shipping"]');assert.equal(await page.$('[data-shipping-admin-form]'),null);await page.evaluate(()=>location.hash='admin/produtos');await page.waitForSelector('[data-edit-product]');await page.click('[data-edit-product]');await page.waitForSelector('[data-fatek-product]');
 assert.equal(await page.$eval('[data-fatek-product] input[readonly]',e=>e.readOnly),true);
 record.revision++;await page.$eval('[name=sellPrice]',e=>e.value='95');await page.click('[data-fatek-product] [type=submit]');await page.waitForFunction(()=>document.querySelector('#product-dialog .form-error').textContent.length>0);assert.equal(await page.$eval('[name=sellPrice]',e=>e.value),'95');assert.equal(record.sellPrice,89.9);assert.equal(record.grade.variants[0].stockQty,3);
 assert.equal(await page.$eval('[data-editor-variant] [data-grade-price="sellPrice"]',e=>e.value),'99.9');
 await page.screenshot({path:'qa/fatek-editor-mobile.png'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 // Reload a fresh revision, then clear an override and promote the extra image.
 await page.click('[data-close-product]');await page.click('[data-edit-product]');await page.waitForSelector('[data-fatek-product]');
 await page.$eval('[data-editor-variant] [data-grade-price="sellPrice"]',e=>e.value='');
 await page.click('[data-editor-cover="1"]');await page.click('[data-editor-remove-photo="1"]');
 await page.click('[data-fatek-product] [type=submit]');await page.waitForFunction(()=>!document.querySelector('#product-dialog').open);
 assert.equal(record.grade.variants[0].sellPrice,null);assert.equal(record.imageUrl,product.images[0]);assert.deepEqual(record.gallery,[]);assert.equal(record.grade.variants[0].stockQty,3);
 await page.click('[data-new-product]');await page.waitForSelector('[data-fatek-product="new"]');
 for(const [name,value]of Object.entries({name:'Nova peça do painel',category:'Roupas',costPrice:'20',sellPrice:'80',description:'Peça criada pela integração.'}))await page.type('[data-fatek-product] [name='+name+']',value);
 await page.click('[data-add-editor-row]');await page.type('[data-grade-value="0"]','Preto');await page.type('[data-grade-value="1"]','M');
 await page.click('[data-add-editor-row]');await page.$$eval('[data-editor-variant]',rows=>{rows[1].querySelector('[data-grade-value="0"]').value='Azul';rows[1].querySelector('[data-grade-value="1"]').value='G';});
 const callsBefore=productCalls.length;
 await page.click('[data-fatek-product] [type=submit]');await page.waitForFunction(()=>document.querySelector('.form-error').textContent.includes('Faltam 2'));assert.equal(productCalls.length,callsBefore);
 await page.click('[data-complete-editor-grade]');assert.equal(await page.$$eval('[data-editor-variant]',rows=>rows.length),4);
 await page.$eval('[data-grade-price="sellPrice"]',e=>e.value='119.9');
 await(await page.$('[data-editor-photos]')).uploadFile(path.resolve('dist/assets/wide.webp'));
 await page.click('[data-fatek-product] [type=submit]');await page.waitForFunction(()=>document.querySelector('.form-error').textContent.toLowerCase().includes('grade'));
 assert.equal(await page.evaluate(()=>sessionStorage.getItem(editorAttemptKey())),null,'definite first rejection releases the intent');
 await page.$eval('[name=name]',e=>e.value='Nome corrigido');
 await page.click('[data-fatek-product] [type=submit]');
 await page.waitForFunction(()=>document.querySelector('[data-fatek-product]').dataset.saving==='true');
 assert(await page.$$eval('#product-dialog input,#product-dialog button,#product-dialog textarea',els=>els.every(e=>e.disabled)));
 await page.waitForFunction(()=>document.querySelector('.form-error').textContent.includes('confirmar'));
 const pending=await page.evaluate(()=>sessionStorage.getItem(editorAttemptKey()));assert(pending);
 // A close/reopen must recover the exact body; denied permission after an unknown
 // result cannot release that request ID and accidentally create another product.
 await page.click('[data-close-product]');await page.click('[data-new-product]');await page.waitForSelector('[data-fatek-product="new"]');denyNextRetry=true;
 await page.click('[data-fatek-product] [type=submit]');await page.waitForFunction(()=>document.querySelector('.form-error').textContent.length>0);
 assert.equal(await page.evaluate(()=>sessionStorage.getItem(editorAttemptKey())),pending);
 await page.click('[data-fatek-product] [type=submit]');await page.waitForFunction(()=>!document.querySelector('#product-dialog').open);
 assert.equal(creationAttempts,2);assert.equal(createdProduct.imageUrl,'https://crm.fatek.solutions/api/images/10000000-0000-4000-8000-000000000099.webp');assert.deepEqual(productCalls.at(-1),productCalls.at(-2));assert.deepEqual(productCalls.at(-1),productCalls.at(-3));assert.equal(createdProduct.grade.variants.length,4);assert.equal(createdProduct.grade.variants[0].sellPrice,119.9);assert.equal(createdProduct.grade.variants[0].stockQty,0);
 await page.setViewport({width:1440,height:1000});await page.screenshot({path:'qa/fatek-admin-desktop.png'});await page.waitForSelector('[data-edit-product="'+createdProduct.id+'"]',{visible:true});await page.click('[data-edit-product="'+createdProduct.id+'"]');await page.waitForSelector('[data-fatek-product]');await page.screenshot({path:'qa/fatek-editor-desktop.png'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.click('[data-close-product]');assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.cspViolations),[]);
 await page.evaluate(()=>fetch('https://unapproved.example.test/collect').catch(()=>{}));await page.waitForFunction(()=>window.cspViolations.length>0);assert.equal(await page.evaluate(()=>window.cspViolations[0].directive),'connect-src');
 console.log('PASS: integrated canonical color/size and price; mobile checkout, CEP quote, Auth buyer isolation, uncertain order replay with one key, WhatsApp only after receipt, admin stale edit, inherited/override prices, cover/gallery edits, complete matrix, definite validation correction, controls locked during save and durable create replay even after lost permission, recovered product shipping calculator and restrictive CSP (approved Supabase allowed, unrelated origin blocked), desktop/mobile with no JS errors. Synthetic transport only.');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
