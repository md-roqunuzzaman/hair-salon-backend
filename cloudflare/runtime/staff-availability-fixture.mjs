// Synthetic controls are bundled by --test only, never by the deployed entry.
export async function staffAvailabilityFixture(db, storage, body) {
  const { staffId, branchId, serviceId, packageId } = body;
  const date = new Date(body.date);
  const day = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'][date.getUTCDay()];
  if (body.seed) {
    await db.branch.update({ where: { id: branchId }, data: { name: '妙妙大王' } });
    await db.staff.update({ where: { id: staffId }, data: { name: '妙妙' } });
    await db.staffSchedule.deleteMany({ where: { staffId } });
    await db.staffSchedule.create({ data: { staffId, branchId, day, startTime:'10:00', endTime:'14:00' } });
    await db.branchBusinessHour.upsert({ where:{branchId_day:{branchId,day}},
      create:{branchId,day,openTime:'10:00',closeTime:'14:00'},update:{openTime:'10:00',closeTime:'14:00',isClosed:false} });
    await db.branchHourlyCapacity.upsert({where:{branchId_day:{branchId,day}},create:{branchId,day,maxBookingsPerHour:100},update:{maxBookingsPerHour:100}});
    await db.branchBookingPolicy.update({where:{branchId},data:{slotIntervalMinutes:30,minimumBookingNoticeMinutes:0}});
    await db.packageService.create({ data: { packageId, serviceId } });
    const standard = await db.package.create({data:{name:'Synthetic standard availability package',type:'STANDARD_SERVICE_PACKAGE',regularPrice:100,packagePrice:90,durationMinutes:30,
      branches:{create:{branchId}},services:{create:{serviceId}},staff:{create:{staffId}}}});
    const other = await db.branch.create({data:{name:'Other synthetic branch',address:'Test',businessHours:{create:{day,openTime:'10:00',closeTime:'14:00'}},
      hourlyCapacities:{create:{day,maxBookingsPerHour:100}},bookingPolicy:{create:{minimumBookingNoticeMinutes:0,slotIntervalMinutes:30}}}});
    await db.serviceBranch.create({data:{branchId:other.id,serviceId}});
    return {standardPackageId:standard.id,otherBranchId:other.id,day};
  }
  if(body.staffStatus)await db.staff.update({where:{id:staffId},data:{status:body.staffStatus}});
  if(body.prepareMove)for(const id of body.prepareMove.packageIds)await db.packageBranch.create({data:{packageId:id,branchId:body.prepareMove.branchId}});
  if(body.hours)await db.branchBusinessHour.upsert({where:{branchId_day:{branchId,day}},create:{branchId,day,...body.hours},update:body.hours});
  if(body.clearSchedule)await db.staffSchedule.deleteMany({where:{staffId}});
  if(body.schedule)await db.staffSchedule.create({data:{staffId,branchId,day,...body.schedule}});
  if(body.staffBranch===false)await db.staffBranch.deleteMany({where:{staffId,branchId}});
  if(body.staffBranch===true)await db.staffBranch.upsert({where:{staffId_branchId:{staffId,branchId}},create:{staffId,branchId},update:{}});
  if(body.staffService===false)await db.staffService.deleteMany({where:{staffId,serviceId}});
  if(body.staffService===true)await db.staffService.upsert({where:{staffId_serviceId:{staffId,serviceId}},create:{staffId,serviceId},update:{}});
  if(body.clearLeave)await db.staffUnavailability.deleteMany({where:{staffId}});
  if(body.clearAppointments)await db.appointment.deleteMany({where:{staffId}});
  if(body.policy)await db.branchBookingPolicy.update({where:{branchId},data:body.policy});
  if(body.serviceDuration)await db.service.update({where:{id:serviceId},data:{durationMinutes:body.serviceDuration}});
  if(body.packageListing)await db.package.update({where:{id:packageId},data:{listingStatus:body.packageListing}});
  if(body.failSecondLeave)storage.sql.exec("CREATE TRIGGER test_second_leave_failure BEFORE INSERT ON StaffUnavailability WHEN (SELECT COUNT(*) FROM StaffUnavailability)>0 BEGIN SELECT RAISE(ABORT,'synthetic second leave failure'); END");
  return {
    leave:await db.staffUnavailability.findMany({where:{staffId},orderBy:{id:'asc'}}),
    appointments:await db.appointment.findMany({where:{staffId},orderBy:{id:'asc'}}),
    overrides:await db.staffScheduleOverride.findMany({where:{staffId},orderBy:{id:'asc'}}),
  };
}
