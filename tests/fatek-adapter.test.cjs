const test = require('node:test'), assert = require('node:assert/strict'), esbuild = require('esbuild');
const { publicConfig, withIntegration } = require('../integration-mode.cjs');
const { productRequest } = require('../fatek-product-admin.cjs');
const code = esbuild.buildSync({ entryPoints:['integrations/fatek/adapter.js'],bundle:true,format:'cjs',platform:'node',write:false }).outputFiles[0].text;
const module_ = { exports:{} }; new Function('module','exports','require',code)(module_,module_.exports,require);
const {createAdapter,mapProduct,mapOrder} = module_.exports;
const project='https://abcdefghijklmnopqrst.supabase.co', config={mode:'FATEK',supabaseUrl:project,publishableKey:'sb_publishable_synthetic_key',capabilities:{productWrites:true}};
const id='10000000-0000-4000-8000-000000000001', variant='10000000-0000-4000-8000-000000000002';
function fixture(api={}) {
  const store=new Map(); let subject='buyer-a';
  const storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
  const auth={getSession:async()=>({data:{session:{user:{id:subject},access_token:'synthetic-current-token'}}})};
  return {adapter:createAdapter(config,{api,auth,storage}),store,setSubject:s=>{subject=s;}};
}
const receipt={id,reference:'MS-1',items:[{productId:id,variantId:variant,quantity:2,label:'Preto · M',name:'Peça'}],createdAt:new Date().toISOString(),whatsappUrl:'https://wa.me/5551999999999?text=Pedido'};
test('default is legacy, configuration exposes no privileged key and malformed opt-in fails closed',()=>{
  assert.deepEqual(publicConfig({}),{mode:'LEGACY'});
  const c=publicConfig({MS_COMMERCE_MODE:'FATEK',SUPABASE_URL:project,SUPABASE_PUBLISHABLE_KEY:config.publishableKey,FATEK_PRODUCT_KEY:'secret',SUPABASE_SERVICE_ROLE_KEY:'secret'});
  assert.equal(JSON.stringify(c).includes('secret'),false);assert.throws(()=>publicConfig({MS_COMMERCE_MODE:'typo'}));
});
test('connected mode cannot call old stock/order/customer mutations, including direct requests',async()=>{
  const previous=process.env.MS_COMMERCE_MODE; Object.assign(process.env,{MS_COMMERCE_MODE:'FATEK',SUPABASE_URL:project,SUPABASE_PUBLISHABLE_KEY:config.publishableKey});
  let calls=0;const handler=withIntegration(()=>{calls++;});
  try{for(const url of ['/api/orders','/api/profile','/api/register','/api/admin/orders/'+id,'/api/admin/products/'+id]){
    let status;await handler({url,method:'POST',headers:{}},{writeHead:s=>{status=s;},end:()=>{}});assert.equal(status,409);
  }assert.equal(calls,0);}finally{if(previous===undefined)delete process.env.MS_COMMERCE_MODE;else process.env.MS_COMMERCE_MODE=previous;delete process.env.SUPABASE_URL;delete process.env.SUPABASE_PUBLISHABLE_KEY;}
});
test('color and size retain canonical variant IDs, sold-out and hidden prices are never invented',()=>{
  const p=mapProduct({id,name:'Peça',description:null,category:'Roupas',imageUrl:'javascript:alert(1)',images:[],axes:['Cor','Tamanho'],variants:[{id:variant,values:['Preto','M',null],available:true,availableQuantity:3},{id:'other',values:['Azul','M',null],available:false,availableQuantity:0}]});
  assert.equal(p.variants[0].size,variant);assert.equal(p.variants[0].label,'Preto · M');assert.equal(p.variants[1].quantity,0);assert.equal(p.variants[0].price,undefined);assert.equal(p.image,'/assets/placeholder.svg');
});
test('pagination fetches all pages and rejects a cursor cycle',async()=>{
  let n=0;const {adapter}=fixture({products:async()=>({items:[],nextCursor:++n===1?'next':null})});await adapter.catalog();assert.equal(n,2);
  const bad=fixture({products:async()=>({items:[],nextCursor:'same'})});await assert.rejects(()=>bad.adapter.catalog());
});
test('timeout preserves the same durable order key/body across a new adapter and explicit retry',async()=>{
  const calls=[];const api={placeOrder:async(input,key)=>{calls.push({input,key});if(calls.length===1)throw Object.assign(Error(),{status:503,outcomeUnknown:true});return receipt;}};
  const f=fixture(api),input={quoteId:id,shippingOption:'pickup',phone:'51999999999'};
  await assert.rejects(()=>f.adapter.submit(input));assert(f.store.size);await assert.rejects(()=>f.adapter.submit({...input,phone:'different'}),{code:'PENDING_ORDER'});
  const result=await f.adapter.retry();assert.equal(result.reference,'MS-1');assert.deepEqual(calls[0],calls[1]);assert.equal(f.store.size,0);
});
test('pending requests belong to their buyer, and quota/permission failures cannot silently use local orders',async()=>{
  const f=fixture({placeOrder:async()=>{throw Object.assign(Error(),{status:503,outcomeUnknown:true});}});await assert.rejects(()=>f.adapter.submit({quoteId:id}));f.setSubject('buyer-b');assert.equal(await f.adapter.pending(),null);
  let called=false;await assert.rejects(()=>f.adapter.request('orders','POST',{items:[]},()=>{called=true;}));assert.equal(called,false);
});
test('storage failure prevents dispatch; invalid WhatsApp targets are never offered',async()=>{
  let calls=0;const a=createAdapter(config,{auth:{getSession:async()=>({data:{session:{user:{id:'a'}}}})},api:{placeOrder:()=>{calls++;}},storage:{getItem:()=>null,setItem:()=>{throw Error('Unavailable');}}});
  await assert.rejects(()=>a.submit({quoteId:id}));assert.equal(calls,0);assert.equal(mapOrder({...receipt,whatsappUrl:'https://attacker.invalid'}).whatsappUrl,'');
});
test('profile forwards the displayed revision; it never reads a newer revision to overwrite a CRM edit',async()=>{
  let captured;const f=fixture({updateProfile:async v=>{captured=v;return {profile:{name:'Nome'}};}});
  await f.adapter.request('profile','PATCH',{revision:'old',name:'Nome',role:'admin'},()=>{});
  assert.deepEqual(captured,{revision:'old',name:'Nome'});
});
test('product credential stays server-only and cannot select arbitrary upstreams or methods',async()=>{
  let captured;const env={MS_FATEK_PRODUCT_WRITES:'1',FATEK_PRODUCT_KEY:'fprod_'+'a'.repeat(48),FATEK_STORE_ORIGIN:'https://store.example'};
  const transport=async(url,options)=>{captured={url,options};return Response.json({id,revision:1});};
  assert.equal((await productRequest('POST',null,{name:'Peça'},env,transport)).status,200);
  assert.equal(captured.url,'https://crm.fatek.solutions/api/store/editor/v1/products');assert.equal(captured.options.headers['x-fatek-product-key'],env.FATEK_PRODUCT_KEY);
  assert.equal((await productRequest('PATCH','../customers',{},env,transport)).status,400);
  assert.equal((await productRequest('DELETE',id,{},env,transport)).status,400);
  assert.equal((await productRequest('POST',null,{}, {},transport)).status,503);
});
