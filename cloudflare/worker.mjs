import { connect } from 'cloudflare:sockets';
import { sendBusinessEmail, resolveEmailBrand } from '../src/app/module/brand-email-setting/brand-email-setting.sender.ts';
import { httpServerHandler } from 'cloudflare:node';
import app from '../src/app.ts';
import { applicationRuntime } from './runtime/context.mjs';
import { createDatabase } from './runtime/database.mjs';
import { Sessions } from './runtime/sessions.mjs';
import migrations from './.build/migrations.mjs';
import { applyMigrations } from './runtime/migrations.mjs';
import { seedInitialData } from '../src/app/utils/seed.ts';
import { appointmentService } from '../src/app/module/appointment/appointment.service.ts';
import { groupPurchaseExpiryService } from '../src/app/module/group-purchase/group-purchase-expiry.service.ts';
import { failureResponse } from './runtime/errors.mjs';
import { AppError } from '../src/app/utils/app-error.ts';
import { logUnexpectedError } from '../src/app/utils/normalize-error.ts';
import { retryIdempotentDatabaseOperation } from '../src/app/utils/retry-database.ts';

import { sendAppointmentReminders } from '../src/app/module/notification/notification-reminder.service.ts';
import { runCronTasks } from './runtime/cron.mjs';
import { processBusinessEmailBatch } from '../src/app/module/brand-email-setting/brand-email-setting.outbox-processor.ts';

app.listen(3000);
const http = httpServerHandler({ port: 3000 });

// One object owns all related tables. Requests and cron jobs enter the same
// queue, so availability checks and writes cannot race across Worker instances.
export class SalonDatabase {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.tail = Promise.resolve();
    ctx.blockConcurrencyWhile(async () => {
      applyMigrations(ctx.storage, migrations);
      this.sessions = new Sessions(ctx.storage);
      this.db = createDatabase(ctx.storage);
    });
  }
  async sendMail(message) { return sendBusinessEmail({ ...message, brandId: await resolveEmailBrand() }); }
  connectSmtp(address, options) { return connect(address, options); }
  enqueue(callback) {
    const result = this.tail.then(() => applicationRuntime.run({
      prisma: this.db, redis: this.sessions,
      sendMail: message => this.sendMail(message),
      connectSmtp: (address, options) => this.connectSmtp(address, options),
    }, callback));
    this.tail = result.catch(() => {});
    return result;
  }
  async fetch(request) {
    try {
      return await this.enqueue(async () => {
      const path = new URL(request.url).pathname;
      if (path === '/__internal/cron') {
        await runCronTasks([
          ['appointment-expiry', () => appointmentService.expirePendingAppointments()],
          ['group-expiry', () => groupPurchaseExpiryService.expirePendingGroupPurchases()],
          ['completion', () => retryIdempotentDatabaseOperation(() => appointmentService.completeEligibleAppointments())],
          ['reminders', () => sendAppointmentReminders()],
          ['merchant-email', () => processBusinessEmailBatch(2)],
          ['session-cleanup', () => this.sessions.cleanup()],
        ]);
        return new Response('OK');
      }
      if (path === '/__internal/seed') {
        if (await this.ctx.storage.get('seeded')) throw new AppError('Setup already completed', 409);
        await seedInitialData();
        await this.ctx.storage.put('seeded', true);
        return new Response('Seed complete');
      }
      const response = await http.fetch(request, this.env, this.ctx);
      // Finish the request before the next handler enters the database queue.
      return new Response(await response.arrayBuffer(), response);
      });
    } catch (error) {
      return failureResponse(error, 'durable-object');
    }
  }
}

const database = env => env.SALON_DB.get(env.SALON_DB.idFromName('salon-v1'));
export default {
  async fetch(request, env) {
    try {
      const path = new URL(request.url).pathname;
      if (path.startsWith('/__internal')) throw new AppError('Route not found', 404);
      if (path === '/__setup') {
        if (request.method !== 'POST' || !env.BOOTSTRAP_TOKEN || env.BOOTSTRAP_TOKEN.length < 32 ||
            request.headers.get('authorization') !== `Bearer ${env.BOOTSTRAP_TOKEN}`) {
          throw new AppError('Route not found', 404);
        }
        return await database(env).fetch('https://internal/__internal/seed');
      }
      return await database(env).fetch(request);
    } catch (error) {
      return failureResponse(error, 'worker');
    }
  },
  async scheduled(_event, env, ctx) {
    const run = async () => {
      try {
        const response = await database(env).fetch('https://internal/__internal/cron');
        if (!response.ok) throw new Error(`Scheduled jobs failed: ${response.status}`);
      } catch (error) {
        logUnexpectedError(error, { source: 'scheduled' });
        throw new Error('Scheduled jobs failed');
      }
    };
    ctx.waitUntil(run());
  },
};
