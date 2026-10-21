import { createDatabase } from './database.mjs';
import migration from '../migrations/0001_initial.sql';
import upgrade from '../migrations/0002_wallet_topup_promotion.sql';
import { Sessions } from './sessions.mjs';

export class DatabaseFixture {
  constructor(state) {
    this.state = state;
    state.blockConcurrencyWhile(async () => state.storage.sql.exec(migration + upgrade));
    this.db = createDatabase(state.storage);
  }
  async fetch() {
    try {
      const db = this.db;
      const user = await db.user.create({ data: { name: 'Test', email: 'test@example.com', passwordHash: 'hash', role: 'CUSTOMER' } });
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
