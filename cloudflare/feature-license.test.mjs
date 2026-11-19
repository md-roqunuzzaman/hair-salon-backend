import test from 'node:test';
import assert from 'node:assert/strict';
import { featureLicenseConfig as config } from '../src/app/config/feature-license.config.ts';
import { getFeatureStatus,isFeatureAvailable,getFeatureLicenseSummary,assertFeatureAvailable } from '../src/app/utils/featureLicense.ts';
import { getEffectiveBranchLimit,assertCanCreateBranch } from '../src/app/module/branch/branch-limit.service.ts';

const original=structuredClone(config),now=new Date('2026-11-19T00:00:00Z');
function reset(){Object.assign(config.license,structuredClone(original.license));for(const code of Object.keys(config.features)){for(const key of Object.keys(config.features[code]))delete config.features[code][key];Object.assign(config.features[code],structuredClone(original.features[code]));}}
for(const code of Object.keys(config.features))test(`${code}: enabled/disabled, license and feature expiry, start boundary and malformed dates fail closed`,t=>{
  t.after(reset);reset();Object.assign(config.features[code],{enabled:true,expiresAt:'2027-12-31T23:59:59+08:00'});
  assert.equal(getFeatureStatus(code,now),'ACTIVE');assert.equal(isFeatureAvailable(code,now),true);
  config.features[code].enabled=false;assert.equal(getFeatureStatus(code,now),'DISABLED');assert.throws(()=>assertFeatureAvailable(code),e=>e.statusCode===403);
  config.features[code].enabled=true;config.features[code].expiresAt=now.toISOString();assert.equal(getFeatureStatus(code,now),'EXPIRED');
  config.features[code].expiresAt='invalid';assert.equal(getFeatureStatus(code,now),'INVALID_CONFIG');
  config.features[code].expiresAt='2027-12-31T23:59:59+08:00';config.features[code].startsAt=new Date(now.getTime()+1).toISOString();assert.equal(getFeatureStatus(code,now),'NOT_STARTED');
  config.features[code].startsAt=now.toISOString();assert.equal(getFeatureStatus(code,now),'ACTIVE');
  config.license.enabled=false;assert.equal(getFeatureStatus(code,now),'LICENSE_DISABLED');config.license.enabled=true;
  config.license.expiresAt=now.toISOString();assert.equal(getFeatureStatus(code,now),'LICENSE_EXPIRED');config.license.expiresAt='invalid';assert.equal(getFeatureStatus(code,now),'INVALID_CONFIG');
  assert.equal(getFeatureStatus(code,new Date('invalid')),'INVALID_CONFIG');
});
test('Single-client branch limit includes inactive branches, rejects the next creation and falls back to one without add-on',async t=>{
  t.after(reset);reset();let received;
  const tx={branch:{count:async args=>{received=args;return 5;}}};
  assert.equal(getEffectiveBranchLimit(),5);await assert.rejects(assertCanCreateBranch('test-brand',tx),e=>e.statusCode===403);assert.deepEqual(received,{where:{brandId:'test-brand'}});
  config.features.BRANCH_STORE.enabled=false;assert.equal(getEffectiveBranchLimit(),1);tx.branch.count=async()=>0;await assertCanCreateBranch('test-brand',tx);
  tx.branch.count=async()=>1;await assert.rejects(assertCanCreateBranch('test-brand',tx),e=>e.statusCode===403);
  config.features.BRANCH_STORE.enabled=true;config.features.BRANCH_STORE.branchLimit=Number.MAX_SAFE_INTEGER+1;assert.equal(getFeatureStatus('BRANCH_STORE',now),'INVALID_CONFIG');assert.equal(getEffectiveBranchLimit(),1);
});
test('Feature summary exposes configured availability and limits without mutating the shipped client configuration',()=>{
  reset();const summary=getFeatureLicenseSummary(now);assert.equal(summary.features.WALLET.available,false);assert.equal(summary.features.BRANCH_STORE.branchLimit,5);assert.deepEqual(config,original);
});
