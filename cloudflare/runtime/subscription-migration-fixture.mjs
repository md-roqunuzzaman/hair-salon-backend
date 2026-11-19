import { applyMigrations } from './migrations.mjs';

export function verifySubscriptionUpgrade(storage, migrations) {
  const sql = (statement, ...params) => storage.sql.exec(statement, ...params);
  const snapshot = () => sql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").toArray().map(({name}) => [name,sql(`SELECT * FROM "${name}"`).toArray().map(row=>JSON.stringify(Object.fromEntries(Object.entries(row).sort()))).sort()]);
  const schema = () => sql("SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name,type").toArray();
  const equal = (a,b,message) => { if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(message); };
  const rejects = (fn,message) => {try{fn();}catch{return;}throw new Error(message);};
  const before=snapshot(), beforeSchema=schema();
  rejects(()=>applyMigrations(storage,[...migrations.slice(0,43),{...migrations[43],sql:migrations[43].sql+'; SELECT * FROM injected_subscription_failure;'}]),'v44 injected failure must reject');
  equal(snapshot(),before,'v44 rollback changed data/ledger');
  equal(schema(),beforeSchema,'v44 rollback left schema objects');
  applyMigrations(storage,migrations.slice(0,44));
  equal(snapshot().filter(([name])=>before.some(([old])=>name===old)&&name!=='_Migrations'),before.filter(([name])=>name!=='_Migrations'),'v44 changed historical data');
  for(const table of ['SubscriptionPlan','AddonFeature','BrandSubscription','BrandSubscriptionAddon'])equal(sql(`SELECT COUNT(*) AS n FROM ${table}`).one().n,0,'Migration must not invent subscriptions or pricing');
  sql("INSERT INTO SubscriptionPlan(id,code,name,price,updatedAt) VALUES ('plan','STANDARD','Standard',50000,1)");
  sql("INSERT INTO AddonFeature(id,code,name,price,updatedAt) VALUES ('addon','WALLET','Wallet',12000,1)");
  const brand=sql('SELECT id FROM Brand LIMIT 1').one().id;
  sql("INSERT INTO BrandSubscription(id,brandId,planId,startAt,endAt,basePrice,addonsPrice,totalPrice,updatedAt) VALUES ('subscription',?,'plan',1,2,50000,12000,62000,1)",brand);
  sql("INSERT INTO BrandSubscriptionAddon(id,subscriptionId,addonId,startAt,endAt,updatedAt) VALUES ('selected','subscription','addon',1,2,1)");
  for(const statement of ["UPDATE BrandSubscription SET brandId='missing'","UPDATE BrandSubscription SET planId='missing'","UPDATE BrandSubscriptionAddon SET subscriptionId='missing'","UPDATE BrandSubscriptionAddon SET addonId='missing'","DELETE FROM SubscriptionPlan WHERE id='plan'","DELETE FROM AddonFeature WHERE id='addon'","DELETE FROM BrandSubscription WHERE id='subscription'",`DELETE FROM Brand WHERE id='${brand.replaceAll("'","''")}'`,"INSERT INTO SubscriptionPlan(id,code,name,price,updatedAt) VALUES ('duplicate','STANDARD','Duplicate',1,1)","INSERT INTO AddonFeature(id,code,name,price,updatedAt) VALUES ('duplicate','WALLET','Duplicate',1,1)","INSERT INTO BrandSubscriptionAddon(id,subscriptionId,addonId,startAt,endAt,updatedAt) VALUES ('duplicate','subscription','addon',1,2,1)"])
    rejects(()=>sql(statement),'Subscription FK/delete/unique constraint missing');
  for(const [table,fields] of [['SubscriptionPlan',['price']],['AddonFeature',['price']],['BrandSubscription',['basePrice','addonsPrice','totalPrice']]])for(const field of fields){
    for(const value of ['1.5','1000000000000'])rejects(()=>sql(`UPDATE ${table} SET ${field}=${value}`),'Money update accepted fractional minor units or overflow');
    const trigger=sql("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?",`money_${table}_${field}_INSERT`).toArray();
    equal(trigger.length,1,'Money insert trigger missing');
  }
  sql("UPDATE SubscriptionPlan SET id='renamed-plan'");
  equal(sql('SELECT planId,totalPrice FROM BrandSubscription').one(),{planId:'renamed-plan',totalPrice:62000},'Plan update must cascade without repricing snapshots');
  sql("UPDATE AddonFeature SET price=9900");
  equal(sql('SELECT basePrice,addonsPrice,totalPrice,currency,status FROM BrandSubscription').one(),{basePrice:50000,addonsPrice:12000,totalPrice:62000,currency:'HKD',status:'ACTIVE'},'Historical price snapshot changed');
  const stable=snapshot(), stableSchema=schema();
  applyMigrations(storage,migrations.slice(0,44));
  equal(snapshot(),stable,'v44 repeated startup changed rows/ledger');
  equal(schema(),stableSchema,'v44 repeated startup changed schema');
  equal(sql('PRAGMA foreign_key_check').toArray(),[],'v44 FK violations');
  rejects(()=>applyMigrations(storage,[...migrations.slice(0,44),{...migrations[44],sql:migrations[44].sql+'; SELECT * FROM injected_branch_limit_failure;'}]),'v45 injected failure must reject');
  equal(snapshot(),stable,'v45 failed migration changed historical rows');
  equal(schema(),stableSchema,'v45 failed migration left schema changes');
  applyMigrations(storage,migrations);
  const upgraded=snapshot();
  for(const [table,rows] of stable){
    if(table==='_Migrations')continue;
    if(table==='BrandSubscriptionAddon'){
      const restored=upgraded.find(([name])=>name===table)[1].map(value=>{const row=JSON.parse(value);equal(row.branchLimit,null,'Legacy branch limit must remain unknown');delete row.branchLimit;return JSON.stringify(Object.fromEntries(Object.entries(row).sort()));}).sort();
      equal(restored,rows,'v45 changed subscription assignment fields');
    }else equal(upgraded.find(([name])=>name===table)[1],rows,'v45 changed historical data');
  }
  sql("UPDATE BrandSubscriptionAddon SET branchLimit=5 WHERE id='selected'");
  const complete=snapshot(),completeSchema=schema();applyMigrations(storage,migrations);
  equal(snapshot(),complete,'v45 repeated startup changed stored limits');equal(schema(),completeSchema,'v45 repeated startup changed schema');
  equal(sql('PRAGMA foreign_key_check').toArray(),[],'v45 FK violations');
}
