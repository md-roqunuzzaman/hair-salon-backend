import { applyMigrations } from './migrations.mjs';

const equal = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
};
const rejects = (callback, message) => {
  try { callback(); } catch { return; }
  throw new Error(message);
};

export function verifyBranchBrandUpgrade(storage, migrations) {
  const sql = (query, ...args) => storage.sql.exec(query, ...args);
  const tables = sql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='_Migrations' ORDER BY name").toArray();
  const snapshot = () => tables.map(({ name }) => [name, sql(`SELECT * FROM "${name}"`).toArray().map(row => {
    if (name === 'Branch') delete row.brandId;
    return JSON.stringify(Object.fromEntries(Object.entries(row).sort()));
  }).sort()]);
  const before = snapshot();
  const schema = () => sql("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").toArray();
  const beforeSchema = schema();
  const beforeLedger = sql('SELECT * FROM _Migrations ORDER BY version').toArray();
  const brands = sql('SELECT id FROM Brand ORDER BY id').toArray();
  const branches = sql('SELECT id FROM Branch ORDER BY id').toArray();
  rejects(() => applyMigrations(storage, [...migrations.slice(0,41), { ...migrations[41], sql: migrations[41].sql + '; SELECT * FROM deliberately_missing_branch_brand_table;' }]), 'Injected v42 failure must reject');
  equal(snapshot(), before, 'v42 rollback must preserve all application rows');
  equal(schema(), beforeSchema, 'v42 rollback must restore the column, index and schema');
  equal(sql('SELECT * FROM _Migrations ORDER BY version').toArray(), beforeLedger, 'v42 rollback must restore the ledger');
  applyMigrations(storage, migrations);
  equal(snapshot(), before, 'v42 must preserve every prior field and unrelated table');
  equal(sql('SELECT id,brandId FROM Branch ORDER BY id').toArray(), branches.map(({ id }) => ({ id, brandId: brands.length === 1 ? brands[0].id : null })), 'Only a single existing Brand may be used for automatic backfill');
  const column = sql('PRAGMA table_info(Branch)').toArray().find(row => row.name === 'brandId');
  equal([column.notnull,column.dflt_value], [0,null], 'Branch.brandId must stay nullable without a default');
  equal(sql('PRAGMA index_info(Branch_brandId_idx)').toArray().map(row => row.name), ['brandId'], 'Brand ownership index missing');
  const key = sql('PRAGMA foreign_key_list(Branch)').toArray().find(row => row.from === 'brandId');
  equal([key.table,key.to,key.on_delete,key.on_update], ['Brand','id','RESTRICT','CASCADE'], 'Brand ownership foreign key mismatch');
  const stableRows = sql('SELECT * FROM Branch ORDER BY id').toArray();
  const stableLedger = sql('SELECT * FROM _Migrations ORDER BY version').toArray();
  applyMigrations(storage, migrations);
  equal(sql('SELECT * FROM Branch ORDER BY id').toArray(), stableRows, 'Repeat startup must preserve ownership');
  equal(sql('SELECT * FROM _Migrations ORDER BY version').toArray(), stableLedger, 'Repeat startup must not duplicate ledger entries');
  sql("INSERT INTO Brand(id,name,updatedAt) VALUES ('v42-owner','Ownership fixture',1)");
  sql("INSERT INTO Branch(id,name,address,brandId,updatedAt) VALUES ('v42-owned','Owned','Test','v42-owner',1),('v42-null','Nullable','Test',NULL,1)");
  rejects(() => sql("UPDATE Branch SET brandId='missing-owner' WHERE id='v42-owned'"), 'Missing Brand must be rejected');
  rejects(() => sql("DELETE FROM Brand WHERE id='v42-owner'"), 'Referenced Brand deletion must be restricted');
  sql("UPDATE Brand SET id='v42-owner-renamed' WHERE id='v42-owner'");
  equal(sql("SELECT brandId FROM Branch WHERE id='v42-owned'").one().brandId, 'v42-owner-renamed', 'Brand primary-key updates must cascade');
  applyMigrations(storage, migrations);
  equal(sql("SELECT brandId FROM Branch WHERE id='v42-owned'").one().brandId, 'v42-owner-renamed', 'Repeat initialization must not overwrite an explicit assignment');
  equal(sql("SELECT brandId FROM Branch WHERE id='v42-null'").one().brandId, null, 'A nullable field must remain writable as NULL for this release');
  equal(sql('PRAGMA foreign_key_check').toArray(), [], 'v42 left broken foreign keys');
}

export function runBranchBrandScenario(storage, migrations, scenario) {
  applyMigrations(storage, migrations.slice(0,41));
  const count = scenario === 'single' ? 1 : scenario === 'multiple' ? 2 : 0;
  for (let index=0; index<count; index++) storage.sql.exec('INSERT INTO Brand(id,name,updatedAt) VALUES (?,?,1)', `brand-${index}`, `Brand ${index}`);
  if (scenario !== 'empty') storage.sql.exec("INSERT INTO Branch(id,name,address,createdAt,updatedAt) VALUES ('legacy-branch','Legacy','Original address',123,456)");
  verifyBranchBrandUpgrade(storage, migrations);
  return { scenario, passed: true };
}
