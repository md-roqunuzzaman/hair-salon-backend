import migrations from '../.build/migrations.mjs';
import { applyMigrations } from './migrations.mjs';
export class MigrationFixture {
  constructor(ctx) { this.storage = ctx.storage; }
  async fetch() {
    const storage = this.storage;
    applyMigrations(storage, migrations.slice(0, 1));
    storage.sql.exec("INSERT INTO User (id, name, email, passwordHash, updatedAt) VALUES ('customer', 'Customer', 'test@example.com', 'test', 1)");
    storage.sql.exec("INSERT INTO Wallet (id, customerId, paidBalance, bonusBalance, updatedAt) VALUES ('wallet', 'customer', 12345, 678, 1)");
    storage.sql.exec("INSERT INTO WalletTopup (id, walletId, amount, potentialBonus, updatedAt) VALUES ('old-topup', 'wallet', 50000, 5000, 1)");
    applyMigrations(storage, migrations.slice(0, 2));
    storage.sql.exec("INSERT OR IGNORE INTO Branch (id, name, address, updatedAt) VALUES ('branch', 'Branch', 'Address', 1)");
    storage.sql.exec("INSERT OR IGNORE INTO BranchBookingPolicy (id, branchId, cancellationCutoffHours, updatedAt) VALUES ('policy', 'branch', 5, 1)");
    applyMigrations(storage, migrations);
    applyMigrations(storage, migrations);
    const policy = storage.sql.exec("SELECT qrVerificationRule, cancellationCutoffHours FROM BranchBookingPolicy WHERE id = 'policy'").one();
    if (policy.qrVerificationRule !== 'BEFORE_START_TIME' || policy.cancellationCutoffHours !== 5) throw new Error('QR upgrade changed existing policy');
    storage.sql.exec("UPDATE BranchBookingPolicy SET qrVerificationRule = 'BEFORE_END_TIME' WHERE id = 'policy'");
    applyMigrations(storage, migrations);
    if (storage.sql.exec("SELECT qrVerificationRule FROM BranchBookingPolicy WHERE id = 'policy'").one().qrVerificationRule !== 'BEFORE_END_TIME') throw new Error('Repeated initialization reset QR configuration');
    const topup = storage.sql.exec("SELECT amount, potentialBonus, promotionId FROM WalletTopup WHERE id = 'old-topup'").one();
    const wallet = storage.sql.exec("SELECT paidBalance, bonusBalance FROM Wallet WHERE id = 'wallet'").one();
    if (topup.amount !== 50000 || topup.potentialBonus !== 5000 || topup.promotionId !== null || wallet.paidBalance !== 12345 || wallet.bonusBalance !== 678) throw new Error('Upgrade changed existing data');
    let rejected = false;
    try { storage.sql.exec("UPDATE WalletTopup SET promotionId = 'missing' WHERE id = 'old-topup'"); } catch { rejected = true; }
    if (!rejected) throw new Error('Promotion foreign key not enforced');
    let mismatch = false;
    try { applyMigrations(storage, [{ ...migrations[0], checksum: 'changed' }, migrations[1]]); } catch { mismatch = true; }
    if (!mismatch) throw new Error('Edited applied migration accepted');
    return Response.json({ preserved: true, repeatable: true, foreignKey: true, checksumProtected: true });
  }
}
export default { fetch(request, env) { return env.DB.get(env.DB.idFromName('upgrade')).fetch(request); } };
