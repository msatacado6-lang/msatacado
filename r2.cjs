// Cloudflare R2 (S3-compatible) client for product photos, signed with AWS SigV4 using only node:crypto.
// Active only when the four R2_* variables exist; otherwise cloud-api.cjs keeps using Supabase Storage.
const crypto=require('node:crypto');
const env=()=>({account:process.env.R2_ACCOUNT_ID,id:process.env.R2_ACCESS_KEY_ID,secret:process.env.R2_SECRET_ACCESS_KEY,bucket:process.env.R2_BUCKET});
const enabled=()=>{const e=env();return !!(e.account&&e.id&&e.secret&&e.bucket);};
const sha=d=>crypto.createHash('sha256').update(d).digest('hex');
const hmac=(k,d)=>crypto.createHmac('sha256',k).update(d).digest();
const enc=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
async function request(method,file,{body,type}={}){
 const {account,id,secret,bucket}=env(),host=account+'.r2.cloudflarestorage.com',path='/'+enc(bucket)+'/'+enc(file);
 const amz=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),day=amz.slice(0,8),payload=sha(body||'');
 const h={host,'x-amz-content-sha256':payload,'x-amz-date':amz};if(type)h['content-type']=type;
 const names=Object.keys(h).sort(),signed=names.join(';');
 const canonical=[method,path,'',names.map(n=>n+':'+h[n]).join('\n')+'\n',signed,payload].join('\n');
 const scope=day+'/auto/s3/aws4_request',toSign=['AWS4-HMAC-SHA256',amz,scope,sha(canonical)].join('\n');
 const key=['auto','s3','aws4_request'].reduce(hmac,hmac('AWS4'+secret,day));
 const signature=crypto.createHmac('sha256',key).update(toSign).digest('hex');
 delete h.host;
 return fetch('https://'+host+path,{method,body,headers:{...h,Authorization:'AWS4-HMAC-SHA256 Credential='+id+'/'+scope+', SignedHeaders='+signed+', Signature='+signature},signal:AbortSignal.timeout(20000)});
}
const put=(file,bytes)=>request('PUT',file,{body:bytes,type:'image/webp'});
const get=file=>request('GET',file);
const head=file=>request('HEAD',file);
const remove=file=>request('DELETE',file);
module.exports={enabled,put,get,head,remove};
