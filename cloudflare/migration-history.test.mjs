import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMigrations } from './runtime/migrations.mjs';
import { readFileSync,readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pinnedMigrationChecksums,verifyPinnedMigrationHistory } from '../scripts/lib/cloudflare-migration-history.mjs';

test('Migration mismatch reports only bounded history metadata and never runs a new migration or rewrites the ledger',()=>{
  const stored='a'.repeat(64),bundled='b'.repeat(64),statements=[];
  const storage={sql:{exec(sql){statements.push(sql);return {toArray:()=>[{version:42,checksum:stored}]};}},transactionSync(){throw new Error('Migration must not run after a mismatch');}};
  assert.throws(()=>applyMigrations(storage,[{version:42,checksum:bundled,sql:'SENSITIVE_SQL'}]),error=>error.code==='MIGRATION_HISTORY_MISMATCH'&&error.message.includes('version 42')&&error.message.includes(`stored=${stored}`)&&error.message.includes(`bundled=${bundled}`)&&!error.message.includes('SENSITIVE_SQL'));
  assert.equal(statements.length,2);assert.ok(statements.every(sql=>!/^UPDATE|^INSERT|^ALTER/.test(sql)));
});

test('Unexpected migration metadata cannot put SQL, provider text or secrets in operator errors',()=>{
  const storage={sql:{exec(){return {toArray:()=>[{version:'SENSITIVE_VALUE',checksum:'SENSITIVE_VALUE'}]};}}};
  assert.throws(()=>applyMigrations(storage,[]),error=>error.message.includes('version invalid')&&error.message.includes('stored=invalid')&&error.message.includes('bundled=missing')&&!error.message.includes('SENSITIVE_VALUE'));
});

test('One diagnostic identifies every mismatch before any schema operation',()=>{
  const storage={sql:{exec(){return {toArray:()=>[{version:42,checksum:'a'.repeat(64)},{version:43,checksum:'b'.repeat(64)}]};}},transactionSync(){throw new Error('Must not migrate');}};
  assert.throws(()=>applyMigrations(storage,[{version:42,checksum:'c'.repeat(64)},{version:43,checksum:'d'.repeat(64)}]),error=>{
    const rows=JSON.parse(error.message.match(/mismatches=(\[.*\]); applied/)[1]);assert.deepEqual(rows.map(row=>row.version),[42,43]);return true;
  });
});

test('Build rejects Windows newline conversion or SQL edits before uploading applied migration history',()=>{
  const files=readdirSync('cloudflare/migrations');
  const history=Object.keys(pinnedMigrationChecksums).map(version=>{
    const file=files.find(name=>Number(name.slice(0,4))===Number(version));const sql=readFileSync('cloudflare/migrations/'+file,'utf8');
    return {version:Number(version),sql,checksum:createHash('sha256').update(sql).digest('hex')};
  });
  assert.doesNotThrow(()=>verifyPinnedMigrationHistory(history));
  for(const sql of [history[2].sql.replaceAll('\n','\r\n'),history[2].sql+'\n-- accidental edit\n']){
    const changed=history.map(row=>row.version===45?{...row,sql,checksum:createHash('sha256').update(sql).digest('hex')}:row);
    assert.throws(()=>verifyPinnedMigrationHistory(changed),/v45 differs from deployed Salon history/);
  }
});
