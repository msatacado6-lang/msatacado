const crypto=require('node:crypto');
const defaultConfig={
 originCep:'95900018',
 environment:'production',
 token:'',
 pickupEnabled:true,
 pickupLabel:'Retirada na loja · Lajeado/RS',
 defaultWidth:28,
 defaultLength:36,
 defaultHeight:4,
 defaultWeight:0.50,
 insurancePerPiece:75,
 categoryWeights:{'Calças':0.55,'Shorts':0.35}
};
const cleanCep=v=>String(v||'').replace(/\D/g,'');
const withDefaults=raw=>({...defaultConfig,...(raw||{}),categoryWeights:{...defaultConfig.categoryWeights,...(raw?.categoryWeights||{})}});

// The Melhor Envio token is stored encrypted (AES-256-GCM); a database dump alone does not reveal it.
const keyFrom=secret=>crypto.createHash('sha256').update('ms-shipping-token:'+String(secret||'')).digest();
function encryptToken(plain,secret){
 if(!plain)return '';
 if(!secret)throw Object.assign(new Error('Chave de criptografia não configurada no servidor.'),{status:503});
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',keyFrom(secret),iv);
 const data=Buffer.concat([cipher.update(plain,'utf8'),cipher.final()]);
 return 'enc:v1:'+Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');
}
function decryptToken(stored,secret){
 if(!stored)return '';
 if(!stored.startsWith('enc:v1:'))return stored; // legacy plaintext, re-encrypted on next save
 if(!secret)return '';
 try{
  const raw=Buffer.from(stored.slice(7),'base64'),decipher=crypto.createDecipheriv('aes-256-gcm',keyFrom(secret),raw.subarray(0,12));
  decipher.setAuthTag(raw.subarray(12,28));
  return Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8');
 }catch{return '';}
}

function normalizeConfig(current={},incoming={},fail,secret){
 const merged=withDefaults(current);
 if(!incoming||typeof incoming!=='object')return merged;
 const cep=incoming.originCep!==undefined?cleanCep(incoming.originCep):merged.originCep;
 if(!/^\d{8}$/.test(cep))fail(400,'Informe um CEP de origem válido com 8 dígitos.');
 const env=incoming.environment!==undefined?String(incoming.environment):merged.environment;
 if(!['sandbox','production'].includes(env))fail(400,'Ambiente do Melhor Envio inválido.');
 const pickupEnabled=incoming.pickupEnabled!==undefined?Boolean(incoming.pickupEnabled):Boolean(merged.pickupEnabled);
 const pickupLabel=incoming.pickupLabel!==undefined?String(incoming.pickupLabel||'').trim():merged.pickupLabel;
 if(pickupLabel.length<2||pickupLabel.length>80)fail(400,'Informe o nome da opção de retirada (2 a 80 caracteres).');
 const num=(v,def,min,max,label)=>{const n=v!==undefined&&v!==''?Number(v):def;if(!Number.isFinite(n)||n<min||n>max)fail(400,`Confira o campo ${label}.`);return n;};
 const defaultWidth=Math.round(num(incoming.defaultWidth,merged.defaultWidth,11,100,'largura padrão'));
 const defaultLength=Math.round(num(incoming.defaultLength,merged.defaultLength,16,100,'comprimento padrão'));
 const defaultHeight=Math.round(num(incoming.defaultHeight,merged.defaultHeight,2,50,'altura por peça'));
 const defaultWeight=Number(num(incoming.defaultWeight,merged.defaultWeight,0.05,15,'peso padrão').toFixed(2));
 const insurancePerPiece=Number(num(incoming.insurancePerPiece,merged.insurancePerPiece,0,5000,'valor segurado por peça').toFixed(2));
 const categoryWeights={...merged.categoryWeights};
 if(incoming.categoryWeights&&typeof incoming.categoryWeights==='object'&&!Array.isArray(incoming.categoryWeights)){
  for(const [k,v] of Object.entries(incoming.categoryWeights).slice(0,60)){
   if(typeof k==='string'&&k.trim().length>=2&&k.trim().length<=60){
    categoryWeights[k.trim()]=Number(num(v,defaultWeight,0.05,15,`peso de ${k}`).toFixed(2));
   }
  }
 }
 let token=merged.token||'';
 if(incoming.clearToken===true)token='';
 else if(typeof incoming.token==='string'&&incoming.token.trim()){
  const t=incoming.token.trim();
  if(t.length<20||t.length>4000||/\s/.test(t))fail(400,'Token do Melhor Envio inválido.');
  token=encryptToken(t,secret);
 }else if(token&&!token.startsWith('enc:v1:'))token=encryptToken(token,secret);
 return {originCep:cep,environment:env,token,pickupEnabled,pickupLabel,defaultWidth,defaultLength,defaultHeight,defaultWeight,insurancePerPiece,categoryWeights};
}
function adminView(raw={},secret){
 const cfg=withDefaults(raw);
 const panelToken=decryptToken(cfg.token,secret);
 const envToken=process.env.MELHOR_ENVIO_TOKEN||'';
 const {token,...rest}=cfg;
 return {
  ...rest,
  hasToken:Boolean(panelToken||envToken),
  tokenSource:panelToken?'panel':envToken?'env':'none',
  tokenHint:panelToken?('Final '+panelToken.slice(-6)):envToken?'Definido no servidor':cfg.token?'Token salvo ilegível · cadastre novamente':'Não configurado'
 };
}
async function calculate(body,rawCfg,productsList,fail,secret){
 const cfg=withDefaults(rawCfg);
 const toCep=cleanCep(body?.cep);
 if(!/^\d{8}$/.test(toCep))fail(400,'Informe um CEP válido com 8 dígitos.');
 if(!Array.isArray(body?.items)||!body.items.length||body.items.length>40)fail(400,'Informe as peças para calcular o frete.');
 const byId=new Map((productsList||[]).map(p=>[String(p.id),p]));
 const grouped=new Map();
 let totalQty=0;
 for(const item of body.items){
  if(!item||typeof item!=='object')fail(400,'Item inválido para cotação.');
  const id=String(item.id||'');
  const p=byId.get(id);
  const qty=Number(item.qty);
  if(!p||!Number.isInteger(qty)||qty<1||qty>200)fail(400,'Peça ou quantidade inválida para cotação.');
  totalQty+=qty;
  grouped.set(id,(grouped.get(id)||0)+qty);
 }
 if(totalQty<1||totalQty>500)fail(400,'Quantidade total inválida para cotação.');
 const productsPayload=[];
 for(const [id,quantity] of grouped.entries()){
  const p=byId.get(id);
  productsPayload.push({id,width:cfg.defaultWidth,height:cfg.defaultHeight,length:cfg.defaultLength,weight:Number(cfg.categoryWeights[p.type]||cfg.defaultWeight||0.5),insurance_value:cfg.insurancePerPiece,quantity});
 }
 const quotes=[];
 if(cfg.pickupEnabled){
  quotes.push({id:'pickup',name:cfg.pickupLabel||'Retirada na loja · Lajeado/RS',company:'MS Atacado',price:0,days:0,note:'Rua Fialho de Vargas, 49 · Sala 101 · Centro'});
 }
 const activeToken=decryptToken(cfg.token,secret)||process.env.MELHOR_ENVIO_TOKEN||'';
 let carrierError='';
 if(activeToken){
  const baseUrl=process.env.MELHOR_ENVIO_API_URL||(cfg.environment==='sandbox'?'https://sandbox.melhorenvio.com.br':'https://melhorenvio.com.br');
  try{
   const r=await fetch(baseUrl+'/api/v2/me/shipment/calculate',{
    method:'POST',
    headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+activeToken,'User-Agent':'MS Atacado (contato@msatacado.com.br)'},
    body:JSON.stringify({from:{postal_code:cfg.originCep},to:{postal_code:toCep},products:productsPayload,options:{receipt:false,own_hand:false}}),
    signal:AbortSignal.timeout(15000)
   });
   const data=await r.json().catch(()=>null);
   if(!r.ok){
    carrierError=r.status===401||r.status===403?'Token do Melhor Envio inválido ou expirado.':'Não foi possível consultar as transportadoras no momento.';
   }else{
    const list=Array.isArray(data)?data:data?[data]:[];
    const carrierQuotes=list
     .filter(s=>s&&!s.error&&Number(s.custom_price||s.price)>0)
     .map(s=>({id:'me_'+String(s.id).slice(0,30),name:String((s.company?.name?s.company.name+' · ':'')+s.name).slice(0,100),company:String(s.company?.name||'Transportadora').slice(0,60),price:Number(Number(s.custom_price||s.price).toFixed(2)),days:Math.min(180,Math.max(0,Math.round(Number(s.custom_delivery_time||s.delivery_time||0))))}))
     .sort((a,b)=>a.price-b.price);
    quotes.push(...carrierQuotes);
    if(!carrierQuotes.length)carrierError='Nenhuma transportadora disponível para o CEP informado.';
   }
  }catch{
   carrierError='Tempo esgotado ao consultar o Melhor Envio.';
  }
 }
 if(!quotes.length)fail(502,carrierError||'Cotação de frete indisponível para este CEP.');
 return {cep:toCep,originCep:cfg.originCep,configured:Boolean(activeToken),carrierError,quotes};
}
// Never trust the shipping price sent by the browser: quote again on the server and keep only the chosen option id.
async function resolveOrderShipping(input,rawCfg,items,productsList,fail,secret){
 if(input===undefined||input===null)return null;
 if(typeof input!=='object'||Array.isArray(input))fail(400,'Dados de frete inválidos.');
 const id=typeof input.id==='string'&&/^[a-z0-9_]{1,40}$/i.test(input.id)?input.id:fail(400,'Modalidade de frete inválida.');
 const cep=cleanCep(input.cep);
 if(!/^\d{8}$/.test(cep))fail(400,'CEP de entrega inválido.');
 const quote=await calculate({cep,items:(Array.isArray(items)?items:[]).map(i=>({id:i?.id,qty:i?.qty}))},rawCfg,productsList,fail,secret);
 const chosen=quote.quotes.find(q=>q.id===id);
 if(!chosen)fail(409,'O frete mudou desde a cotação. Calcule o frete novamente na sacola.');
 return {cep,id:chosen.id,name:chosen.name,price:chosen.price,days:chosen.days};
}
module.exports={defaultConfig,cleanCep,normalizeConfig,adminView,calculate,resolveOrderShipping,encryptToken,decryptToken};
