import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import bcrypt from 'bcryptjs';
import { seedCloudflareSuperAdmin,superAdminSettings } from '../scripts/lib/cloudflare-super-admin.mjs';

async function fixture(t) {
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2025-10-11',d1Databases:{DB:'synthetic'}});
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');
  await db.prepare('CREATE TABLE User(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,phone TEXT UNIQUE,passwordHash TEXT NOT NULL,role TEXT NOT NULL,status TEXT NOT NULL,emailVerified BOOLEAN NOT NULL DEFAULT 0,emailVerifiedAt INTEGER,mustChangePassword BOOLEAN NOT NULL DEFAULT 0,createdAt INTEGER,updatedAt INTEGER)').run();
  const query=async(sql,params=[]) => (await db.prepare(sql).bind(...params).all()).results;
  const settings=superAdminSettings({SUPER_ADMIN_NAME:"Synthetic O'Admin",SUPER_ADMIN_EMAIL:' ADMIN@example.com ',SUPER_ADMIN_PASSWORD:'SyntheticPassword#123',BCRYPT_SALT_ROUNDS:'10'});
  const seed=(apply=true)=>seedCloudflareSuperAdmin({query,settings,apply});
  return {query,settings,seed};
}

test('Super Admin dry-run performs no writes',async t=>{
  const f=await fixture(t);const result=await f.seed(false);
  assert.equal(result.wouldCreate,true);assert.equal(result.email,'admin@example.com');
  assert.deepEqual(await f.query('SELECT * FROM User'),[]);
  assert.equal('passwordHash' in result,false);assert.equal('password' in result,false);
});
test('Super Admin creation stores a valid bcrypt hash and login flags, and repeat runs preserve all fields',async t=>{
  const f=await fixture(t);const result=await f.seed();
  assert.equal(result.created,true);assert.equal(result.role,'SUPER_ADMIN');assert.equal(result.status,'ACTIVE');assert.equal(result.emailVerified,true);assert.equal(result.mustChangePassword,false);
  const before=await f.query('SELECT * FROM User');
  assert.notEqual(before[0].passwordHash,f.settings.password);assert.ok(await bcrypt.compare(f.settings.password,before[0].passwordHash));
  assert.equal(before[0].name,"Synthetic O'Admin");assert.equal('passwordHash' in result,false);
  assert.equal((await f.seed()).created,false);assert.deepEqual(await f.query('SELECT * FROM User'),before);
});
test('Existing account roles are never promoted or overwritten',async t=>{
  const f=await fixture(t);
  for(const role of ['CUSTOMER','STAFF','BRANCH_MANAGER','BRAND_OWNER']){
    await f.query('DELETE FROM User');
    await f.query('INSERT INTO User(id,name,email,passwordHash,role,status) VALUES (?,?,?,?,?,?)',['existing','Original',f.settings.email,'original-hash',role,'ACTIVE']);
    const before=await f.query('SELECT * FROM User');
    await assert.rejects(f.seed(),/automatic promotion is prohibited/);
    assert.deepEqual(await f.query('SELECT * FROM User'),before);
  }
});
test('A changed existing Super Admin password is never reset by a repeat seed',async t=>{
  const f=await fixture(t);await f.seed();
  const passwordHash=await bcrypt.hash('ChangedSyntheticPassword#123',10);
  await f.query('UPDATE User SET passwordHash=?',[passwordHash]);
  const before=await f.query('SELECT * FROM User');
  await assert.rejects(f.seed(),/automatic password reset is prohibited/);
  assert.deepEqual(await f.query('SELECT * FROM User'),before);
});
test('Conflicting phone numbers are never reassigned',async t=>{
  const f=await fixture(t);f.settings.phone='+85291234567';
  await f.query('INSERT INTO User(id,name,email,phone,passwordHash,role,status) VALUES (?,?,?,?,?,?,?)',['other','Other','other@example.com',f.settings.phone,'original','STAFF','ACTIVE']);
  const before=await f.query('SELECT * FROM User');
  await assert.rejects(f.seed(),/Phone already belongs/);
  assert.deepEqual(await f.query('SELECT * FROM User'),before);
});
test('Concurrent seed requests create exactly one account',async t=>{
  const f=await fixture(t);const results=await Promise.all([f.seed(),f.seed()]);
  assert.equal(results.filter(result=>result.created).length,1);
  assert.equal((await f.query('SELECT * FROM User')).length,1);
});
test('Invalid or truncated seed credentials are rejected before accessing storage',()=>{
  const env={SUPER_ADMIN_NAME:'Admin',SUPER_ADMIN_EMAIL:'admin@example.com',SUPER_ADMIN_PASSWORD:'ValidSynthetic#123'};
  for(const change of [{SUPER_ADMIN_PASSWORD:'short'},{SUPER_ADMIN_PASSWORD:'界'.repeat(25)},{SUPER_ADMIN_EMAIL:'invalid'},{BCRYPT_SALT_ROUNDS:'3'},{SUPER_ADMIN_NAME:''}])assert.throws(()=>superAdminSettings({...env,...change}));
});
