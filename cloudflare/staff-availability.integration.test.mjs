import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './test-support/public-worker.mjs';

async function context(t) {
  const ctx=await setup(t,'true');
  // A future Thursday fixture, not the tester's unspecified calendar date.
  const thursday=new Date(Date.now()+7*86400000);
  thursday.setUTCDate(thursday.getUTCDate()+(4-thursday.getUTCDay()+7)%7);
  const f={...ctx.fixture,date:thursday.toISOString().slice(0,10)};
  const control=body=>ctx.direct('/__staff-availability-test',{...f,...body});
  const extra=await control({seed:true});
  const leaveRoot=`/api/v1/staff/${f.staffId}/unavailability`;
  const leave=(body,options={})=>ctx.api(leaveRoot,{roleToken:ctx.ownerToken,body:{date:f.date,...body},status:201,...options});
  const picker=async(product={serviceId:f.serviceId},date=f.date,branchId=f.branchId)=>{
    const path=product.serviceId?`services/${product.serviceId}`:`packages/${product.packageId}`;
    return (await ctx.api(`/api/v1/branches/${branchId}/${path}/staff${date===null?'':`?date=${date}`}`)).data.items;
  };
  const slots=async(product={serviceId:f.serviceId},date=f.date)=>
    (await ctx.api(`/api/v1/availability?${new URLSearchParams({branchId:f.branchId,staffId:f.staffId,date,...product})}`)).data;
  const override=(body,options={})=>ctx.api(`/api/v1/staff/${f.staffId}/schedule-overrides`,{roleToken:ctx.ownerToken,body:{branchId:f.branchId,date:f.date,startTime:'10:00',endTime:'14:00',...body},status:201,...options});
  return {...ctx,...extra,f,control,leaveRoot,leave,picker,slots,override};
}

test('Thursday 10:00 admin configuration persists and returns the stylist and a bookable slot',async t=>{
  const c=await context(t),{f,api}=c;
  const route=`/api/v1/services/${f.serviceId}/branches/${f.branchId}/booking-schedule`;
  await api(route,{method:'PUT',roleToken:c.ownerToken,body:{bookingHoursEnabled:true,bookingWindows:[{day:'THURSDAY',startTime:'10:00',endTime:'14:00'}]}});
  assert.equal((await api(route,{roleToken:c.ownerToken})).data.bookingHoursEnabled,true);
  assert.deepEqual((await c.picker()).map(s=>s.id),[f.staffId]);
  assert.equal((await c.picker())[0].name,'妙妙');
  assert.ok((await c.slots()).slots.some(s=>s.startTime==='10:00'&&s.endTime==='10:30'));
  await api(`/api/v1/appointments/reserve`,{body:{branchId:f.branchId,serviceId:f.serviceId,staffId:f.staffId,date:f.date,startTime:'10:00'},status:201});
  assert.ok(!(await c.slots()).slots.some(s=>s.startTime==='10:00'));
});

test('all absence types hide staff with no complete slot across Service and both Package types',async t=>{
  const c=await context(t);
  for(const type of ['LEAVE','TIME_OFF','BREAK','BLOCKED'])await t.test(type,async()=>{
    const result=await c.leave({type,...(['LEAVE','TIME_OFF'].includes(type)?{fullDay:true}:{startTime:'10:00',endTime:'14:00'})});
    for(const product of [{serviceId:c.f.serviceId},{packageId:c.standardPackageId},{packageId:c.f.packageId}])assert.deepEqual(await c.picker(product),[]);
    assert.equal((await c.slots()).slots.length,0);
    // Legacy undated consumers keep their assignment-list contract.
    assert.equal((await c.picker(undefined,null)).length,1);
    await c.api(`${c.leaveRoot}/${result.data.items[0].id}`,{method:'DELETE',roleToken:c.ownerToken});
    assert.equal((await c.picker()).length,1);
  });
});

test('partial leave includes only staff with a full remaining duration; stale selection cannot book',async t=>{
  const c=await context(t),{f}=c;
  const created=await c.leave({type:'LEAVE',startTime:'10:00',endTime:'13:30'});
  assert.equal((await c.picker()).length,1);
  assert.deepEqual((await c.slots()).slots.map(s=>s.startTime),['13:30']);
  await c.control({serviceDuration:60});
  assert.deepEqual(await c.picker(),[]);
  await c.control({serviceDuration:30});
  await c.api(`${c.leaveRoot}/${created.data.items[0].id}`,{method:'PATCH',roleToken:c.ownerToken,body:{endTime:'14:00'}});
  await c.api('/api/v1/appointments/reserve',{body:{branchId:f.branchId,serviceId:f.serviceId,staffId:f.staffId,date:f.date,startTime:'13:30'},status:409});
});

test('missing schedule, inactive, unassigned branch/service, off-day and policy windows exclude staff',async t=>{
  const c=await context(t);
  await c.control({staffStatus:'INACTIVE'});assert.deepEqual(await c.picker(),[]);
  await c.control({staffStatus:'ACTIVE',staffService:false});assert.deepEqual(await c.picker(),[]);
  await c.control({staffService:true,staffBranch:false});assert.deepEqual(await c.picker(),[]);
  await c.control({staffBranch:true,clearSchedule:true});assert.deepEqual(await c.picker(),[]);
  await c.control({schedule:{startTime:'10:00',endTime:'14:00'}});assert.equal((await c.picker()).length,1);
  const off=new Date(`${c.f.date}T00:00:00Z`);off.setUTCDate(off.getUTCDate()+1);
  assert.deepEqual(await c.picker(undefined,off.toISOString().slice(0,10)),[]);
  await c.control({policy:{maximumAdvanceBookingDays:1}});assert.deepEqual(await c.picker(),[]);
  await c.control({policy:{maximumAdvanceBookingDays:30,minimumBookingNoticeMinutes:31*1440}});assert.deepEqual(await c.picker(),[]);
});

test('effective override supports off-days, extended shifts and temporary branch moves',async t=>{
  const c=await context(t),{f}=c;
  await c.control({clearSchedule:true});
  await c.control({hours:{openTime:'09:00',closeTime:'16:00'}});
  await c.override({startTime:'09:00',endTime:'16:00'});
  const leave=await c.leave({type:'LEAVE',fullDay:true});
  assert.deepEqual(await c.picker(),[]);
  assert.equal(leave.data.items[0].startTime,'00:00');
  await c.api(`${c.leaveRoot}/${leave.data.items[0].id}`,{method:'PATCH',roleToken:c.ownerToken,body:{startTime:'15:00',endTime:'16:00'}});
  assert.equal((await c.picker()).length,1);
  const overrides=(await c.control({})).overrides;
  await c.api(`/api/v1/staff/${f.staffId}/schedule-overrides/${overrides[0].id}`,{method:'PATCH',roleToken:c.ownerToken,body:{branchId:c.otherBranchId,startTime:'10:00',endTime:'14:00'}});
  assert.deepEqual(await c.picker(),[]);
  assert.equal((await c.picker(undefined,f.date,c.otherBranchId)).length,1);
  await c.leave({type:'LEAVE',fullDay:true},{roleToken:c.managerToken,status:403});
});

test('leave mutations protect reservations, confirmations and live holds with rollback',async t=>{
  const c=await context(t),{f}=c;
  for(const [index,appointmentStatus] of ['RESERVED','CONFIRMED','PENDING_PAYMENT'].entries())await t.test(appointmentStatus,async()=>{
    await c.direct('/__staff-schedule-test',{...f,appointment:{orderNumber:`FA000${index}`,appointmentStatus,holdExpiresAt:new Date(Date.now()+3600000).toISOString()}});
    const before=await c.control({});
    await c.leave({type:'LEAVE',fullDay:true},{status:409});
    assert.deepEqual(await c.control({}),before);
    const absence=await c.leave({type:'BREAK',startTime:'12:00',endTime:'12:30'});
    const snapshot=await c.control({});
    await c.api(`${c.leaveRoot}/${absence.data.items[0].id}`,{method:'PATCH',roleToken:c.ownerToken,body:{startTime:'11:30'},status:409});
    assert.deepEqual(await c.control({}),snapshot);
    await c.control({clearLeave:true,clearAppointments:true});
  });
  await c.direct('/__staff-schedule-test',{...f,appointment:{orderNumber:'FA0010',appointmentStatus:'PENDING_PAYMENT',holdExpiresAt:new Date(0).toISOString()}});
  await c.leave({type:'TIME_OFF',fullDay:true});
});

test('manager cannot create, update or delete staff-wide leave outside authorized scope',async t=>{
  const c=await context(t),{f}=c;
  const row=(await c.leave({type:'BREAK',startTime:'10:00',endTime:'11:00'})).data.items[0];
  await c.leave({type:'BREAK',startTime:'12:00',endTime:'13:00'},{roleToken:c.otherManagerToken,status:403});
  await c.control({branchId:c.otherBranchId,staffBranch:true});
  const before=await c.control({});
  await c.leave({type:'TIME_OFF',fullDay:true},{roleToken:c.managerToken,status:403});
  await c.api(`${c.leaveRoot}/${row.id}`,{method:'PATCH',roleToken:c.managerToken,body:{endTime:'12:00'},status:403});
  await c.api(`${c.leaveRoot}/${row.id}`,{method:'DELETE',roleToken:c.managerToken,status:403});
  assert.deepEqual(await c.control({}),before);
});

test('multi-day leave insert failure rolls back earlier records',async t=>{
  const c=await context(t),{f}=c;
  const tomorrow=new Date(`${f.date}T00:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
  const endDate=tomorrow.toISOString().slice(0,10);
  await c.control({date:endDate,hours:{openTime:'10:00',closeTime:'14:00'}});
  await c.override({date:endDate});
  const before=await c.control({});
  await c.control({failSecondLeave:true});
  await c.leave({date:undefined,startDate:f.date,endDate,type:'LEAVE',fullDay:true},{status:500});
  assert.deepEqual(await c.control({}),before);
});

test('approved package routing preserves all dedicated Direct Book methods and delisted voucher redemption',async t=>{
  const c=await context(t),{f}=c;
  for(const route of ['pay-now','deposit','reserve'])await c.api(`/api/v1/appointments/${route}`,{body:{branchId:f.branchId,packageId:f.packageId,date:f.date,startTime:'10:00'},status:422});
  for(const [i,method]of ['PAY_NOW','DEPOSIT','RESERVE_NOW'].entries())await c.api('/api/v1/group-purchases',{body:{branchId:f.branchId,packageId:f.packageId,quantity:1,purchaseFlow:'DIRECT_BOOK',bookingMethod:method,date:f.date,startTime:`${10+i}:00`},status:201});
  const purchase=(await c.api('/api/v1/group-purchases',{body:{branchId:f.branchId,packageId:f.packageId,quantity:1},status:201})).data;
  await c.api(`/api/v1/group-purchases/${purchase.purchaseId}/pay-with-wallet`,{body:{useBonus:false}});
  await c.control({packageListing:'DELISTED'});
  assert.equal((await c.picker({packageId:f.packageId})).length,1);
  await c.api('/api/v1/group-purchases',{body:{branchId:f.branchId,packageId:f.packageId,quantity:1},status:422});
  await c.api(`/api/v1/group-purchases/${purchase.purchaseId}/book-appointment`,{body:{branchId:f.branchId,date:f.date,startTime:'13:00'},status:201});
});

test('package components are enforced by both discovery and final availability validation',async t=>{
  const c=await context(t),{f}=c;
  await c.control({staffService:false});
  for(const packageId of [c.standardPackageId,f.packageId]){
    assert.deepEqual(await c.picker({packageId}),[]);
    assert.equal((await c.api(`/api/v1/availability?${new URLSearchParams({branchId:f.branchId,packageId,date:f.date})}`)).data.slots.length,0);
  }
  await c.api(`/api/v1/appointments/reserve`,{body:{branchId:f.branchId,packageId:c.standardPackageId,date:f.date,startTime:'10:00'},status:409});
  await c.api(`/api/v1/group-purchases`,{body:{branchId:f.branchId,packageId:f.packageId,quantity:1,purchaseFlow:'DIRECT_BOOK',bookingMethod:'RESERVE_NOW',date:f.date,startTime:'10:00'},status:409});
});

test('fully booked staff disappears for every product and expired holds release the same slots',async t=>{
  const c=await context(t),{f}=c;
  for(const [i,appointmentStatus]of ['RESERVED','CONFIRMED','PENDING_PAYMENT'].entries()){
    await c.direct('/__staff-schedule-test',{...f,appointment:{orderNumber:`FB000${i}`,appointmentStatus,startTime:'10:00',endTime:'14:00',holdExpiresAt:new Date(Date.now()+3600000).toISOString()}});
    for(const product of [{serviceId:f.serviceId},{packageId:c.standardPackageId},{packageId:f.packageId}])assert.deepEqual(await c.picker(product),[]);
    await c.control({clearAppointments:true});
  }
  await c.direct('/__staff-schedule-test',{...f,appointment:{orderNumber:'FB0010',appointmentStatus:'PENDING_PAYMENT',startTime:'10:00',endTime:'14:00',holdExpiresAt:new Date(0).toISOString()}});
  assert.equal((await c.picker()).length,1);
});

test('branch membership and weekly schedule movement remain separate and updated API reads agree',async t=>{
  const c=await context(t),{f}=c;
  const scheduleRoute=`/api/v1/staff/${f.staffId}/schedule`;
  await c.api(scheduleRoute,{method:'PUT',roleToken:c.ownerToken,body:{schedule:[{branchId:c.otherBranchId,day:'THURSDAY',startTime:'10:00',endTime:'14:00'}]},status:400});
  await c.control({prepareMove:{branchId:c.otherBranchId,packageIds:[c.standardPackageId,f.packageId]}});
  await c.api(`/api/v1/staff/${f.staffId}/branches`,{method:'PUT',roleToken:c.ownerToken,body:{branchIds:[c.otherBranchId]}});
  assert.deepEqual(await c.picker(undefined,f.date,c.otherBranchId),[],'membership alone must not fabricate a shift');
  await c.api(scheduleRoute,{method:'PUT',roleToken:c.ownerToken,body:{schedule:[{branchId:c.otherBranchId,day:'THURSDAY',startTime:'10:00',endTime:'14:00'}]}});
  assert.deepEqual(await c.picker(),[]);
  assert.equal((await c.picker(undefined,f.date,c.otherBranchId)).length,1);
  const response=await c.api(`/api/v1/availability?${new URLSearchParams({branchId:c.otherBranchId,serviceId:f.serviceId,staffId:f.staffId,date:f.date})}`);
  assert.ok(response.data.slots.some(s=>s.startTime==='10:00'));
});

test('leave protects a future appointment across calendar dates using its saved timezone',async t=>{
  const c=await context(t),{f}=c;
  const previous=new Date(`${f.date}T00:00:00Z`);previous.setUTCDate(previous.getUTCDate()-1);
  // Honolulu 16:00 previous date is Hong Kong 10:00 selected date.
  await c.direct('/__staff-schedule-test',{...f,appointment:{orderNumber:'TZ0001',date:previous.toISOString().slice(0,10),startTime:'16:00',endTime:'17:00',timezone:'Pacific/Honolulu'}});
  await c.leave({type:'LEAVE',startTime:'10:00',endTime:'11:00'},{status:409});
  await c.leave({type:'BREAK',startTime:'11:00',endTime:'11:30'});
});

test('reschedule preview uses the saved duration after the service duration changes',async t=>{
  const c=await context(t),{f}=c;
  const booking=(await c.api('/api/v1/appointments/reserve',{body:{branchId:f.branchId,serviceId:f.serviceId,staffId:f.staffId,date:f.date,startTime:'10:00'},status:201})).data;
  await c.control({serviceDuration:60});
  await c.api(`/api/v1/appointments/${booking.appointmentId}/reschedule`,{body:{date:f.date,startTime:'13:30'}});
  const row=(await c.control({})).appointments.find(a=>a.id===booking.appointmentId);
  assert.equal(row.durationMinutes,30);assert.equal(row.endTime,'14:00');
});

test('concurrent booking and leave/override changes never both invalidate the same slot',async t=>{
  for(const mutation of ['leave','override'])await t.test(mutation,async t=>{
    const c=await context(t),{f}=c;
    const token=(await c.api('/api/v1/auth/login',{body:{email:'book-now-customer@example.com',password:'StrongPassword123!'}})).data.accessToken;
    const post=(path,body,roleToken)=>c.fetch(`https://test${path}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${roleToken}`},body:JSON.stringify(body)});
    const booking=post('/api/v1/appointments/reserve',{branchId:f.branchId,serviceId:f.serviceId,staffId:f.staffId,date:f.date,startTime:'11:00'},token);
    const change=mutation==='leave'
      ?post(c.leaveRoot,{type:'LEAVE',date:f.date,fullDay:true},c.ownerToken)
      :post(`/api/v1/staff/${f.staffId}/schedule-overrides`,{branchId:f.branchId,date:f.date,startTime:'10:00',endTime:'10:30'},c.ownerToken);
    const results=await Promise.all([booking,change]);
    assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
    const state=await c.control({});
    if(state.appointments.length){assert.equal(state.leave.length,0);assert.equal(state.overrides.length,0);}
  });
});

test('moving or deleting an override cannot strand appointments on its original off-day',async t=>{
  const c=await context(t),{f}=c;
  await c.control({clearSchedule:true});
  const override=(await c.override({})).data;
  await c.api('/api/v1/appointments/reserve',{body:{branchId:f.branchId,serviceId:f.serviceId,staffId:f.staffId,date:f.date,startTime:'11:00'},status:201});
  const next=new Date(`${f.date}T00:00:00Z`);next.setUTCDate(next.getUTCDate()+1);
  const nextDate=next.toISOString().slice(0,10);
  await c.control({date:nextDate,hours:{openTime:'10:00',closeTime:'14:00'}});
  const before=await c.control({});
  const route=`/api/v1/staff/${f.staffId}/schedule-overrides/${override.id}`;
  await c.api(route,{method:'PATCH',roleToken:c.ownerToken,body:{date:nextDate},status:409});
  await c.api(route,{method:'DELETE',roleToken:c.ownerToken,status:409});
  assert.deepEqual(await c.control({}),before);
});

test('all nine Service/Standard/Group booking combinations reject overlapping staff appointments',async t=>{
  const c=await context(t),{f}=c;
  const products=[{name:'Service',serviceId:f.serviceId},{name:'Standard',packageId:c.standardPackageId},{name:'Group',packageId:f.packageId}];
  const book=(product,status)=>product.name==='Group'
    ?c.api('/api/v1/group-purchases',{body:{branchId:f.branchId,packageId:product.packageId,quantity:1,purchaseFlow:'DIRECT_BOOK',bookingMethod:'RESERVE_NOW',staffId:f.staffId,date:f.date,startTime:'10:00'},status})
    :c.api('/api/v1/appointments/reserve',{body:{branchId:f.branchId,...(product.serviceId?{serviceId:product.serviceId}:{packageId:product.packageId}),staffId:f.staffId,date:f.date,startTime:'10:00'},status});
  for(const existing of products){
    await book(existing,201);
    for(const incoming of products)await t.test(`${existing.name} -> ${incoming.name}`,()=>book(incoming,409));
    await c.control({clearAppointments:true});
  }
});
