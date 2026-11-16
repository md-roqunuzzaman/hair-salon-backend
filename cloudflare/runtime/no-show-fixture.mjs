// Included only in build-cloudflare --test, never in the deployed entry.
import { generateOrderNumber } from '../../src/app/utils/generateOrderNumber.ts';

export async function noShowFixture(db, storage, body) {
  if (body.prepare) {
    const oldDate = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const futureDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const cases = {};
    for (const [name, override] of Object.entries({
      payNow: {}, reserve: { bookingMethod: 'RESERVE_NOW', appointmentStatus: 'RESERVED', paymentStatus: 'UNPAID' },
      deposit: { bookingMethod: 'DEPOSIT', paymentStatus: 'PARTIALLY_PAID', depositAmount: 30, remainingAmount: 70 },
      legacyTimezone: { timezone: null }, rollback: {},
      checkedIn: { qrVerifiedAt: new Date() }, future: { date: new Date(futureDate) },
      pending: { appointmentStatus: 'PENDING_PAYMENT', paymentStatus: 'PENDING', holdExpiresAt: new Date(Date.now() + 3600000) },
      cancelled: { appointmentStatus: 'CANCELLED' }, expired: { appointmentStatus: 'EXPIRED' },
      alreadyNoShow: { appointmentStatus: 'NO_SHOW' }, completed: { appointmentStatus: 'COMPLETED' },
    })) {
      const customer = await db.user.create({ data: {
        name: `No-show ${name}`, email: `no-show-${name}@example.com`, passwordHash: 'unused',
      } });
      const row = await db.appointment.create({ data: {
        orderNumber: generateOrderNumber(), customerId: customer.id,
        branchId: body.branchId, staffId: body.staffId, serviceId: body.serviceId,
        bookingMethod: 'PAY_NOW', appointmentStatus: 'CONFIRMED', paymentStatus: 'PAID',
        date: new Date(oldDate), startTime: '10:00', endTime: '11:00',
        timezone: 'Asia/Hong_Kong', currency: 'HKD', price: 100, durationMinutes: 60,
        itemName: 'Synthetic no-show cron appointment', ...override,
      } });
      cases[name] = row.id;
    }
    storage.sql.exec('CREATE TABLE _TestNoShowFailure (userId TEXT PRIMARY KEY)');
    const rollback = await db.appointment.findUniqueOrThrow({ where: { id: cases.rollback } });
    storage.sql.exec('INSERT INTO _TestNoShowFailure VALUES (?)', rollback.customerId);
    storage.sql.exec("CREATE TRIGGER test_no_show_failure BEFORE INSERT ON Notification WHEN EXISTS (SELECT 1 FROM _TestNoShowFailure WHERE userId=NEW.userId) BEGIN SELECT RAISE(ABORT,'synthetic no-show notification failure'); END");
    return cases;
  }
  if (body.clearFailure) storage.sql.exec('DELETE FROM _TestNoShowFailure');
  const appointments = await db.appointment.findMany({ where: { id: { in: body.ids } }, orderBy: { id: 'asc' } });
  const notifications = await db.notification.findMany({ where: { userId: { in: appointments.map(row => row.customerId) }, type: 'BOOKING_NO_SHOW' }, orderBy: { id: 'asc' } });
  return {
    appointments,
    notifications: notifications.map(note => ({ ...note, appointmentId: appointments.find(row => row.customerId === note.userId).id })),
    audits: await db.auditLog.findMany({ where: { entityId: { in: body.ids }, action: 'APPOINTMENT_AUTO_NO_SHOW' }, orderBy: { id: 'asc' } }),
  };
}
