import assert from 'node:assert/strict';
import test from 'node:test';
Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:'postgresql://test:test@127.0.0.1:1/test',REDIS_URL:'redis://127.0.0.1:1',STRIPE_SECRET_KEY:'sk_test_fixture'});
const {prisma}=await import('../src/app/lib/prisma.ts');
const {Prisma}=await import('../generated/prisma/client.ts');
const {staffService}=await import('../src/app/module/staff/staff.service.ts');

function fixture(t){
  const date=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
  const day=['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'][new Date(date).getUTCDay()];
  const state={allowed:true,attempts:0};
  const tx={staff:{findUnique:async()=>({branches:[{branchId:'branch'}]})},branchManagerBranch:{findMany:async()=>state.allowed?[{branchId:'branch'}]:[]},
    brand:{findFirst:async()=>({timezone:'Asia/Hong_Kong'})},appointment:{findMany:async()=>[]},
    staffSchedule:{findMany:async()=>[{branchId:'branch',day,startTime:'10:00',endTime:'14:00'}]},staffScheduleOverride:{findMany:async()=>[]},
    staffUnavailability:{findMany:async()=>[],create:async({data})=>({id:'absence',...data})}};
  const original=prisma.$transaction;t.after(()=>{prisma.$transaction=original;});
  const conflict=()=>new Prisma.PrismaClientKnownRequestError('Synthetic serialization conflict',{code:'P2034',clientVersion:'test'});
  const save=()=>staffService.createStaffUnavailability('staff',{date,type:'LEAVE',fullDay:true},{userId:'manager',role:'BRANCH_MANAGER'});
  return {tx,state,conflict,save};
}
test('leave retries its complete Serializable authorization/validation transaction',async t=>{
  const {tx,state,conflict,save}=fixture(t);
  prisma.$transaction=async(callback,options)=>{assert.equal(options.isolationLevel,'Serializable');state.attempts++;const result=await callback(tx);if(state.attempts===1)throw conflict();return result;};
  assert.equal((await save()).totalDays,1);assert.equal(state.attempts,2);
});
test('leave retries recheck manager permissions and never approve a revoked scope',async t=>{
  const {tx,state,conflict,save}=fixture(t);
  prisma.$transaction=async callback=>{state.attempts++;const result=await callback(tx);if(state.attempts===1){state.allowed=false;throw conflict();}return result;};
  await assert.rejects(save(),e=>e.statusCode===403);assert.equal(state.attempts,2);
});
test('leave serialization retries are bounded and return 409 after three failures',async t=>{
  const {state,conflict,save}=fixture(t);
  prisma.$transaction=async()=>{state.attempts++;throw conflict();};
  await assert.rejects(save(),e=>e.statusCode===409);assert.equal(state.attempts,3);
});
