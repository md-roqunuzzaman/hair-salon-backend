// Disposable integration build only; never imported by the deployed Worker.
const weekdays = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

export async function staffScheduleFixture(db, storage, body) {
  const { staffId } = body;
  if (body.seed) {
    const day = weekdays[new Date(body.date).getUTCDay()];
    const nextDay = weekdays[(weekdays.indexOf(day) + 1) % 7];
    const other = await db.branch.create({ data: {
      name: 'Out-of-scope schedule branch', address: 'Synthetic test address',
      businessHours: { create: { day, openTime: '00:00', closeTime: '23:59' } },
    } });
    await db.staffBranch.create({ data: { staffId, branchId: other.id } });
    await db.staffSchedule.updateMany({ where: { staffId }, data: { startTime: '10:00', endTime: '14:00' } });
    await db.staffSchedule.create({ data: { staffId, branchId: other.id, day, startTime: '15:00', endTime: '20:00' } });
    await db.branchBusinessHour.create({ data: { branchId: body.branchId, day: nextDay, openTime: '00:00', closeTime: '23:59' } });
    const standard = await db.package.create({ data: {
      name: 'Synthetic standard schedule package', type: 'STANDARD_SERVICE_PACKAGE',
      regularPrice: 100, packagePrice: 90, durationMinutes: 60,
    } });
    return { otherBranchId: other.id, standardPackageId: standard.id, day, nextDay };
  }
  if (body.appointment) {
    const customer = await db.user.findUniqueOrThrow({ where: { email: 'book-now-customer@example.com' } });
    const row = body.appointment;
    await db.appointment.create({ data: {
      customerId: customer.id, staffId, branchId: body.branchId,
      orderNumber: row.orderNumber, serviceId: body.serviceId,
      bookingMethod: 'RESERVE_NOW', appointmentStatus: 'RESERVED', paymentStatus: 'UNPAID',
      date: new Date(body.date), startTime: '11:00', endTime: '12:00',
      timezone: 'Asia/Hong_Kong', durationMinutes: 60, price: 100, itemName: 'Synthetic booking',
      ...row, ...(row.date && { date: new Date(row.date) }),
      ...(row.holdExpiresAt && { holdExpiresAt: new Date(row.holdExpiresAt) }),
    } });
  }
  if (body.override) await db.staffScheduleOverride.create({ data: {
    staffId, date: new Date(body.date), ...body.override,
  } });
  if (body.failInsert) {
    storage.sql.exec("CREATE TRIGGER test_bulk_schedule_insert_failure BEFORE INSERT ON StaffSchedule BEGIN SELECT RAISE(ABORT, 'synthetic schedule insert failure'); END");
  }
  return {
    schedules: await db.staffSchedule.findMany({ where: { staffId }, orderBy: { id: 'asc' } }),
    overrides: await db.staffScheduleOverride.findMany({ where: { staffId }, orderBy: { id: 'asc' } }),
    appointments: await db.appointment.findMany({ where: { staffId }, orderBy: { id: 'asc' } }),
    notifications: await db.notification.findMany({ orderBy: { id: 'asc' } }),
  };
}
