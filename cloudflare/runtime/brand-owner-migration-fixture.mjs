import { applyMigrations } from './migrations.mjs';

const equal = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
};
const rejects = (callback, message) => {
  try { callback(); } catch { return; }
  throw new Error(message);
};

export function verifyBrandOwnerUpgrade(storage, migrations) {
  const sql = (query, ...args) => storage.sql.exec(query, ...args);
  const tables = sql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").toArray();
  const rows = () => tables.map(({name}) => [name,sql(`SELECT * FROM "${name}"`).toArray().map(row => {
    if(name==='Brand')delete row.ownerId;
    return JSON.stringify(Object.fromEntries(Object.entries(row).sort()));
  }).sort()]);
  const schema = () => sql("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").toArray();
  const before = rows();
  const beforeSchema = schema();
  rejects(() => applyMigrations(storage,[...migrations.slice(0,42),{...migrations[42],sql:migrations[42].sql+'; SELECT * FROM deliberately_missing_brand_owner_table;'}]),'Injected v43 failure must reject');
  equal(rows(),before,'v43 failure must preserve every row and migration ledger');
  equal(schema(),beforeSchema,'v43 failure must restore schema and indexes');
  applyMigrations(storage,migrations);
  const current = rows();
  equal(current.filter(([name])=>name!=='_Migrations'),before.filter(([name])=>name!=='_Migrations'),'v43 must preserve prior data, roles, branch ownership, timestamps and money');
  equal(sql('SELECT COUNT(*) AS count FROM Brand WHERE ownerId IS NOT NULL').one().count,0,'No historical owner may be invented');
  const column = sql('PRAGMA table_info(Brand)').toArray().find(row=>row.name==='ownerId');
  equal([column.notnull,column.dflt_value],[0,null],'Brand.ownerId must stay nullable with no default');
  equal(sql('PRAGMA index_info(Brand_ownerId_idx)').toArray().map(row=>row.name),['ownerId'],'Owner lookup index missing');
  const key=sql('PRAGMA foreign_key_list(Brand)').toArray().find(row=>row.from==='ownerId');
  equal([key.table,key.to,key.on_delete,key.on_update],['User','id','RESTRICT','CASCADE'],'Owner foreign key differs from Prisma');
  sql("INSERT INTO User(id,name,email,passwordHash,role,updatedAt) VALUES ('v43-owner','Owner','v43-owner@example.com','synthetic','BRAND_OWNER',1),('v43-admin','Admin','v43-admin@example.com','synthetic','SUPER_ADMIN',1)");
  sql("INSERT INTO Brand(id,name,ownerId,updatedAt) VALUES ('v43-first','First','v43-owner',1),('v43-second','Second','v43-owner',1),('v43-null','Unassigned',NULL,1)");
  rejects(()=>sql("UPDATE Brand SET ownerId='missing-user' WHERE id='v43-first'"),'Missing owner must be rejected');
  rejects(()=>sql("DELETE FROM User WHERE id='v43-owner'"),'Deleting a referenced owner must be restricted');
  sql("UPDATE User SET id='v43-owner-renamed' WHERE id='v43-owner'");
  equal(sql("SELECT ownerId FROM Brand WHERE id IN ('v43-first','v43-second') ORDER BY id").toArray(),[{ownerId:'v43-owner-renamed'},{ownerId:'v43-owner-renamed'}],'Owner id updates must cascade to all owned Brands');
  const stableRows = rows();
  const stableSchema = schema();
  applyMigrations(storage,migrations);
  equal(rows(),stableRows,'Repeated initialization must preserve explicit owners and ledger');
  equal(schema(),stableSchema,'Repeated initialization must not duplicate schema objects');
  equal(sql("SELECT ownerId FROM Brand WHERE id='v43-null'").one().ownerId,null,'Unassigned Brands must remain nullable');
  equal(sql('PRAGMA foreign_key_check').toArray(),[],'v43 introduced a foreign-key violation');
}
