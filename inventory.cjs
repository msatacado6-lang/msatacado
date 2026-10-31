// All inventory changes run in the same SQLite transaction as their order.
module.exports=function inventory(db,fail){
 const sizes=['PP','P','M','G','GG','XG','XGG',...Array.from({length:15},(_,i)=>String(32+i*2))];
 db.exec(`CREATE TABLE IF NOT EXISTS variants(product_id TEXT,size TEXT,quantity INTEGER NOT NULL CHECK(quantity>=0),PRIMARY KEY(product_id,size));
 CREATE TABLE IF NOT EXISTS inventory_versions(product_id TEXT PRIMARY KEY,version INTEGER NOT NULL DEFAULT 0);`);
 if(!db.prepare('PRAGMA table_info(orders)').all().some(c=>c.name==='stock_reserved'))db.exec('ALTER TABLE orders ADD COLUMN stock_reserved INTEGER NOT NULL DEFAULT 0');
 const version=id=>db.prepare('SELECT version FROM inventory_versions WHERE product_id=?').get(id)?.version||0;
 const bump=id=>db.prepare('INSERT INTO inventory_versions VALUES(?,1) ON CONFLICT(product_id) DO UPDATE SET version=version+1').run(id);
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
 function read(p){return {...p,inventoryVersion:version(p.id),variants:db.prepare('SELECT size,quantity FROM variants WHERE product_id=? ORDER BY rowid').all(p.id)};}
 function validate(list){if(!Array.isArray(list)||list.length>sizes.length)fail(400,'Informe os tamanhos e suas quantidades.');const seen=new Set();for(const v of list){if(!v||!sizes.includes(v.size)||seen.has(v.size)||!Number.isInteger(v.quantity)||v.quantity<0||v.quantity>99999)fail(400,'Use tamanhos únicos e quantidades inteiras de 0 a 99999.');seen.add(v.size);}return list;}
 function replace(id,list,expected){validate(list);if(expected!==version(id))fail(409,'O estoque mudou desde que você abriu o cadastro. Recarregue a página antes de editar novamente.');db.prepare('DELETE FROM variants WHERE product_id=?').run(id);for(const v of list)db.prepare('INSERT INTO variants VALUES(?,?,?)').run(id,v.size,v.quantity);bump(id);}
 function reserve(items){for(const i of items){if(db.prepare('SELECT product_id FROM archived_products WHERE product_id=?').get(i.id))fail(409,'Esta peça foi excluída do catálogo. Revise o carrinho.');const r=db.prepare('UPDATE variants SET quantity=quantity-? WHERE product_id=? AND size=? AND quantity>=?').run(i.qty,i.id,i.size,i.qty);if(!r.changes)fail(409,`${i.name}, tamanho ${i.size}: quantidade indisponível. Revise o carrinho.`);bump(i.id);}}
 function restore(items){for(const i of items){db.prepare('INSERT INTO variants VALUES(?,?,?) ON CONFLICT(product_id,size) DO UPDATE SET quantity=quantity+excluded.quantity').run(i.id,i.size,i.qty);bump(i.id);}}
 function status(id,next){return transaction(()=>{const order=db.prepare('SELECT * FROM orders WHERE id=?').get(id);if(!order)fail(404,'Pedido não encontrado.');if(order.status===next)return;let reserved=order.stock_reserved;const items=JSON.parse(order.items);if(next==='Cancelado'&&reserved){restore(items);reserved=0;}else if(order.status==='Cancelado'&&next!=='Cancelado'){reserve(items);reserved=1;}db.prepare('UPDATE orders SET status=?,stock_reserved=? WHERE id=?').run(next,reserved,id);});}
 return {sizes,read,transaction,replace,reserve,status};
};
