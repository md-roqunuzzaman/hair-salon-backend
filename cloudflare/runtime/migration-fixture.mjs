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
    applyMigrations(storage, migrations.slice(0, 4));
    storage.sql.exec("INSERT INTO Payment (id, customerId, purpose, amount, updatedAt) VALUES ('legacy-payment', 'customer', 'GROUP_PURCHASE', 10000, 1)");
    storage.sql.exec("INSERT INTO Refund (id, paymentId, amount, reason, createdAt, updatedAt) VALUES ('legacy-refund', 'legacy-payment', 10000, 'LATE_GROUP_PURCHASE_PAYMENT', 1, 1)");
    storage.sql.exec("INSERT INTO Package (id, type, name, regularPrice, packagePrice, durationMinutes, updatedAt) VALUES ('legacy-package', 'GROUP_PURCHASE_PACKAGE', 'Package', 10000, 10000, 30, 1)");
    storage.sql.exec("INSERT INTO GroupPurchase (id, customerId, packageId, quantity, unitPrice, amount, purchaseFlow, updatedAt) VALUES ('legacy-direct', 'customer', 'legacy-package', 2, 10000, 20000, 'BUY_NOW_BOOK_NOW', 1)");
    applyMigrations(storage, migrations);
    applyMigrations(storage, migrations);
    const direct = storage.sql.exec("SELECT purchaseFlow, quantity, amount FROM GroupPurchase WHERE id = 'legacy-direct'").one();
    if (direct.purchaseFlow !== 'DIRECT_BOOK' || direct.quantity !== 2 || direct.amount !== 20000) throw new Error('Direct Book rename changed purchase data or failed to migrate');
    const snapshot = storage.sql.exec("SELECT refundPolicySnapshot, refundPolicyVersion, cancellationPolicySnapshot, cancellationPolicyVersion FROM GroupPurchase WHERE id = 'legacy-direct'").one();
    if (Object.values(snapshot).some(value => value !== null)) throw new Error('Upgrade invented policy snapshots for historical purchases');
    storage.sql.exec("INSERT INTO BranchCancellationPolicy (id, branchId, refundTiers, updatedAt) VALUES ('branch-policy', 'branch', '[]', 1)");
    storage.sql.exec("INSERT INTO GroupPurchaseRefundPolicy (id, packageId, refundTiers, updatedAt) VALUES ('refund-policy', 'legacy-package', '[]', 1)");
    storage.sql.exec("INSERT INTO GroupPurchaseCancellationPolicy (id, packageId, updatedAt) VALUES ('cancel-policy', 'legacy-package', 1)");
    storage.sql.exec("UPDATE GroupPurchase SET refundPolicySnapshot = ?, refundPolicyVersion = 1 WHERE id = 'legacy-direct'", JSON.stringify({ refundAllowed: true, refundTiers: [] }));
    applyMigrations(storage, migrations);
    if (JSON.parse(storage.sql.exec("SELECT refundPolicySnapshot FROM GroupPurchase WHERE id = 'legacy-direct'").one().refundPolicySnapshot).refundAllowed !== true) throw new Error('Policy snapshot was lost on repeated initialization');
    let duplicatePolicy = false;
    try { storage.sql.exec("INSERT INTO BranchCancellationPolicy (id, branchId, refundTiers, updatedAt) VALUES ('duplicate-policy', 'branch', '[]', 1)"); } catch { duplicatePolicy = true; }
    if (!duplicatePolicy) throw new Error('One policy per branch uniqueness was not enforced');
    let missingPolicyOwner = false;
    try { storage.sql.exec("INSERT INTO GroupPurchaseRefundPolicy (id, packageId, refundTiers, updatedAt) VALUES ('orphan-policy', 'missing', '[]', 1)"); } catch { missingPolicyOwner = true; }
    if (!missingPolicyOwner) throw new Error('Policy package foreign key was not enforced');
    if (storage.sql.exec("SELECT refundAttemptedAt FROM Refund WHERE id = 'legacy-refund'").one().refundAttemptedAt !== 1) throw new Error('Legacy refund attempt fence was not backfilled');
    storage.sql.exec("INSERT INTO Refund (id, paymentId, amount, reason, updatedAt) VALUES ('claim-refund', 'legacy-payment', 10000, 'test', 1)");
    const claim = token => { storage.sql.exec("UPDATE Refund SET refundAttemptedAt = 2, refundClaimToken = ? WHERE id = 'claim-refund' AND refundAttemptedAt IS NULL", token).toArray(); return storage.sql.exec("SELECT changes() AS count").one().count; };
    if (claim('claim-one') !== 1 || claim('claim-two') !== 0) throw new Error('Refund attempt compare-and-set is not atomic');

    const oldBranch = storage.sql.exec("SELECT name, address, latitude, longitude FROM Branch WHERE id = 'branch'").one();
    if (oldBranch.name !== 'Branch' || oldBranch.address !== 'Address' || oldBranch.latitude !== null || oldBranch.longitude !== null) throw new Error('Coordinates migration changed existing branch data');
    storage.sql.exec("UPDATE Branch SET latitude = ?, longitude = ? WHERE id = 'branch'", 22.3193, 114.1694);
    applyMigrations(storage, migrations);
    const located = storage.sql.exec("SELECT latitude, longitude FROM Branch WHERE id = 'branch'").one();
    if (located.latitude !== 22.3193 || located.longitude !== 114.1694) throw new Error('Coordinates lost precision or were reset on initialization');
    storage.sql.exec("INSERT INTO Branch (id, name, address, latitude, longitude, updatedAt) VALUES ('located', 'Located', 'HK', 0, 0, 1)");
    const zero = storage.sql.exec("SELECT latitude, longitude FROM Branch WHERE id = 'located'").one();
    if (zero.latitude !== 0 || zero.longitude !== 0) throw new Error('Zero coordinates were lost');
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
