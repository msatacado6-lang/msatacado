const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {headers,SUPABASE_ORIGIN,ADMIN_BOOTSTRAP,applySecurityHeaders}=require('../security-headers.cjs');
test('one restrictive policy is shared by the local and Vercel servers, with only the approved Supabase connection',()=>{
 const config=require('../vercel.json'),production=Object.fromEntries(config.headers.find(r=>r.source==='/(.*)').headers.map(h=>[h.key,h.value]));
 assert.deepEqual(production,headers);
 const policy=headers['Content-Security-Policy'],directives=Object.fromEntries(policy.split('; ').map(v=>{const [name,...values]=v.split(' ');return [name,values];}));
 assert.deepEqual(directives['connect-src'],["'self'",SUPABASE_ORIGIN]);
 assert(!policy.includes('unsafe-eval'));assert(!directives['script-src'].includes("'unsafe-inline'"));assert(!policy.includes('*'));
 assert.deepEqual(directives['frame-ancestors'],["'none'"]);assert.deepEqual(directives['object-src'],["'none'"]);
 const inline=[...fs.readFileSync('dist/index.html','utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 assert.deepEqual(inline,[ADMIN_BOOTSTRAP]);
 for(const source of inline)assert(directives['script-src'].includes("'sha256-"+crypto.createHash('sha256').update(source).digest('base64')+"'"));
 const observed={};applySecurityHeaders({setHeader:(k,v)=>observed[k]=v});assert.deepEqual(observed,headers);
 assert.equal(config.git.deploymentEnabled['codex/fatek-api-adapter'],false);
});
test('legacy phone data is preserved without weakening password authentication or administrator scope',async()=>{
 const os=require('node:os'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ms-recovered-phone-'));
 const reservation=http.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const child=spawn(process.execPath,['server.cjs'],{env:{...process.env,PORT:String(port),MS_DATA_DIR:folder,MS_COMMERCE_MODE:'LEGACY'},stdio:'ignore'});
 const call=async(route,method='GET',body,cookie)=>{const r=await fetch('http://127.0.0.1:'+port+'/api/'+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try {
  let ready=false;for(let i=0;i<40;i++){try{await call('session');ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}assert(ready);
  const buyer=await call('register','POST',{name:'Contato',email:'phone@example.test',password:'SyntheticPass123!',phone:'(51) 99999-1234',role:'admin'});
  assert.equal(buyer.status,200);assert.equal(buyer.data.user.phone,'51999991234');assert.equal(buyer.data.user.role,'customer');
  assert.equal((await call('login','POST',{email:'phone@example.test'})).status,400);
  assert.equal((await call('admin/login','POST',{email:'phone@example.test',password:'SyntheticPass123!'})).status,403);
  assert.equal((await call('profile','PATCH',{name:'Contato revisto',phone:'inválido'},buyer.cookie)).status,400);
  assert.equal((await call('session','GET',null,buyer.cookie)).data.user.phone,'51999991234');
  const updated=await call('profile','PATCH',{name:'Contato revisto',phone:'(51) 98888-4321'},buyer.cookie);assert.equal(updated.data.user.phone,'51988884321');
 } finally {child.kill();await new Promise(r=>child.once('exit',r));fs.rmSync(folder,{recursive:true,force:true});}
});
