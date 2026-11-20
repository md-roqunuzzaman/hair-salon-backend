// Disposable test entry only. Never referenced by Cloudflare deployment configuration.
import worker, { SalonTestDatabase as Base } from '../../cloudflare/runtime/integration-fixture.mjs';
import bcrypt from 'bcryptjs';
import { fixture, checks } from './checks.mjs';

export class SalonTestDatabase extends Base {
  async fetch(request) {
    if (new URL(request.url).pathname === '/__admin-order-tests') return this.enqueue(async () => {
      try {
        if (!this.adminOrderFixture) {
          this.adminOrderFixture = await fixture(this.db);
          const passwordHash = await bcrypt.hash('SyntheticAdminOrders123!', 10);
          await this.db.user.updateMany({ where: { email: { endsWith: '@admin-order.invalid' } }, data: { passwordHash } });
        }
        const results = await this.db.$transaction(db => checks(db, 'sqlite', this.adminOrderFixture));
        return Response.json({ results, fixture: this.adminOrderFixture });
      } catch (e) { return Response.json({ error: e.stack }, { status: 500 }); }
    });
    return super.fetch(request);
  }
}
export default worker;
