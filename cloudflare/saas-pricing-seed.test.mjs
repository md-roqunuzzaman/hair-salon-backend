import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { seedCloudflareSaasPricing,pricingSeeds } from '../scripts/lib/cloudflare-saas-pricing.mjs';

async function fixture(t){
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2025-10-11',d1Databases:{DB:'synthetic'}});t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');
  await db.prepare('CREATE TABLE Brand(id TEXT PRIMARY KEY)').run();
  const sql=await readFile('cloudflare/migrations/0044_subscription_pricing.sql','utf8');
  const [schema,...triggers]=sql.split(/(?=CREATE TRIGGER)/);
  for(const statement of schema.replace(/^--.*$/gm,'').split(';').filter(s=>s.trim()))await db.prepare(statement).run();
  for(const trigger of triggers)await db.prepare(trigger).run();
  const query=async(sql,params=[]) => (await db.prepare(sql).bind(...params).all()).results;
  return {query,seed:apply=>seedCloudflareSaasPricing({query,apply})};
}

test('SQL SaaS seed dry-run writes nothing; apply creates exactly one plan and five features in minor units',async t=>{
  const f=await fixture(t);assert.equal((await f.seed(false)).filter(row=>row.wouldCreate).length,6);
  assert.deepEqual(await f.query('SELECT * FROM SubscriptionPlan'),[]);assert.deepEqual(await f.query('SELECT * FROM AddonFeature'),[]);
  const result=await f.seed(true);assert.equal(result.filter(row=>row.created).length,6);
  for(const seed of pricingSeeds){const [row]=await f.query(`SELECT * FROM ${seed.table} WHERE code=?`,[seed.code]);assert.equal(row.price,seed.price);assert.equal(row.currency,'HKD');assert.equal(row.isActive,1);assert.equal(row.description,seed.description);}
});

test('SQL SaaS seed preserves existing custom pricing and rows, and concurrent repeat runs create no duplicates',async t=>{
  const f=await fixture(t);await f.seed(true);
  await f.query("UPDATE SubscriptionPlan SET price=50125,name='Custom',currency='USD',isActive=0,updatedAt=123");
  await f.query("UPDATE AddonFeature SET price=12345,name='Custom Wallet',isActive=0,updatedAt=456 WHERE code='WALLET'");
  const before=[await f.query('SELECT * FROM SubscriptionPlan'),await f.query('SELECT * FROM AddonFeature ORDER BY code')];
  const results=await Promise.all([f.seed(true),f.seed(true)]);assert.equal(results.flat().filter(row=>row.created).length,0);
  assert.deepEqual([await f.query('SELECT * FROM SubscriptionPlan'),await f.query('SELECT * FROM AddonFeature ORDER BY code')],before);
});

test('SQL SaaS seed concurrent first runs and recovery from partial initialization fill missing definitions only',async t=>{
  const f=await fixture(t);const results=await Promise.all([f.seed(true),f.seed(true)]);assert.equal(results.flat().filter(row=>row.created).length,6);
  await f.query("DELETE FROM AddonFeature WHERE code='REVIEWS'");assert.equal((await f.seed(true)).filter(row=>row.created).length,1);
  assert.equal((await f.query('SELECT COUNT(*) AS n FROM AddonFeature'))[0].n,5);
});
