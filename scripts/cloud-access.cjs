const {execFileSync}=require('node:child_process');
const ref='qdjjcewniayemmsiinec';
function keys(){const raw=execFileSync('supabase.exe',['projects','api-keys','--project-ref',ref,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']});const list=JSON.parse(raw);const key=list.find(k=>k.name==='service_role')?.api_key;const anon=list.find(k=>k.name==='anon')?.api_key;if(!key)throw Error('Service key unavailable');return {url:'https://'+ref+'.supabase.co',key,anon};}
module.exports={keys};
