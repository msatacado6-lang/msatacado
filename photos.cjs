const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp');
module.exports=(db,data,fail)=>{
 const folder=path.join(data,'photos');fs.mkdirSync(folder,{recursive:true});
 db.exec('CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,product_id TEXT NOT NULL,file TEXT NOT NULL)');
 const list=id=>db.prepare('SELECT id,file FROM photos WHERE product_id=? ORDER BY rowid').all(id).map(p=>({...p,url:'/api/images/'+p.file}));
 const read=p=>({...p,photos:list(p.id)});
 async function serve(endpoint,res){const file=endpoint.slice('/api/images/'.length);if(!/^[a-f0-9-]{36}\.webp$/.test(file))fail(404,'Imagem não encontrada.');let bytes;try{bytes=await fs.promises.readFile(path.join(folder,file));}catch{fail(404,'Imagem não encontrada.');}res.writeHead(200,{'Content-Type':'image/webp','X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=86400'});res.end(bytes);}
 async function mutate(productId,method,body){const product=db.prepare('SELECT * FROM products WHERE id=?').get(productId);if(!product)fail(404,'Produto não encontrado.');
  if(method==='POST'){
   if(list(productId).length>=8)fail(400,'Limite de 8 fotos por peça.');
   if(typeof body.base64!=='string'||body.base64.length>11200000||! /^[A-Za-z0-9+/]*={0,2}$/.test(body.base64))fail(400,'Imagem inválida ou maior que 8 MB.');
   const bytes=Buffer.from(body.base64,'base64');if(!bytes.length||bytes.length>8*1024*1024)fail(400,'Use imagens de até 8 MB.');
   let output;try{const input=sharp(bytes,{limitInputPixels:40000000,animated:false});const meta=await input.metadata();if(!['jpeg','png','webp'].includes(meta.format)||(meta.pages||1)>1)fail(400,'Use JPG, PNG ou WebP sem animação.');output=await input.rotate().resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer();}catch(e){if(e.status)throw e;fail(400,'Não foi possível ler esta imagem. Use JPG, PNG ou WebP.');}
   const id=crypto.randomUUID(),file=id+'.webp';await fs.promises.writeFile(path.join(folder,file),output);
   // Recheck after decoding, since other requests can finish meanwhile.
   db.exec('BEGIN IMMEDIATE');try{if(list(productId).length>=8)fail(400,'Limite de 8 fotos por peça.');const first=list(productId).length===0;db.prepare('INSERT INTO photos VALUES(?,?,?)').run(id,productId,file);if(first)db.prepare('UPDATE products SET image=? WHERE id=?').run('/api/images/'+file,productId);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');await fs.promises.unlink(path.join(folder,file));throw e;}
  }else{
   const photo=list(productId).find(p=>p.id===body.id);if(!photo)fail(404,'Foto não encontrada nesta peça.');
   if(method==='PATCH')db.prepare('UPDATE products SET image=? WHERE id=?').run(photo.url,productId);
   else if(method==='DELETE'){db.prepare('DELETE FROM photos WHERE id=?').run(photo.id);if(product.image===photo.url){const next=list(productId)[0]?.url||({wide:'wide.webp',reta:'reta.webp',short:'short.webp'})[productId];db.prepare('UPDATE products SET image=? WHERE id=?').run(next,productId);}
    // Keep the file for historical order snapshots that already reference it.
   }else fail(405,'Método não permitido.');
  }
  return read(db.prepare('SELECT * FROM products WHERE id=?').get(productId));
 }
 return {read,serve,mutate};
};
