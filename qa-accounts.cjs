const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),puppeteer=require('puppeteer');
(async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'ms-test-')),port=4187,base='http://127.0.0.1:'+port;
 const server=spawn(process.execPath,['server.cjs'],{env:{...process.env,PORT:String(port),MS_DATA_DIR:data},stdio:'ignore'});let browser;
 const call=async(url,method='GET',body,cookie)=>{const r=await fetch(base+'/api/'+url,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
 for(let i=0;i<40;i++){try{await call('session');break}catch{await new Promise(r=>setTimeout(r,100))}}
 const password='test-password-123';
 const admin=await call('setup','POST',{name:'Gestão MS',email:'admin@example.test',password});assert.equal(admin.status,200);
 for(const product of (await call('products')).data) await call('admin/products/'+product.id,'PATCH',{...product,variants:[{size:'38',quantity:30},{size:'40',quantity:10}]},admin.cookie);
 assert.equal((await call('setup','POST',{name:'Outro',email:'other@example.test',password})).status,403);
 const a=await call('register','POST',{name:'Cliente Ana',email:'ana@example.test',password,role:'admin'});assert.equal(a.data.user.role,'customer');
 const b=await call('register','POST',{name:'Cliente Bia',email:'bia@example.test',password});
 assert.equal((await call('admin/login','POST',{email:'ana@example.test',password})).status,403);
 const normalAdmin=await call('login','POST',{email:'admin@example.test',password,scope:'admin'});
 assert.equal((await call('session','GET',null,normalAdmin.cookie)).data.adminAuthenticated,false);
 assert.equal((await call('admin/overview','GET',null,normalAdmin.cookie)).status,403);
 assert.equal((await call('admin/products/wide','PATCH',{},normalAdmin.cookie)).status,403);
 const explicitAdmin=await call('admin/login','POST',{email:'admin@example.test',password});
 assert.equal((await call('session','GET',null,explicitAdmin.cookie)).data.adminAuthenticated,true);
 assert.equal((await call('admin/overview','GET',null,explicitAdmin.cookie)).status,200);

 assert.equal((await call('admin/overview','GET',null,a.cookie)).status,403);
 assert.equal((await call('orders')).status,401);
 assert.equal((await call('orders','POST',{items:[{id:'wide',size:'38',qty:5}]},a.cookie)).status,400);
 assert.equal((await call('orders','POST',{items:[{id:'wide',size:'38',qty:6}]},a.cookie)).status,201);
 assert.equal((await call('orders','GET',null,b.cookie)).data.length,0);
 const orders=(await call('orders','GET',null,a.cookie)).data;assert.equal(orders.length,1);
 assert.equal((await call('admin/orders/'+orders[0].id,'PATCH',{status:'Em análise'},admin.cookie)).status,200);
 assert.equal((await call('orders','GET',null,a.cookie)).data[0].status,'Em análise');
 assert.equal((await call('admin/login','POST',{email:'admin@example.test',password:'wrong-password'})).status,401);
 assert.equal((await call('login','POST',{email:'admin@example.test'})).status,401);
 assert.equal((await call('login','POST',{email:'novo@example.test'})).data.needsRegistration,true);
 const cross=await fetch(base+'/api/logout',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.test'},body:'{}'});assert.equal(cross.status,403);
 await call('logout','POST',{},b.cookie);assert.equal((await call('orders','GET',null,b.cookie)).status,401);
 browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));fs.mkdirSync('qa',{recursive:true});
 await p.setViewport({width:1440,height:1000});await p.goto(base+'/#conta');await p.waitForSelector('[data-account-form="login"]');await p.type('[name=email]','ana@example.test');await p.click('[data-account-form] button');await p.waitForSelector('.order-card');await p.screenshot({path:'qa/account-desktop.png',fullPage:true});
 await p.evaluate(()=>{location.hash='produto/wide'});await p.waitForSelector('[data-add]');await p.click('[data-size="38"]');for(let i=0;i<5;i++)await p.click('[data-qty="1"]');await p.click('[data-add]');await p.click('#open-cart');await p.click('[data-review]');await p.waitForSelector('[data-save-order]');await p.click('[data-save-order]');await p.waitForFunction(()=>document.querySelectorAll('.order-card').length===2);await p.reload();await p.waitForFunction(()=>document.querySelectorAll('.order-card').length===2);
 await p.click('[data-logout]');await p.waitForSelector('[data-account-form="login"]');await p.type('[name=email]','carla@example.test');await p.click('[data-account-form] button');await p.waitForSelector('[data-account-form="register"] [name=name]');await p.type('[name=name]','Cliente Carla');await p.type('[name=phone]','51996180830');await p.click('[data-account-form] button');await p.waitForSelector('.account-sidebar');await p.click('[data-logout]');await p.waitForSelector('[data-account-form="login"]');await p.evaluate(()=>location.hash='admin');await p.waitForSelector('[data-admin="true"]');await p.type('[name=email]','admin@example.test');await p.type('[name=password]',password);await p.click('[data-account-form] button');await p.waitForSelector('.stats');await p.screenshot({path:'qa/admin-desktop.png',fullPage:true});
 await p.evaluate(()=>location.hash='admin/produtos');await p.waitForSelector('[data-edit-product="wide"]');await p.click('[data-edit-product="wide"]');await p.waitForSelector('[data-product]');await p.$eval('[data-product="wide"] [name=name]',e=>e.value='Wide Leg editada');await p.click('[data-product="wide"] button:not([type="button"])');await p.waitForFunction(()=>document.querySelector('#toast').textContent==='Peça salva.');assert.equal((await call('products')).data[0].name,'Wide Leg editada');
 await p.setViewport({width:390,height:844,isMobile:true});for(const page of ['admin','admin/produtos','admin/clientes','admin/pedidos','conta','conta/dados','inicio','catalogo']){await p.evaluate(page=>location.hash=page,page);await p.waitForFunction(()=>!document.querySelector('main').textContent.includes('Carregando sua área'));await new Promise(r=>setTimeout(r,200));assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+page);}
 await p.evaluate(()=>location.hash='admin');await p.waitForSelector('.stats');await p.screenshot({path:'qa/admin-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 await p.goto(base+'/#conta');await p.waitForSelector('.account-sidebar');await p.click('[data-logout]');await p.waitForSelector('[data-account-form="login"]');await p.type('[name=email]','ana@example.test');await p.click('[data-account-form] button');await p.waitForSelector('.account-sidebar');assert.equal(await p.$$eval('a[href^="#admin"]',x=>x.length),0);await p.goto(base+'/msadm');await p.waitForSelector('[data-account-form="login"]');assert.equal(await p.$('.stats'),null);await p.type('[name=email]','admin@example.test');await p.type('[name=password]',password);await p.click('[data-account-form] button');await p.waitForSelector('.stats');assert.equal(new URL(p.url()).pathname,'/msadm');
 console.log('PASS: auth, isolated orders, minimum 6, roles, setup lock, logout, origin guard, cart save, reload, catalog edit, desktop/mobile.');
 }finally{if(browser)await browser.close();server.kill();await new Promise(r=>server.once('exit',r));fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
