import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicy, cents } from '../src/app/module/cancellation-refund/policy.calculation.ts';
import { servicePolicyBody, groupRefundBody } from '../src/app/module/cancellation-refund/cancellation-refund.validation.ts';
import { policyTimeMinutes } from '../src/app/module/cancellation-refund/policy-time.ts';
const service={engineVersion:1,module:'SERVICE',branchId:'branch',version:1,config:{cancellationAllowed:true,refundAllowed:true,minimumCancellationMinutes:360,policyFormat:'DEDUCTION_V2',refundTiers:[{minimumMinutesBeforeAppointment:2880,calculationType:'PERCENTAGE',deductionValue:0},{minimumMinutesBeforeAppointment:1440,calculationType:'PERCENTAGE',deductionValue:20},{minimumMinutesBeforeAppointment:720,calculationType:'PERCENTAGE',deductionValue:50},{minimumMinutesBeforeAppointment:360,calculationType:'PERCENTAGE',deductionValue:100}]}};
for(const [hours,refund,allowed]of [[49,30000,true],[48,30000,true],[47,24000,true],[24,24000,true],[23,15000,true],[12,15000,true],[11,0,true],[6,0,true],[5.999,0,false],[-1,0,false]])test(`service cutoff/tier ${hours}h`,()=>{const r=evaluatePolicy(service,30000,hours*3600000);assert.equal(r.refundCents,refund);assert.equal(r.allowed,allowed);});
for(const flag of ['nonRefundable','refundAllowed','cancellationAllowed'])test(`independent permission ${flag}`,()=>{const snap=structuredClone(service);snap.config[flag]=flag==='nonRefundable';const r=evaluatePolicy(snap,30000,49*3600000);assert.equal(r.refundCents,0);assert.equal(r.allowed,flag!=='cancellationAllowed');});
test('fixed deduction clamps to actual eligible payment and cents round half up',()=>{const s=structuredClone(service);s.config.refundTiers=[{minimumMinutesBeforeAppointment:360,calculationType:'FIXED',deductionValue:50}];assert.equal(evaluatePolicy(s,30000,25*3600000).refundCents,25000);assert.equal(evaluatePolicy(s,3000,25*3600000).refundCents,0);s.config.refundTiers[0]={minimumMinutesBeforeAppointment:360,calculationType:'PERCENTAGE',deductionValue:50};assert.equal(evaluatePolicy(s,101,25*3600000).refundCents,50);});
test('deposit calculation never includes unpaid salon remainder',()=>assert.equal(evaluatePolicy(service,3000,13*3600000).refundCents,1500));
const group={...service,module:'GROUP_REFUND',config:{refundAllowed:true,policyFormat:'REFUND_TIERS_V1',boundaryMode:'UPPER_INCLUSIVE',refundTiers:[{minimumMinutesAfterPurchase:0,refundPercentage:100},{minimumMinutesAfterPurchase:1440,refundPercentage:80},{minimumMinutesAfterPurchase:4320,refundPercentage:0}]}};
for(const [hours,refund]of [[0,10000],[23,10000],[24,10000],[24.000001,8000],[72,8000],[72.000001,0],[100,0]])test(`group upper-inclusive elapsed boundary ${hours}`,()=>assert.equal(evaluatePolicy(group,10000,hours*3600000).refundCents,refund));
test('historical minimum-inclusive semantics remain explicit',()=>{const s=structuredClone(group);s.config.boundaryMode='MINIMUM_INCLUSIVE';assert.equal(evaluatePolicy(s,10000,24*3600000).refundCents,8000);assert.equal(evaluatePolicy(s,10000,72*3600000).refundCents,0);});
for(const [hours,allowed,outcome]of [[25,true,'RESTORED'],[24,true,'RESTORED'],[23,true,'FORFEITED'],[2,true,'FORFEITED'],[1.999,false,'FORFEITED']])test(`group entitlement threshold ${hours}`,()=>{const s={...service,module:'GROUP_CANCEL',config:{cancellationAllowed:true,minimumCancellationMinutes:120,restorationMinimumMinutes:1440,lateCancellationOutcome:'FORFEITED'}};const r=evaluatePolicy(s,0,hours*3600000);assert.equal(r.allowed,allowed);assert.equal(r.entitlementOutcome,outcome);assert.equal(r.refundCents,0);});
test('old refundable percentages are not reinterpreted as deductions',()=>{const s={...service,config:{...service.config,policyFormat:'REFUND_TIERS_V1',refundTiers:[{minimumMinutesBefore:360,calculationType:'PERCENTAGE',value:80}]}};assert.equal(evaluatePolicy(s,10000,25*3600000).refundCents,8000);});
for(const invalid of [NaN,Infinity,-1,1.001])test(`invalid monetary input ${invalid}`,()=>assert.throws(()=>cents(invalid)));
test('configuration rejects duplicate tiers, gaps, invalid percentage and fixed precision',()=>{const base={isEnabled:true,cancellationAllowed:true,refundAllowed:true,minimumCancellationMinutes:360,nonRefundable:false,deductionTiers:service.config.refundTiers};assert.equal(servicePolicyBody.safeParse(base).success,true);for(const changes of [{deductionTiers:base.deductionTiers.slice(0,2)},{deductionTiers:[...base.deductionTiers,base.deductionTiers[0]]},{deductionTiers:[{minimumMinutesBeforeAppointment:360,calculationType:'PERCENTAGE',deductionValue:101}]},{deductionTiers:[{minimumMinutesBeforeAppointment:360,calculationType:'FIXED',deductionValue:1.001}]}])assert.equal(servicePolicyBody.safeParse({...base,...changes}).success,false);assert.equal(groupRefundBody.safeParse({isEnabled:true,refundAllowed:true,allowPartiallyUsedRefund:false,allowExpiredRefund:false,requireNoActiveAppointments:true,refundTiers:group.config.refundTiers}).success,true);});

test('minute-only thresholds support 30/90-minute settings and preserve exact cutoff boundaries',()=>{
 const config={cancellationAllowed:true,refundAllowed:true,minimumCancellationMinutes:30,policyFormat:'REFUND_TIERS_V1',refundTiers:[{minimumMinutesBeforeAppointment:90,calculationType:'PERCENTAGE',value:100},{minimumMinutesBeforeAppointment:30,calculationType:'PERCENTAGE',value:50}]};
 for(const [minutes,allowed,refund] of [[29,false,0],[30,true,5000],[89,true,5000],[90,true,10000]]){
  const result=evaluatePolicy({...service,config},10000,minutes*60000);assert.equal(result.allowed,allowed);assert.equal(result.refundCents,refund);
 }
 assert.equal(servicePolicyBody.safeParse({isEnabled:true,cancellationAllowed:true,refundAllowed:true,minimumCancellationMinutes:30,nonRefundable:false,deductionTiers:[{minimumMinutesBeforeAppointment:30,calculationType:'FIXED',deductionValue:0}]}).success,true);
});

test('legacy hour snapshots retain financial terms, boundary modes and original bytes',()=>{
 const snapshots=[
  {...service,config:{cancellationAllowed:true,refundAllowed:true,minimumCancellationHours:2,policyFormat:'REFUND_TIERS_V1',refundTiers:[{minimumHoursBefore:2,calculationType:'PERCENTAGE',value:80}]}},
  {...group,config:{refundAllowed:true,policyFormat:'REFUND_TIERS_V1',boundaryMode:'UPPER_INCLUSIVE',refundTiers:[{minimumHoursAfterPurchase:24,refundPercentage:80},{minimumHoursAfterPurchase:0,refundPercentage:100}]}},
  {...service,module:'GROUP_CANCEL',config:{cancellationAllowed:true,minimumCancellationHours:2,restorationMinimumHours:24,lateCancellationOutcome:'FORFEITED'}}
 ];
 for(const snapshot of snapshots){
  const original=JSON.stringify(snapshot),minutes=policyTimeMinutes(snapshot);
  for(const hours of [1.999,2,23.99,24,24.001,49])assert.deepEqual(evaluatePolicy(snapshot,10000,hours*3600000),evaluatePolicy(minutes,10000,hours*3600000));
  assert.equal(JSON.stringify(snapshot),original);assert.deepEqual(policyTimeMinutes(minutes),minutes);
 }
 assert.equal(evaluatePolicy(snapshots[0],10000,2*3600000).refundCents,8000);
 assert.equal(evaluatePolicy(snapshots[1],10000,24*3600000).refundCents,10000);
});

test('ambiguous/unsafe historical units fail closed and old hour request fields are rejected',()=>{
 assert.throws(()=>policyTimeMinutes({minimumCancellationHours:2,minimumCancellationMinutes:2}),/INVALID_POLICY_TIME_UNIT/);
 assert.throws(()=>policyTimeMinutes({minimumHoursBefore:'2'}),/INVALID_POLICY_TIME_UNIT/);
 assert.equal(servicePolicyBody.safeParse({isEnabled:true,cancellationAllowed:true,refundAllowed:true,minimumCancellationHours:2,nonRefundable:false,deductionTiers:[{minimumHoursBeforeAppointment:2,calculationType:'FIXED',deductionValue:0}]}).success,false);
});
