'use strict';
const sharp = require('sharp'), {randomUUID} = require('node:crypto');
async function uploadProductMedia(body, env=process.env, transport=fetch) {
  const fail=(status,error)=>({status,body:{error}});
  if(env.MS_FATEK_PRODUCT_WRITES!=='1'||!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(env.SUPABASE_URL||'')||!env.SUPABASE_SERVICE_ROLE_KEY||!/^https:\/\/[a-z0-9.-]+$/.test(env.FATEK_STORE_ORIGIN||''))return fail(503,'O envio de fotos ainda não foi configurado.');
  if(typeof body.base64!=='string'||body.base64.length>3900000||!body.base64.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64))return fail(400,'Imagem inválida ou muito grande.');
  let output;
  try {
    const input=sharp(Buffer.from(body.base64,'base64'),{limitInputPixels:40000000,animated:false}),meta=await input.metadata();
    if(!['jpeg','png','webp'].includes(meta.format)||(meta.pages||1)>1)return fail(400,'Use JPG, PNG ou WebP sem animação.');
    output=await input.rotate().resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer();
  }catch{return fail(400,'Imagem inválida.');}
  const file=randomUUID()+'.webp';
  try {
    const result=await transport(env.SUPABASE_URL+'/storage/v1/object/ms-product-photos/'+file,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'image/webp'},body:output});
    if(!result.ok)return fail(502,'Não foi possível enviar a foto.');
    return {status:201,body:{imageUrl:env.FATEK_STORE_ORIGIN+'/api/images/'+file}};
  }catch{return fail(503,'Não foi possível confirmar o envio da foto. Tente novamente.');}
}
module.exports={uploadProductMedia};
