// Bundled only by build-cloudflare --test. Never included in the deployed entry.
import worker, { SalonDatabase } from '../worker.mjs';
import { failureResponse } from './errors.mjs';
import bcrypt from 'bcryptjs';
import { sendAppointmentReminders } from '../../src/app/module/notification/notification-reminder.service.ts';
// Existing services print detailed traces; keep test output focused on failures.
console.log = () => {};
export class SalonTestDatabase extends SalonDatabase {
  constructor(ctx, env) {
    const outbox = [];
    super(ctx, { ...env, EMAIL: { async send(message) { outbox.push(message); return { messageId: 'test' }; } } });
    this.outbox = outbox;
  }
  async sendMail(message) { this.outbox.push(message); return { messageId: 'test' }; }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__notification-failure') return this.enqueue(async () => {
      this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS _TestNotificationFailure (userId TEXT PRIMARY KEY)');
      this.ctx.storage.sql.exec('DELETE FROM _TestNotificationFailure');
      if (request.method === 'POST') {
        const manager = await this.db.user.findUnique({ where: { email: 'manager@example.com' } });
        this.ctx.storage.sql.exec('INSERT INTO _TestNotificationFailure VALUES (?)', manager.id);
        this.ctx.storage.sql.exec("CREATE TRIGGER IF NOT EXISTS test_notification_failure BEFORE INSERT ON Notification WHEN EXISTS (SELECT 1 FROM _TestNotificationFailure WHERE userId = NEW.userId) BEGIN SELECT RAISE(ABORT, 'test notification failure'); END");
      }
      return Response.json({ success: true });
    });
    if (url.pathname === '/__do-error') {
      const original = this.db;
      this.db = new Proxy(original, { get(target, key) {
        if (key === '$transaction') throw new Error('SELECT secret; password=hidden-provider-token');
        return target[key];
      } });
      try { return await super.fetch(new Request('https://internal/__internal/cron')); }
      finally { this.db = original; }
    }
    if (url.pathname === '/__constraint') return this.enqueue(async () => {
      try {
        if (url.searchParams.get('type') === 'unique') {
          const user = await this.db.user.findFirst();
          await this.db.user.create({ data: { name: 'Duplicate', email: user.email, passwordHash: 'hidden', role: 'CUSTOMER' } });
        } else if (url.searchParams.get('type') === 'fk') {
          await this.db.wallet.create({ data: { customerId: crypto.randomUUID() } });
        } else if (url.searchParams.get('type') === 'money') {
          const wallet = await this.db.wallet.findFirst();
          await this.db.walletTransaction.create({ data: { walletId: wallet.id, type: 'ADJUSTMENT', balanceType: 'PAID', amount: '100000000' } });
        } else {
          this.ctx.storage.sql.exec('INSERT INTO "Branch" (id) VALUES (?)', crypto.randomUUID());
        }
        return Response.json({ unexpectedSuccess: true });
      } catch (error) { return failureResponse(error, 'test-constraint'); }
    });
    if (new URL(request.url).pathname === '/__outbox') return Response.json(this.outbox);
    if (new URL(request.url).pathname === '/__reminders') return this.enqueue(async () => {
      const { now } = await request.json();
      return Response.json(await sendAppointmentReminders(new Date(now)));
    });
    if (new URL(request.url).pathname === '/__expire') return this.enqueue(async () => {
      const { id } = await request.json();
      await this.db.appointment.update({ where: { id }, data: { holdExpiresAt: new Date(0) } });
      return Response.json({ success: true });
    });
    if (new URL(request.url).pathname === '/__rollback') return this.enqueue(async () => {
      const wallet = await this.db.wallet.findFirst();
      let rejected = false;
      try {
        await this.db.$transaction(async tx => {
          await tx.wallet.update({ where: { id: wallet.id }, data: { paidBalance: { increment: 1 } } });
          await tx.walletTransaction.create({ data: { walletId: wallet.id, type: 'ADJUSTMENT', balanceType: 'PAID', amount: '100000000' } });
        });
      } catch { rejected = true; }
      const after = await this.db.wallet.findUnique({ where: { id: wallet.id } });
      return Response.json({ rejected, unchanged: after.paidBalance.equals(wallet.paidBalance) });
    });
    if (new URL(request.url).pathname === '/__fixtures') return this.enqueue(async () => {
      const db = this.db;
      const { customerId } = await request.json();
      const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      const day = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][new Date(date).getUTCDay()];
      const branch = await db.branch.create({ data: {
        name: 'Test Branch', address: 'Hong Kong',
        bookingPolicy: { create: { minimumBookingNoticeMinutes: 0, depositPercentage: '30' } },
        businessHours: { create: { day, openTime: '09:00', closeTime: '20:00' } },
        hourlyCapacities: { create: { day, maxBookingsPerHour: 2 } },
      }, include: { bookingPolicy: true } });
      const service = await db.service.create({ data: {
        name: 'Haircut', price: '125.55', durationMinutes: 60,
        translations: { en: { name: 'Haircut' } },
        branches: { create: { branchId: branch.id } },
      } });
      const passwordHash = await bcrypt.hash('StrongPassword123!', 10);
      const user = await db.user.create({ data: { name: 'Stylist', email: 'stylist@example.com', passwordHash, role: 'STAFF' } });
      const staff = await db.staff.create({ data: {
        userId: user.id, name: 'Stylist', email: user.email, roleTitle: 'Stylist',
        branches: { create: { branchId: branch.id } },
        services: { create: { serviceId: service.id } },
        schedule: { create: { branchId: branch.id, day, startTime: '09:00', endTime: '20:00' } },
      } });
      const manager = await db.user.create({ data: { name: 'Manager', email: 'manager@example.com', passwordHash, role: 'BRANCH_MANAGER', managedBranches: { create: { branchId: branch.id } } } });
      const otherBranch = await db.branch.create({ data: { name: 'Other branch', address: 'Other address' } });
      const otherManager = await db.user.create({ data: { name: 'Other Manager', email: 'other-manager@example.com', passwordHash, role: 'BRANCH_MANAGER', managedBranches: { create: { branchId: otherBranch.id } } } });
      const inactiveManager = await db.user.create({ data: { name: 'Inactive', email: 'inactive-manager@example.com', passwordHash, role: 'BRANCH_MANAGER', status: 'INACTIVE', managedBranches: { create: { branchId: branch.id } } } });
      const otherStaff = await db.user.create({ data: { name: 'Other Stylist', email: 'other-staff@example.com', passwordHash, role: 'STAFF', staffProfile: { create: {
        name: 'Other Stylist', email: 'other-staff@example.com', roleTitle: 'Stylist',
        branches: { create: { branchId: branch.id } }, services: { create: { serviceId: service.id } },
        schedule: { create: { branchId: branch.id, day, startTime: '09:00', endTime: '20:00' } },
      } } }, include: { staffProfile: true } });
      await db.wallet.upsert({ where: { customerId }, create: { customerId, paidBalance: 1000, bonusBalance: 100 }, update: { paidBalance: 1000, bonusBalance: 100 } });
      return Response.json({ branchId: branch.id, serviceId: service.id, staffId: staff.id, date,
        team: { staffUserId: user.id, managerId: manager.id, otherStaffProfileId: otherStaff.staffProfile.id, otherStaffUserId: otherStaff.id,
          excluded: [otherManager.id, inactiveManager.id, otherStaff.id] } });
    });
    if (new URL(request.url).pathname === '/__snapshot') return this.enqueue(async () => Response.json({
      appointments: await this.db.appointment.findMany(), payments: await this.db.payment.findMany(),
      wallets: await this.db.wallet.findMany(), ledger: await this.db.walletTransaction.findMany(),
      notifications: await this.db.notification.findMany(),
    }));
    return super.fetch(request);
  }
}
export default {
  ...worker,
  fetch(request, env) {
    if (new URL(request.url).pathname === '/__worker-error') return worker.fetch(request, {
      ...env, SALON_DB: { idFromName() { throw new Error('postgresql://secret:password@host SELECT provider-token'); } },
    });
    return worker.fetch(request, env);
  },
};
