import { createDatabase } from './database.mjs';
import branchCoordinates from '../migrations/0007_branch_coordinates.sql';
import directBookRename from '../migrations/0008_rename_direct_book.sql';
import policySchema from '../migrations/0009_policy_schema.sql';
import refundEntitlements from '../migrations/0010_refund_request_entitlements.sql';
import branchPolicies from '../migrations/0011_branch_group_purchase_policies.sql';
import policyExecution from '../migrations/0012_merchant_policy_execution.sql';
import migration from '../migrations/0001_initial.sql';
import upgrade from '../migrations/0002_wallet_topup_promotion.sql';
import settlementIdentity from '../migrations/0006_group_settlement_identity.sql';
import unified from '../migrations/0004_unified_group_purchase.sql';
import attemptFence from '../migrations/0005_refund_attempt_fence.sql';
import qrUpgrade from '../migrations/0003_branch_qr_verification_rule.sql';
import { Sessions } from './sessions.mjs';

export class DatabaseFixture {
  constructor(state) {
    this.state = state;
    state.blockConcurrencyWhile(async () => state.storage.sql.exec(migration + upgrade + qrUpgrade + unified + attemptFence + settlementIdentity + branchCoordinates + directBookRename + policySchema + refundEntitlements + branchPolicies + policyExecution));
    this.db = createDatabase(state.storage);
  }
  async fetch() {
    try {
      const db = this.db;
      const locatedBranch = await db.branch.create({ data: { name: 'Coordinates', address: 'Hong Kong', latitude: 22.3193, longitude: 114.1694 } });
      const policy = await db.branchCancellationPolicy.create({ data: { branchId: locatedBranch.id, refundTiers: [{ hours: 12, percentage: 100 }] } });
      const storedPolicy = await db.branchCancellationPolicy.findUnique({ where: { branchId: locatedBranch.id } });
      if (storedPolicy.refundTiers[0].hours !== 12 || storedPolicy.version !== 1 || !storedPolicy.isEnabled) throw new Error('Policy adapter JSON/default roundtrip failed');
      await db.branchCancellationPolicy.delete({ where: { id: policy.id } });
      const coordinates = await db.branch.findUnique({ where: { id: locatedBranch.id }, select: { latitude: true, longitude: true } });
      if (coordinates.latitude !== 22.3193 || coordinates.longitude !== 114.1694) throw new Error('Prisma coordinate roundtrip failed');
      const cleared = await db.branch.update({ where: { id: locatedBranch.id }, data: { latitude: null, longitude: null } });
      if (cleared.latitude !== null || cleared.longitude !== null) throw new Error('Nullable coordinates failed');
      const user = await db.user.create({ data: { name: 'Test', email: 'test@example.com', passwordHash: 'hash', role: 'CUSTOMER' } });
      const payment = await db.payment.create({ data: { customerId: user.id, purpose: 'APPOINTMENT', amount: '123.45' } });
      const request = await db.refundRequest.create({ data: { customerId: user.id, paymentId: payment.id, amount: '123.45', reason: 'Schema roundtrip', eligiblePaidAmount: '123.45', refundPercentage: '12.50', refundDeduction: '0.12', policySnapshot: { version: 2 }, idempotencyKey: 'adapter-refund' } });
      if (request.eligiblePaidAmount.toString() !== '123.45' || request.refundPercentage.toString() !== '12.5' || request.refundDeduction.toString() !== '0.12' || request.policySnapshot.version !== 2 || request.requestType !== 'APPOINTMENT_CANCELLATION' || request.isCancellationOnly !== false) throw new Error('Refund request precision/default/JSON roundtrip failed');
      let rolledBack = false;
      try {
        await db.$transaction(async tx => {
          await tx.user.update({ where: { id: user.id }, data: { name: 'Rollback' } });
          throw new Error('rollback');
        });
      } catch { rolledBack = (await db.user.findUnique({ where: { id: user.id } })).name === 'Test'; }
      const wallet = await db.wallet.create({ data: { customerId: user.id, paidBalance: '100.01', bonusBalance: 20 } });
      const updated = await db.$transaction(async tx => {
        await tx.wallet.update({ where: { id: wallet.id }, data: { paidBalance: { decrement: '0.02' } } });
        return tx.wallet.findUnique({ where: { id: wallet.id }, include: { customer: true } });
      });
      const sum = await db.wallet.aggregate({ _sum: { paidBalance: true } });
      if (updated.paidBalance.toString() !== '99.99' || sum._sum.paidBalance.toString() !== '99.99') throw new Error('Money conversion failed');
      let uniqueCode;
      try { await db.user.create({ data: { name: 'Duplicate', email: user.email, passwordHash: 'hash', role: 'CUSTOMER' } }); }
      catch (error) { uniqueCode = error.code; }
      if (uniqueCode !== 'P2002') throw new Error(`Unexpected unique constraint mapping: ${uniqueCode}`);
      const [batch] = await db.$transaction([
        db.wallet.update({ where: { id: wallet.id }, data: { paidBalance: { increment: '0.01' } } }),
        db.user.update({ where: { id: user.id }, data: { name: 'Case Test' } }),
      ]);
      if (batch.paidBalance.toString() !== '100') throw new Error('Array transaction failed');
      const matches = await db.user.findMany({ where: { name: { contains: 'CASE', mode: 'insensitive' } } });
      if (matches.length !== 1) throw new Error('Case insensitive filtering failed');
      const locked = await db.$transaction(tx => tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`);
      if (locked[0].id !== user.id) throw new Error('Row lock translation failed');
      const promise = db.wallet.update({ where: { id: wallet.id }, data: { paidBalance: { increment: 1 } } });
      await promise;
      await promise;
      if ((await db.wallet.findUnique({ where: { id: wallet.id } })).paidBalance.toString() !== '101') throw new Error('Promise executed twice');
      const sessions = new Sessions(this.state.storage);
      await sessions.set('one-use', 'token', { EX: 60 });
      const tokens = await Promise.all([sessions.getDel('one-use'), sessions.getDel('one-use')]);
      if (tokens.filter(Boolean).length !== 1) throw new Error('Token consumed more than once');
      await sessions.set('expired', 'value', { EX: 1 });
      this.state.storage.sql.exec('UPDATE _Sessions SET expires = 0 WHERE key = ?', 'expired');
      if (await sessions.get('expired') !== null) throw new Error('Expired token returned');
      return Response.json({ rolledBack, exactMoney: true, uniqueCode, arrayTransaction: true, caseInsensitive: true, rowLocks: true, singleExecution: true, singleUseToken: true, tokenExpiry: true });
    } catch (error) { console.error(error); return Response.json({ error: error.message, stack: error.stack }, { status: 500 }); }
  }
}
export default { fetch(request, env) { return env.DB.get(env.DB.idFromName('test')).fetch(request); } };
