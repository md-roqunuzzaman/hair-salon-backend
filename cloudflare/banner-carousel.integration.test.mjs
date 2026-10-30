import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './test-support/public-worker.mjs';

test('branch banner carousel APIs: defaults, owner/manager scope, persistence and partial concurrent updates',async t=>{
 const {api,fixture,ownerToken,managerToken,otherManagerToken,state}=await setup(t,'true','false');
 const root='/api/v1/banners/carousel-settings/'+fixture.branchId;
 const owner=(url,options={})=>api(url,{...options,roleToken:ownerToken});
 const before=await state();
 assert.deepEqual((await owner(root)).data,{branchId:fixture.branchId,imageIntervalMs:5000,videoIntervalMs:15000});
 await api(root,{roleToken:'',status:401});await api(root,{status:403});
 for(const method of ['GET','PATCH']){
  await api(root,{method,...(method==='PATCH'?{body:{imageIntervalMs:8000}}:{}),roleToken:otherManagerToken,status:403});
 }
 const created=(await owner(root,{method:'PATCH',body:{imageIntervalMs:7000}})).data;
 assert.equal(created.imageIntervalMs,7000);assert.equal(created.videoIntervalMs,15000);assert.ok(!Number.isNaN(Date.parse(created.updatedAt)));
 const manager=(await api(root,{method:'PATCH',body:{videoIntervalMs:25000},roleToken:managerToken})).data;
 assert.equal(manager.imageIntervalMs,7000);assert.equal(manager.videoIntervalMs,25000);
 assert.deepEqual((await api(root,{roleToken:managerToken})).data,{branchId:fixture.branchId,imageIntervalMs:7000,videoIntervalMs:25000});
 await Promise.all([owner(root,{method:'PATCH',body:{imageIntervalMs:1000}}),owner(root,{method:'PATCH',body:{videoIntervalMs:120000}})]);
 assert.deepEqual((await owner(root)).data,{branchId:fixture.branchId,imageIntervalMs:1000,videoIntervalMs:120000});
 assert.deepEqual(await state(),before,'Carousel updates do not modify bookings, payments, wallets or notifications');
 // Existing public banner listing remains accessible and uses its original contract.
 const active=await api('/api/v1/banners/active?branchId='+fixture.branchId,{roleToken:''});assert.equal(active.success,true);
});

test('carousel validation and missing branches fail without changing stored settings',async t=>{
 const {api,fixture,ownerToken}=await setup(t,'true','false');
 const root='/api/v1/banners/carousel-settings/'+fixture.branchId;
 const owner=(url,options={})=>api(url,{...options,roleToken:ownerToken});
 const before=(await owner(root)).data;
 for(const body of [{},{imageIntervalMs:999},{imageIntervalMs:120001},{videoIntervalMs:1000.5},{videoIntervalMs:'5000'},{imageIntervalMs:null},{imageIntervalMs:5000,unknown:true}])await owner(root,{method:'PATCH',body,status:400});
 await owner('/api/v1/banners/carousel-settings/not-a-uuid',{status:400});
 await owner('/api/v1/banners/carousel-settings/not-a-uuid',{method:'PATCH',body:{imageIntervalMs:5000},status:400});
 const missing='/api/v1/banners/carousel-settings/11111111-1111-4111-8111-111111111111';
 await owner(missing,{status:404});await owner(missing,{method:'PATCH',body:{imageIntervalMs:5000},status:404});
 assert.deepEqual((await owner(root)).data,before);
});
