// Test-only controls for the production scheduled completion handler.
import { generateOrderNumber } from '../../src/app/utils/generateOrderNumber.ts';

export async function completionFixture(db, storage, body) {
  if (body.prepare) {
    const source = await db.appointment.findFirst();
    const cases = {};
    const elapsed = new Date(Date.now() - 31 * 60000);
    for (const [name, overrides] of Object.entries({
      payNow: {}, reserve: { bookingMethod: 'RESERVE_NOW' }, deposit: { bookingMethod: 'DEPOSIT' },
      rollback: {}, unverified: { qrVerifiedAt: null },
      tooEarly: { qrVerifiedAt: new Date() }, unpaid: { paymentStatus: 'PARTIALLY_PAID' },
      cancelled: { appointmentStatus: 'CANCELLED' }, zeroDuration: { durationMinutes: 0 },
    })) {
      const customer = await db.user.create({ data: { name: `Completion ${name}`, email: `completion-${name}@example.com`, passwordHash: 'unused' } });
      const row = await db.appointment.create({ data: {
        orderNumber: generateOrderNumber(), customerId: customer.id,
        branchId: source.branchId, staffId: source.staffId,
        bookingMethod: 'PAY_NOW', appointmentStatus: 'CONFIRMED', paymentStatus: 'PAID',
        date: source.date, startTime: '00:00', endTime: '00:30',
        price: '100', durationMinutes: 30, itemName: 'Cron completion test',
        qrVerifiedAt: elapsed, ...overrides,
      } });
      cases[name] = row.id;
    }
    storage.sql.exec('CREATE TABLE IF NOT EXISTS _TestCompletionFailure (userId TEXT PRIMARY KEY)');
    const blocked = await db.appointment.findUnique({ where: { id: cases.rollback } });
    storage.sql.exec('INSERT INTO _TestCompletionFailure VALUES (?)', blocked.customerId);
    storage.sql.exec("CREATE TRIGGER test_completion_failure BEFORE INSERT ON Notification WHEN EXISTS (SELECT 1 FROM _TestCompletionFailure WHERE userId=NEW.userId) BEGIN SELECT RAISE(ABORT, 'test completion failure'); END");
    return cases;
  }
  if (body.clearFailure) storage.sql.exec('DELETE FROM _TestCompletionFailure');
  const appointments = await db.appointment.findMany({ where: { id: { in: body.ids } } });
  const notifications = await db.notification.findMany({ where: { userId: { in: appointments.map(row => row.customerId) }, type: 'SERVICE_COMPLETED' } });
  return {
    appointments,
    notifications: notifications.map(note => ({ ...note, appointmentId: appointments.find(row => row.customerId === note.userId).id })),
    audits: await db.auditLog.findMany({ where: { entityId: { in: body.ids }, action: 'APPOINTMENT_AUTO_COMPLETED' } }),
  };
}
