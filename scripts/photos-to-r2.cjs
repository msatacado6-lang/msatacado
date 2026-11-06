// Copia as fotos do bucket ms-product-photos (Supabase Storage) para o Cloudflare R2.
// Nao apaga nada do Supabase. Pode rodar de novo: o que ja esta no R2 e pulado.
// Credenciais do R2 vem do arquivo .env.r2 (ignorado pelo git e pelo deploy):
//   R2_ACCOUNT_ID=...  R2_ACCESS_KEY_ID=...  R2_SECRET_ACCESS_KEY=...  R2_BUCKET=ms-product-photos
const fs=require('node:fs'),path=require('node:path');
const envFile=path.resolve(__dirname,'..','.env.r2');
if(fs.existsSync(envFile))for(const line of fs.readFileSync(envFile,'utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
const r2=require('../r2.cjs'),{keys}=require('./cloud-access.cjs');
(async()=>{
 if(!r2.enabled())throw Error('Faltam R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY ou R2_BUCKET em .env.r2');
 const {url,key}=keys(),auth={apikey:key,Authorization:'Bearer '+key};
 const names=[];for(let offset=0;;offset+=100){const r=await fetch(url+'/storage/v1/object/list/ms-product-photos',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({prefix:'',limit:100,offset,sortBy:{column:'name',order:'asc'}})});if(!r.ok)throw Error('Listagem do Supabase falhou ('+r.status+')');const page=await r.json();names.push(...page.map(o=>o.name).filter(n=>/^[a-f0-9-]{36}\.webp$/.test(n)));if(page.length<100)break;}
 let copied=0,skipped=0,bytes=0;const failed=[];
 for(const file of names){
  try{
   if((await r2.head(file)).ok){skipped++;continue;}
   const src=await fetch(url+'/storage/v1/object/authenticated/ms-product-photos/'+file,{headers:auth});if(!src.ok)throw Error('download '+src.status);
   const body=Buffer.from(await src.arrayBuffer()),up=await r2.put(file,body);if(!up.ok)throw Error('upload '+up.status);
   const check=await r2.head(file);if(!check.ok||Number(check.headers.get('content-length'))!==body.length)throw Error('conferencia');
   copied++;bytes+=body.length;
  }catch(e){failed.push(file+' ('+e.message+')');}
 }
 console.log('Fotos no Supabase:',names.length,'| copiadas agora:',copied,'('+(bytes/1048576).toFixed(1)+' MB) | ja estavam no R2:',skipped,'| falharam:',failed.length);
 if(failed.length){console.log(failed.join('\n'));process.exitCode=1;}
})().catch(e=>{console.error('Migracao parada:',e.message,'(nenhuma chave e exibida)');process.exitCode=1;});
