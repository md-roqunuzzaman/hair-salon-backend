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
    applyMigrations(storage, migrations.slice(0, 9));
    storage.sql.exec("INSERT INTO GroupPurchaseCancellationPolicy (id, packageId, forfeitOnLateCancellation, updatedAt) VALUES ('cancel-policy', 'legacy-package', false, 1)");
    storage.sql.exec("INSERT INTO Package (id, type, name, regularPrice, packagePrice, durationMinutes, updatedAt) VALUES ('forfeit-package', 'GROUP_PURCHASE_PACKAGE', 'Keep forfeit', 10000, 10000, 30, 1)");
    storage.sql.exec("INSERT INTO GroupPurchaseCancellationPolicy (id, packageId, forfeitOnLateCancellation, updatedAt) VALUES ('forfeit-policy', 'forfeit-package', true, 1)");
    storage.sql.exec("INSERT INTO Payment (id, customerId, purpose, amount, updatedAt) VALUES ('ordinary-payment', 'customer', 'APPOINTMENT', 5000, 1)");
    storage.sql.exec("INSERT INTO RefundRequest (id, customerId, paymentId, amount, reason, updatedAt) VALUES ('group-request', 'customer', 'legacy-payment', 10000, 'test group', 1), ('ordinary-request', 'customer', 'ordinary-payment', 5000, 'test appointment', 1)");
    applyMigrations(storage, migrations.slice(0, 10));
    applyMigrations(storage, migrations.slice(0, 10));
    const direct = storage.sql.exec("SELECT purchaseFlow, quantity, amount FROM GroupPurchase WHERE id = 'legacy-direct'").one();
    if (direct.purchaseFlow !== 'DIRECT_BOOK' || direct.quantity !== 2 || direct.amount !== 20000) throw new Error('Direct Book rename changed purchase data or failed to migrate');
    const counters = storage.sql.exec("SELECT forfeitedQuantity, refundedQuantity FROM GroupPurchase WHERE id = 'legacy-direct'").one();
    if (counters.forfeitedQuantity !== 0 || counters.refundedQuantity !== 0) throw new Error('Historical entitlement defaults changed');
    for (const [id, expected] of [['cancel-policy', 'RESTORED'], ['forfeit-policy', 'FORFEITED']]) {
      if (storage.sql.exec('SELECT lateCancellationOutcome FROM GroupPurchaseCancellationPolicy WHERE id = ?', id).one().lateCancellationOutcome !== expected) throw new Error('Historical cancellation outcome was not preserved');
    }
    for (const [id, expected, amount] of [['group-request', 'GROUP_PURCHASE_REFUND', 10000], ['ordinary-request', 'APPOINTMENT_CANCELLATION', 5000]]) {
      const request = storage.sql.exec('SELECT requestType, amount, policySnapshot, eligiblePaidAmount, isCancellationOnly FROM RefundRequest WHERE id = ?', id).one();
      if (request.requestType !== expected || request.amount !== amount || request.policySnapshot !== null || request.eligiblePaidAmount !== null || request.isCancellationOnly !== 0) throw new Error('Refund request migration changed historical money or classification');
    }
    storage.sql.exec("UPDATE RefundRequest SET idempotencyKey = 'stable-key', eligiblePaidAmount = 12345, refundPercentage = 1250, refundDeduction = 12 WHERE id = 'group-request'");
    let duplicateKey = false;
    try { storage.sql.exec("UPDATE RefundRequest SET idempotencyKey = 'stable-key' WHERE id = 'ordinary-request'"); } catch { duplicateKey = true; }
    if (!duplicateKey) throw new Error('Refund request idempotency uniqueness missing');
    for (const [field, value] of [['eligiblePaidAmount', 10000000000], ['refundPercentage', 100000], ['refundDeduction', 1.5]]) {
      let rejected = false;
      try { storage.sql.exec(`UPDATE RefundRequest SET "${field}" = ? WHERE id = 'group-request'`, value); } catch { rejected = true; }
      if (!rejected) throw new Error(`Refund precision guard missing: ${field}`);
    }
    const snapshot = storage.sql.exec("SELECT refundPolicySnapshot, refundPolicyVersion, cancellationPolicySnapshot, cancellationPolicyVersion FROM GroupPurchase WHERE id = 'legacy-direct'").one();
    if (Object.values(snapshot).some(value => value !== null)) throw new Error('Upgrade invented policy snapshots for historical purchases');
    storage.sql.exec("INSERT INTO BranchCancellationPolicy (id, branchId, refundTiers, updatedAt) VALUES ('branch-policy', 'branch', '[]', 1)");
    storage.sql.exec("INSERT INTO GroupPurchaseRefundPolicy (id, packageId, refundTiers, updatedAt) VALUES ('refund-policy', 'legacy-package', '[]', 1)");
    storage.sql.exec("UPDATE GroupPurchase SET refundPolicySnapshot = ?, refundPolicyVersion = 1 WHERE id = 'legacy-direct'", JSON.stringify({ refundAllowed: true, refundTiers: [] }));
    applyMigrations(storage, migrations.slice(0, 10));
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
    applyMigrations(storage, migrations.slice(0, 10));
    const located = storage.sql.exec("SELECT latitude, longitude FROM Branch WHERE id = 'branch'").one();
    if (located.latitude !== 22.3193 || located.longitude !== 114.1694) throw new Error('Coordinates lost precision or were reset on initialization');
    storage.sql.exec("INSERT INTO Branch (id, name, address, latitude, longitude, updatedAt) VALUES ('located', 'Located', 'HK', 0, 0, 1)");
    const zero = storage.sql.exec("SELECT latitude, longitude FROM Branch WHERE id = 'located'").one();
    if (zero.latitude !== 0 || zero.longitude !== 0) throw new Error('Zero coordinates were lost');
    const policy = storage.sql.exec("SELECT qrVerificationRule, cancellationCutoffHours FROM BranchBookingPolicy WHERE id = 'policy'").one();
    if (policy.qrVerificationRule !== 'BEFORE_START_TIME' || policy.cancellationCutoffHours !== 5) throw new Error('QR upgrade changed existing policy');
    storage.sql.exec("UPDATE BranchBookingPolicy SET qrVerificationRule = 'BEFORE_END_TIME' WHERE id = 'policy'");
    applyMigrations(storage, migrations.slice(0, 10));
    if (storage.sql.exec("SELECT qrVerificationRule FROM BranchBookingPolicy WHERE id = 'policy'").one().qrVerificationRule !== 'BEFORE_END_TIME') throw new Error('Repeated initialization reset QR configuration');
    const topup = storage.sql.exec("SELECT amount, potentialBonus, promotionId FROM WalletTopup WHERE id = 'old-topup'").one();
    const wallet = storage.sql.exec("SELECT paidBalance, bonusBalance FROM Wallet WHERE id = 'wallet'").one();
    if (topup.amount !== 50000 || topup.potentialBonus !== 5000 || topup.promotionId !== null || wallet.paidBalance !== 12345 || wallet.bonusBalance !== 678) throw new Error('Upgrade changed existing data');
    let rejected = false;
    try { storage.sql.exec("UPDATE WalletTopup SET promotionId = 'missing' WHERE id = 'old-topup'"); } catch { rejected = true; }
    if (!rejected) throw new Error('Promotion foreign key not enforced');
    // An unmapped policy must stop v11 atomically, retaining all old rows/schema.
    const oldPolicy = JSON.stringify(storage.sql.exec("SELECT * FROM GroupPurchaseRefundPolicy WHERE id = 'refund-policy'").one());
    let mappingBlocked = false;
    try { applyMigrations(storage, migrations.slice(0, 18)); } catch { mappingBlocked = true; }
    if (!mappingBlocked || JSON.stringify(storage.sql.exec("SELECT * FROM GroupPurchaseRefundPolicy WHERE id = 'refund-policy'").one()) !== oldPolicy || storage.sql.exec('SELECT MAX(version) AS version FROM _Migrations').one().version !== 10) throw new Error('Ambiguous mapping did not stop and roll back safely');
    // Remove only disposable fixture policies, then seed the user's explicit mapping.
    storage.sql.exec('DELETE FROM GroupPurchaseRefundPolicy');
    storage.sql.exec('DELETE FROM GroupPurchaseCancellationPolicy');
    const mappedPackage = '9ff78b23-f681-4007-a44c-ef4277decf17';
    const mappedBranch = 'f7318524-db7c-49cf-8bc4-bfc6ff5c6b97';
    storage.sql.exec("INSERT INTO Branch (id,name,address,updatedAt) VALUES (?, 'Mapped branch', 'HK', 1)", mappedBranch);
    storage.sql.exec("INSERT INTO Package (id,type,name,regularPrice,packagePrice,durationMinutes,updatedAt) VALUES (?, 'GROUP_PURCHASE_PACKAGE','Multi-branch package',10000,10000,30,1)", mappedPackage);
    storage.sql.exec("INSERT INTO GroupPurchaseRefundPolicy (id,packageId,refundTiers,version,createdAt,updatedAt) VALUES ('mapped-refund',?, '[{" + '"minimumHoursAfterPurchase":0,"calculationType":"PERCENTAGE","value":50' + "}]',7,123,456)", mappedPackage);
    storage.sql.exec("INSERT INTO GroupPurchaseCancellationPolicy (id,packageId,lateCancellationOutcome,version,updatedAt) VALUES ('mapped-cancel',?,'RESTORED',4,456)", mappedPackage);
    let associationBlocked = false;
    try { applyMigrations(storage, migrations.slice(0, 18)); } catch { associationBlocked = true; }
    if (!associationBlocked) throw new Error('Policy migrated without an eligible target branch assignment');
    storage.sql.exec('INSERT INTO PackageBranch (packageId,branchId) VALUES (?,?),(?,?)', mappedPackage,mappedBranch,mappedPackage,'branch');
    const refundBefore = storage.sql.exec("SELECT * FROM GroupPurchaseRefundPolicy WHERE id='mapped-refund'").one();
    const cancelBefore = storage.sql.exec("SELECT * FROM GroupPurchaseCancellationPolicy WHERE id='mapped-cancel'").one();
    // Upgrade a populated v12 database with the new banner tables.
    applyMigrations(storage, migrations.slice(0, 12));
    const walletBeforeBanners = JSON.stringify(storage.sql.exec("SELECT * FROM Wallet WHERE id='wallet'").one());
    storage.sql.exec("INSERT INTO Brand (id,name,updatedAt) VALUES ('banner-brand','Banner brand',1)");
    applyMigrations(storage, migrations.slice(0, 13));
    storage.sql.exec("INSERT INTO Staff (id,userId,name,email,roleTitle,updatedAt) VALUES ('portfolio-staff','customer','Stylist','stylist@example.com','Stylist',1)");
    storage.sql.exec("INSERT INTO Service (id,name,price,durationMinutes,updatedAt) VALUES ('portfolio-service','Cut',10000,30,1)");
    applyMigrations(storage, migrations.slice(0, 14));
    for (const id of ['old-appointment-one', 'old-appointment-two', 'old-appointment-three', 'old-appointment-four']) {
      storage.sql.exec("INSERT INTO Appointment (id,customerId,branchId,staffId,bookingMethod,appointmentStatus,paymentStatus,date,startTime,endTime,price,durationMinutes,itemName,updatedAt) VALUES (?,'customer','branch','portfolio-staff','PAY_NOW','COMPLETED','PAID',1,'10:00','10:30',10000,30,'Cut',1)", id);
    }
    const oldAppointment = storage.sql.exec("SELECT * FROM Appointment WHERE id='old-appointment-one'").one();
    applyMigrations(storage, migrations.slice(0, 15));
    const { orderNumber, ...preservedAppointment } = storage.sql.exec("SELECT * FROM Appointment WHERE id='old-appointment-one'").one();
    if (orderNumber !== null || JSON.stringify(preservedAppointment) !== JSON.stringify(oldAppointment)) throw new Error('Order number upgrade changed historical appointment data');
    if (storage.sql.exec('SELECT COUNT(*) AS count FROM Appointment WHERE orderNumber IS NULL').one().count !== 4) throw new Error('Multiple legacy NULL order numbers not retained');
    storage.sql.exec("UPDATE Appointment SET orderNumber='ABC234' WHERE id='old-appointment-one'");
    let duplicateOrderNumber = false;
    try { storage.sql.exec("UPDATE Appointment SET orderNumber='ABC234' WHERE id='old-appointment-two'"); } catch { duplicateOrderNumber = true; }
    if (!duplicateOrderNumber) throw new Error('Appointment order number uniqueness missing');
    storage.sql.exec("UPDATE Appointment SET orderNumber='AAAAAA' WHERE id='old-appointment-three'");
    storage.sql.exec("UPDATE Payment SET appointmentId='old-appointment-two' WHERE id='legacy-payment'");
    const paymentsBeforeRequired = JSON.stringify(storage.sql.exec('SELECT * FROM Payment ORDER BY id').toArray());
    const refundsBeforeRequired = JSON.stringify(storage.sql.exec('SELECT * FROM Refund ORDER BY id').toArray());
    applyMigrations(storage, migrations.slice(0, 16));
    if (storage.sql.exec("SELECT orderNumber FROM Appointment WHERE id='old-appointment-one'").one().orderNumber !== 'ABC234') throw new Error('Repeated initialization reset order number');
    const backfilled = storage.sql.exec('SELECT id,orderNumber FROM Appointment ORDER BY id').toArray();
    if (backfilled.some(row => !/^[A-HJ-NP-Z2-9]{6}$/.test(row.orderNumber)) || new Set(backfilled.map(row => row.orderNumber)).size !== 4) throw new Error('Required order number backfill missing, invalid or duplicated');
    if (backfilled.find(row => row.id === 'old-appointment-three').orderNumber !== 'AAAAAA') throw new Error('Backfill overwrote an existing code');
    if (paymentsBeforeRequired !== JSON.stringify(storage.sql.exec('SELECT * FROM Payment ORDER BY id').toArray()) || refundsBeforeRequired !== JSON.stringify(storage.sql.exec('SELECT * FROM Refund ORDER BY id').toArray())) throw new Error('Backfill changed payment/refund records');
    applyMigrations(storage, migrations.slice(0, 17));
    const upgradedPayments = storage.sql.exec('SELECT * FROM Payment ORDER BY id').toArray();
    if (upgradedPayments.some(row => row.orderNumber !== null) || JSON.stringify(upgradedPayments.map(({ orderNumber, ...row }) => row)) !== paymentsBeforeRequired) throw new Error('Payment order migration changed existing payment data');
    storage.sql.exec("UPDATE Payment SET orderNumber='PAY234' WHERE id='legacy-payment'");
    let duplicatePaymentOrder = false;
    try { storage.sql.exec("UPDATE Payment SET orderNumber='PAY234' WHERE id='ordinary-payment'"); } catch { duplicatePaymentOrder = true; }
    if (!duplicatePaymentOrder) throw new Error('Payment order uniqueness not enforced');
    storage.sql.exec("INSERT INTO Payment (id,customerId,purpose,amount,orderNumber,updatedAt) VALUES ('occupied-code','customer','APPOINTMENT',1234,'A2AAAA',1),('needs-code','customer','APPOINTMENT',5678,NULL,1)");
    const beforePaymentBackfill = storage.sql.exec('SELECT * FROM Payment ORDER BY id').toArray();
    applyMigrations(storage, migrations.slice(0, 18));
    const afterPaymentBackfill = storage.sql.exec('SELECT * FROM Payment ORDER BY id').toArray();
    if (afterPaymentBackfill.some(row => !/^(?=.*[A-HJ-NP-Z])(?=.*[2-9])[A-HJ-NP-Z2-9]{6}$/.test(row.orderNumber)) || new Set(afterPaymentBackfill.map(row => row.orderNumber)).size !== afterPaymentBackfill.length) throw new Error('Payment backfill has missing, invalid or duplicate codes');
    for (const before of beforePaymentBackfill) {
      const after = afterPaymentBackfill.find(row => row.id === before.id);
      const { orderNumber: oldCode, ...oldFields } = before;
      const { orderNumber: newCode, ...newFields } = after;
      if (JSON.stringify(oldFields) !== JSON.stringify(newFields) || (oldCode !== null && oldCode !== newCode)) throw new Error('Payment backfill overwrote existing fields or codes');
    }
    applyMigrations(storage, migrations.slice(0, 18));
    if (JSON.stringify(storage.sql.exec('SELECT * FROM Payment ORDER BY id').toArray()) !== JSON.stringify(afterPaymentBackfill)) throw new Error('Repeated initialization changed payment backfill');
    if (storage.sql.exec("SELECT orderNumber FROM Payment WHERE id='legacy-payment'").one().orderNumber !== 'PAY234') throw new Error('Repeated migration reset payment order number');
    if (refundsBeforeRequired !== JSON.stringify(storage.sql.exec('SELECT * FROM Refund ORDER BY id').toArray())) throw new Error('Payment order migration changed refunds');
    let nullUpdateRejected = false;
    try { storage.sql.exec("UPDATE Appointment SET orderNumber=NULL WHERE id='old-appointment-two'"); } catch { nullUpdateRejected = true; }
    let nullInsertRejected = false;
    try { storage.sql.exec("INSERT INTO Appointment (id,customerId,branchId,staffId,bookingMethod,appointmentStatus,paymentStatus,date,startTime,endTime,price,durationMinutes,itemName,updatedAt,orderNumber) SELECT 'null-insert',customerId,branchId,staffId,bookingMethod,appointmentStatus,paymentStatus,date,startTime,endTime,price,durationMinutes,itemName,updatedAt,NULL FROM Appointment WHERE id='old-appointment-two'"); } catch (error) { nullInsertRejected = error.message.includes('NOT NULL constraint failed: Appointment.orderNumber'); }
    if (!nullUpdateRejected || !nullInsertRejected) throw new Error('Required order number NULL enforcement missing');
    applyMigrations(storage, migrations.slice(0, 18));
    if (JSON.stringify(storage.sql.exec('SELECT id,orderNumber FROM Appointment ORDER BY id').toArray()) !== JSON.stringify(backfilled)) throw new Error('Repeated initialization changed backfilled codes');
    if (storage.sql.exec('PRAGMA foreign_key_check').toArray().length) throw new Error('Required order migration broke foreign keys');
    storage.sql.exec("UPDATE Payment SET appointmentId=NULL WHERE id='legacy-payment'");
    storage.sql.exec("DELETE FROM Appointment WHERE id LIKE 'old-appointment-%'");
    storage.sql.exec("INSERT INTO StaffPortfolioCase (id,staffId,serviceId,title,tags,updatedAt) VALUES ('portfolio','portfolio-staff','portfolio-service','Cut result','[]',1)");
    storage.sql.exec("INSERT INTO StaffPortfolioCaseImage (id,caseId,objectKey,updatedAt) VALUES ('portfolio-image','portfolio','portfolio/image.jpg',1)");
    applyMigrations(storage, migrations.slice(0, 18));
    const portfolio = storage.sql.exec("SELECT status,sortOrder,tags FROM StaffPortfolioCase WHERE id='portfolio'").one();
    if (portfolio.status !== 'DRAFT' || portfolio.sortOrder !== 0 || portfolio.tags !== '[]') throw new Error('Portfolio defaults or persistence failed');
    let orphanPortfolio = false;
    try { storage.sql.exec("INSERT INTO StaffPortfolioCaseImage (id,caseId,objectKey,updatedAt) VALUES ('orphan','missing','orphan.jpg',1)"); } catch { orphanPortfolio = true; }
    if (!orphanPortfolio) throw new Error('Portfolio image foreign key not enforced');
    storage.sql.exec("DELETE FROM Service WHERE id='portfolio-service'");
    if (storage.sql.exec("SELECT serviceId FROM StaffPortfolioCase WHERE id='portfolio'").one().serviceId !== null) throw new Error('Service deletion did not retain portfolio with null service');
    storage.sql.exec("DELETE FROM Staff WHERE id='portfolio-staff'");
    for (const table of ['StaffPortfolioCase', 'StaffPortfolioCaseImage']) {
      if (storage.sql.exec(`SELECT COUNT(*) AS count FROM "${table}"`).one().count !== 0) throw new Error('Portfolio staff cascade delete failed');
    }
    applyMigrations(storage, migrations.slice(0, 18));
    const brandBeforeEmail = JSON.stringify(storage.sql.exec("SELECT * FROM Brand WHERE id='banner-brand'").one());
    applyMigrations(storage, migrations.slice(0, 19));
    if (JSON.stringify(storage.sql.exec("SELECT * FROM Brand WHERE id='banner-brand'").one()) !== brandBeforeEmail) throw new Error('Email settings migration changed brand data');
    storage.sql.exec("INSERT INTO BrandEmailSetting (id,brandId,provider,fromName,fromEmail,encryptedCredential,isEnabled,isVerified,updatedAt) VALUES ('email-setting','banner-brand','GMAIL','Salon','test@example.com','test-ciphertext',1,1,1)");
    let duplicateEmailBrand = false;
    try { storage.sql.exec("INSERT INTO BrandEmailSetting (id,brandId,provider,fromName,fromEmail,updatedAt) VALUES ('duplicate-email','banner-brand','QQ','Salon','test@example.com',1)"); } catch { duplicateEmailBrand = true; }
    if (!duplicateEmailBrand) throw new Error('One email setting per brand uniqueness missing');
    let orphanEmailBrand = false;
    try { storage.sql.exec("INSERT INTO BrandEmailSetting (id,brandId,provider,fromName,fromEmail,updatedAt) VALUES ('orphan-email','missing','QQ','Salon','test@example.com',1)"); } catch { orphanEmailBrand = true; }
    if (!orphanEmailBrand) throw new Error('Email settings brand foreign key missing');
    applyMigrations(storage, migrations.slice(0,21));
    storage.sql.exec("INSERT INTO EmailOutbox (id,brandId,eventType,idempotencyKey,recipientEmail,subject,html,status,attempts,updatedAt) VALUES ('legacy-send','banner-brand','TEST','legacy-send','test@example.com','test','test','PROCESSING',1,1),('legacy-retry','banner-brand','TEST','legacy-retry','test@example.com','test','test','PENDING',1,1),('never-attempted','banner-brand','TEST','never-attempted','test@example.com','test','test','PENDING',0,1)");
    applyMigrations(storage, migrations.slice(0,23));
    const oldJobs = storage.sql.exec('SELECT id,status,claimToken,attemptedAt,text FROM EmailOutbox ORDER BY id').toArray();
    if (oldJobs.some(j => j.status !== (j.id === 'never-attempted' ? 'PENDING' : 'DELIVERY_UNCERTAIN') || j.claimToken !== null || j.attemptedAt !== null || j.text !== null)) throw new Error('Legacy outbox upgrade could replay an ambiguous attempt');
    if (storage.sql.exec('SELECT COUNT(*) AS n FROM EmailOutboxHistory').one().n !== 0) throw new Error('Upgrade fabricated delivery history');
    if (storage.sql.exec('SELECT validationData,skipReason,terminalAt FROM EmailOutbox LIMIT 1').one().validationData !== null) throw new Error('Upgrade invented a legacy snapshot');
    let historyFk = false;
    try { storage.sql.exec("INSERT INTO EmailOutboxHistory (id,outboxId,status,sequence,attempt) VALUES ('orphan-history','missing','SENT',0,1)"); } catch { historyFk = true; }
    if (!historyFk) throw new Error('History foreign key missing');
    const retiredEvents = ['PAY_NOW_CONFIRMED','RESERVE_NOW_RESERVED','DEPOSIT_RECEIVED','GROUP_PURCHASE_SUCCESSFUL','BOOKING_CANCELLED','BOOKING_RESCHEDULED','REFUND_COMPLETED'];
    for (const [i,event] of retiredEvents.entries()) storage.sql.exec("INSERT INTO EmailOutbox (id,brandId,eventType,idempotencyKey,recipientEmail,subject,html,status,attempts,updatedAt) VALUES (?,?,?,?,?,?,?,'PENDING',?,1)",`retire-${i}`,'banner-brand',event,`retire-key-${i}`,'synthetic@example.com','preserved subject','preserved body',i);
    for (const status of ['PROCESSING','SENDING','DELIVERY_UNCERTAIN','SENT','FAILED','SKIPPED']) {
      const id=`state-${status}`;
      storage.sql.exec("INSERT INTO EmailOutbox (id,brandId,eventType,idempotencyKey,recipientEmail,subject,html,status,attempts,provider,claimToken,lockedUntil,updatedAt) VALUES (?,?,?,?,?,?,?,?,2,'GMAIL','old-fence',9999999999999,1)",id,'banner-brand','RESERVE_NOW_RESERVED',id,'synthetic@example.com','keep','keep',status);
      storage.sql.exec("INSERT INTO EmailOutboxHistory (id,outboxId,status,sequence,attempt,code) VALUES (?,?,?,5,2,'EMAIL_PREVIOUS_STATE')",`history-${status}`,id,status);
    }
    const retainedBefore=JSON.stringify(storage.sql.exec("SELECT * FROM EmailOutbox WHERE id IN ('state-DELIVERY_UNCERTAIN','state-SENT','state-FAILED','state-SKIPPED','never-attempted') ORDER BY id").toArray());
    const priorHistory=JSON.stringify(storage.sql.exec('SELECT * FROM EmailOutboxHistory ORDER BY id').toArray());
    // Fail after history insertion: the migration and ledger must roll back together.
    storage.sql.exec("CREATE TRIGGER test_retirement_failure BEFORE UPDATE ON EmailOutbox WHEN OLD.id='retire-0' BEGIN SELECT RAISE(ABORT,'synthetic retirement failure'); END");
    let failed=false;try{applyMigrations(storage,migrations);}catch{failed=true;}
    if(!failed || storage.sql.exec('SELECT MAX(version) AS n FROM _Migrations').one().n!==23 || JSON.stringify(storage.sql.exec('SELECT * FROM EmailOutboxHistory ORDER BY id').toArray())!==priorHistory || storage.sql.exec("SELECT status FROM EmailOutbox WHERE id='retire-0'").one().status!=='PENDING')throw new Error('Retirement migration was not atomic');
    storage.sql.exec('DROP TRIGGER test_retirement_failure');
    applyMigrations(storage,migrations.slice(0,24));
    // A failed v25 must not leave even its first additive column behind.
    let emailUpgradeRolledBack = false;
    try { applyMigrations(storage,[...migrations.slice(0,24),{...migrations[24],sql:migrations[24].sql+'; SELECT * FROM missing_email_upgrade_fixture;'}]); }
    catch { emailUpgradeRolledBack = true; }
    if (!emailUpgradeRolledBack || storage.sql.exec('PRAGMA table_info(Notification)').toArray().some(c=>c.name==='emailIntent')) throw new Error('Email routing upgrade was not atomic');
    applyMigrations(storage,migrations.slice(0,25));
    // Default-only v26 must preserve every existing field, including explicit
    // enabled/disabled choices and verification, encrypted credentials and dates.
    storage.sql.exec("INSERT INTO Brand (id,name,updatedAt) VALUES ('enabled-brand','Enabled merchant',1),('unverified-brand','Unverified merchant',1)");
    storage.sql.exec("INSERT INTO BrandEmailSetting (id,brandId,provider,fromName,fromEmail,encryptedCredential,oauthDataEncrypted,isEnabled,isVerified,configurationVersion,providerData,lastTestAt,lastErrorCode,updatedAt) VALUES ('enabled-setting','enabled-brand','GMAIL','Keep','synthetic@example.com','keep-cipher','keep-oauth',1,1,7,'{}',1234,'EMAIL_KEEP_HISTORY',1),('unverified-setting','unverified-brand','QQ','Keep','synthetic@qq.com','keep-other',NULL,1,0,4,NULL,NULL,NULL,2)");
    const settingsBeforeDefault=JSON.stringify(storage.sql.exec('SELECT * FROM BrandEmailSetting ORDER BY id').toArray());
    const oldEnabledDefault=storage.sql.exec('PRAGMA table_info(BrandEmailSetting)').toArray().find(column=>column.name==='isEnabled').dflt_value;
    let defaultRollback=false;
    try {applyMigrations(storage,[...migrations.slice(0,25),{...migrations[25],sql:migrations[25].sql+' SELECT * FROM missing_default_migration_fixture;'}]);} catch {defaultRollback=true;}
    if(!defaultRollback||storage.sql.exec('SELECT MAX(version) AS n FROM _Migrations').one().n!==25||JSON.stringify(storage.sql.exec('SELECT * FROM BrandEmailSetting ORDER BY id').toArray())!==settingsBeforeDefault)throw new Error('Default migration failure did not preserve existing merchants atomically');
    if(storage.sql.exec('PRAGMA table_info(BrandEmailSetting)').toArray().find(column=>column.name==='isEnabled').dflt_value!==oldEnabledDefault)throw new Error('Failed migration changed the column default');
    applyMigrations(storage,migrations.slice(0,26));
    let carouselRollback=false;
    try{applyMigrations(storage,[...migrations.slice(0,26),{...migrations[26],sql:migrations[26].sql+' SELECT * FROM missing_carousel_migration_fixture;'}]);}catch{carouselRollback=true;}
    if(!carouselRollback||storage.sql.exec('SELECT MAX(version) AS n FROM _Migrations').one().n!==26||storage.sql.exec("SELECT name FROM sqlite_master WHERE name='BannerCarouselSetting'").toArray().length)throw new Error('Carousel migration was not atomic');
    applyMigrations(storage,migrations.slice(0,27));
    const usersBeforeVerification=JSON.stringify(storage.sql.exec('SELECT * FROM User ORDER BY id').toArray());
    let verificationRollback=false;
    try{applyMigrations(storage,[...migrations.slice(0,27),{...migrations[27],sql:migrations[27].sql+' SELECT * FROM missing_verification_fixture;'}]);}catch{verificationRollback=true;}
    if(!verificationRollback||storage.sql.exec('SELECT MAX(version) AS n FROM _Migrations').one().n!==27||JSON.stringify(storage.sql.exec('SELECT * FROM User ORDER BY id').toArray())!==usersBeforeVerification||storage.sql.exec('PRAGMA table_info(User)').toArray().some(c=>c.name==='emailVerified'))throw new Error('Verification upgrade did not roll back atomically');
    applyMigrations(storage,migrations.slice(0,28));
    storage.sql.exec("INSERT INTO Branch (id,name,address,updatedAt) VALUES ('minute-branch','Minute branch','HK',1)");
    storage.sql.exec("INSERT INTO BranchCancellationPolicy (id,branchId,minimumCancellationHours,refundTiers,updatedAt) VALUES ('minute-service','minute-branch',2,?,1)",JSON.stringify([{minimumHoursBefore:2,calculationType:'PERCENTAGE',value:100},{minimumHoursBeforeAppointment:24,calculationType:'PERCENTAGE',value:50}]));
    storage.sql.exec("INSERT INTO GroupPurchaseRefundPolicy (id,branchId,refundTiers,updatedAt) VALUES ('minute-group','minute-branch',?,1)",JSON.stringify([{minimumHoursAfterPurchase:2,calculationType:'PERCENTAGE',value:80}]));
    const oldSnapshot=JSON.stringify({engineVersion:1,module:'SERVICE',branchId:'branch',version:1,config:{minimumCancellationHours:2,refundTiers:[{minimumHoursBefore:2,value:100}]}});
    storage.sql.exec("UPDATE GroupPurchase SET cancellationPolicySnapshot=? WHERE id='legacy-direct'",oldSnapshot);
    const policiesBeforeMinutes=JSON.stringify(['BranchBookingPolicy','BranchCancellationPolicy','GroupPurchaseCancellationPolicy','GroupPurchaseRefundPolicy'].map(table=>storage.sql.exec(`SELECT * FROM "${table}" ORDER BY id`).toArray()));
    let minuteRollback=false;
    try{applyMigrations(storage,[...migrations.slice(0,28),{...migrations[28],sql:migrations[28].sql+' SELECT * FROM missing_minutes_fixture;'}]);}catch{minuteRollback=true;}
    if(!minuteRollback||storage.sql.exec('SELECT MAX(version) AS n FROM _Migrations').one().n!==28||JSON.stringify(['BranchBookingPolicy','BranchCancellationPolicy','GroupPurchaseCancellationPolicy','GroupPurchaseRefundPolicy'].map(table=>storage.sql.exec(`SELECT * FROM "${table}" ORDER BY id`).toArray()))!==policiesBeforeMinutes)throw new Error('Minute conversion failed to roll back atomically');
    const validTiers=storage.sql.exec("SELECT refundTiers FROM BranchCancellationPolicy WHERE id='minute-service'").one().refundTiers;
    storage.sql.exec("UPDATE BranchCancellationPolicy SET refundTiers=? WHERE id='minute-service'",JSON.stringify([{minimumHoursBefore:'invalid'}]));
    let invalidMinuteBlocked=false;try{applyMigrations(storage,migrations);}catch{invalidMinuteBlocked=true;}
    if(!invalidMinuteBlocked||storage.sql.exec('SELECT MAX(version) AS n FROM _Migrations').one().n!==28||storage.sql.exec("SELECT name FROM sqlite_master WHERE name='_PolicyMinuteConversionGuard'").toArray().length)throw new Error('Invalid historical units were not blocked atomically');
    storage.sql.exec("UPDATE BranchCancellationPolicy SET refundTiers=? WHERE id='minute-service'",validTiers);
    storage.sql.exec("UPDATE BranchBookingPolicy SET cancellationCutoffHours=2147483647 WHERE id='policy'");
    let overflowBlocked=false;try{applyMigrations(storage,migrations);}catch{overflowBlocked=true;}
    if(!overflowBlocked||storage.sql.exec('SELECT MAX(version) AS n FROM _Migrations').one().n!==28)throw new Error('Minute overflow was not blocked');
    storage.sql.exec("UPDATE BranchBookingPolicy SET cancellationCutoffHours=5 WHERE id='policy'");
    applyMigrations(storage,migrations.slice(0,29));
    const financialTables=['Payment','Refund','RefundRequest','Wallet','WalletTransaction'];
    const financialBefore=financialTables.map(t=>storage.sql.exec(`SELECT * FROM "${t}" ORDER BY id`).toArray());
    let allocationRollback=false;
    try{applyMigrations(storage,[...migrations.slice(0,29),{...migrations[29],sql:migrations[29].sql+'; SELECT * FROM deliberately_missing_allocation_table;'}]);}catch{allocationRollback=true;}
    if(!allocationRollback||storage.sql.exec('SELECT MAX(version) AS n FROM _Migrations').one().n!==29||storage.sql.exec('PRAGMA table_info(WalletTransaction)').toArray().some(c=>c.name==='paymentId')||storage.sql.exec("SELECT name FROM sqlite_master WHERE name='RefundAllocation'").toArray().length)throw new Error('Allocation migration did not roll back atomically');
    applyMigrations(storage,migrations.slice(0,30));
    for(let i=0;i<financialTables.length;i++){
      const rows=storage.sql.exec(`SELECT * FROM "${financialTables[i]}" ORDER BY id`).toArray();
      for(let j=0;j<rows.length;j++)for(const key of Object.keys(financialBefore[i][j]))if(rows[j][key]!==financialBefore[i][j][key])throw new Error('Allocation migration changed historical money or records');
      if(rows.length!==financialBefore[i].length)throw new Error('Allocation migration invented financial records');
    }
    if(storage.sql.exec('SELECT COUNT(*) AS n FROM RefundAllocation').one().n!==0||storage.sql.exec('SELECT COUNT(*) AS n FROM WalletTransaction WHERE paymentId IS NOT NULL OR ledgerKey IS NOT NULL').one().n!==0)throw new Error('Legacy wallet provenance was guessed');
    applyMigrations(storage,migrations.slice(0,30));
    if(storage.sql.exec('SELECT MAX(version) AS n FROM _Migrations').one().n!==30||storage.sql.exec('SELECT COUNT(*) AS n FROM RefundAllocation').one().n!==0||storage.sql.exec('PRAGMA foreign_key_check').toArray().length)throw new Error('Allocation repeated initialization or foreign keys failed');
    const insertAllocation=(id,paymentId,key,amount=100)=>storage.sql.exec("INSERT INTO RefundAllocation (id,refundRequestId,paymentId,amount,provider,idempotencyKey,updatedAt) VALUES (?,'group-request',?,?,'STRIPE',?,1)",id,paymentId,amount,key);
    for(const amount of [1.5,-1,0,10000000000]){let blocked=false;try{insertAllocation('invalid-amount','legacy-payment','invalid-key',amount);}catch{blocked=true;}if(!blocked)throw new Error('Allocation minor-unit amount constraint failed');}
    insertAllocation('test-allocation','legacy-payment','allocation-key');
    for(const [id,paymentId,key,amount]of [['duplicate-source','legacy-payment','new-key',100],['orphan','no-payment','orphan-key',100],['invalid-money','legacy-payment','invalid-key',1.5],['negative-money','legacy-payment','negative-key',-1]]){
      let rejected=false;try{insertAllocation(id,paymentId,key,amount);}catch{rejected=true;}if(!rejected)throw new Error('Allocation uniqueness/FK/money guard failed');
    }
    storage.sql.exec("DELETE FROM RefundAllocation WHERE id='test-allocation'");
    const purchasesBeforeSnapshot=storage.sql.exec('SELECT * FROM GroupPurchase ORDER BY id').toArray();
    let snapshotRollback=false;
    try{applyMigrations(storage,[...migrations.slice(0,30),{...migrations[30],sql:migrations[30].sql+'; SELECT * FROM deliberately_missing_validity_table;'}]);}catch{snapshotRollback=true;}
    if(!snapshotRollback||storage.sql.exec('SELECT MAX(version) AS n FROM _Migrations').one().n!==30||storage.sql.exec('PRAGMA table_info(GroupPurchase)').toArray().some(c=>c.name==='validDaysSnapshot')||JSON.stringify(storage.sql.exec('SELECT * FROM GroupPurchase ORDER BY id').toArray())!==JSON.stringify(purchasesBeforeSnapshot))throw new Error('Validity snapshot upgrade did not roll back atomically');
    applyMigrations(storage,migrations);
    const purchasesAfterSnapshot=storage.sql.exec('SELECT * FROM GroupPurchase ORDER BY id').toArray();
    if(purchasesBeforeSnapshot.length!==purchasesAfterSnapshot.length)throw new Error('Validity upgrade changed purchase count');
    for(let i=0;i<purchasesBeforeSnapshot.length;i++){
      if(purchasesAfterSnapshot[i].validDaysSnapshot!==null)throw new Error('Validity upgrade guessed historical terms');
      for(const field of Object.keys(purchasesBeforeSnapshot[i]))if(purchasesAfterSnapshot[i][field]!==purchasesBeforeSnapshot[i][field])throw new Error('Validity upgrade changed historical purchase data');
    }
    const validityColumn=storage.sql.exec('PRAGMA table_info(GroupPurchase)').toArray().find(c=>c.name==='validDaysSnapshot');
    if(validityColumn.type!=='INTEGER'||validityColumn.notnull!==0||validityColumn.dflt_value!==null)throw new Error('Validity column must be a nullable integer without a guessed default');
    storage.sql.exec("UPDATE GroupPurchase SET validDaysSnapshot=30 WHERE id='legacy-direct'");
    const snapshotState=JSON.stringify(storage.sql.exec('SELECT * FROM GroupPurchase ORDER BY id').toArray());
    applyMigrations(storage,migrations);
    if(storage.sql.exec('SELECT MAX(version) AS n FROM _Migrations').one().n!==31||JSON.stringify(storage.sql.exec('SELECT * FROM GroupPurchase ORDER BY id').toArray())!==snapshotState||storage.sql.exec('PRAGMA foreign_key_check').toArray().length)throw new Error('Validity repeated initialization or foreign keys failed');

    if(storage.sql.exec("SELECT cancellationCutoffMinutes FROM BranchBookingPolicy WHERE id='policy'").one().cancellationCutoffMinutes!==300)throw new Error('Hour cutoff not converted to minutes');
    const convertedService=storage.sql.exec("SELECT minimumCancellationMinutes,refundTiers FROM BranchCancellationPolicy WHERE id='minute-service'").one();
    if(convertedService.minimumCancellationMinutes!==120||convertedService.refundTiers!==JSON.stringify([{calculationType:'PERCENTAGE',value:100,minimumMinutesBefore:120},{calculationType:'PERCENTAGE',value:50,minimumMinutesBeforeAppointment:1440}]))throw new Error('Service policy tier conversion failed');
    if(JSON.parse(storage.sql.exec("SELECT refundTiers FROM GroupPurchaseRefundPolicy WHERE id='minute-group'").one().refundTiers)[0].minimumMinutesAfterPurchase!==120)throw new Error('Group refund tiers not converted');
    for(const [table,field,expected] of [['BranchBookingPolicy','cancellationCutoffMinutes',720],['BranchBookingPolicy','rescheduleCutoffMinutes',720],['BranchCancellationPolicy','minimumCancellationMinutes',120],['GroupPurchaseCancellationPolicy','minimumCancellationMinutes',120],['GroupPurchaseCancellationPolicy','restorationMinimumMinutes',1440]])if(Number(storage.sql.exec(`PRAGMA table_info("${table}")`).toArray().find(c=>c.name===field)?.dflt_value)!==expected)throw new Error('Minute default does not preserve original duration');
    if(storage.sql.exec("SELECT cancellationPolicySnapshot FROM GroupPurchase WHERE id='legacy-direct'").one().cancellationPolicySnapshot!==oldSnapshot)throw new Error('Historical booking snapshot was rewritten');
    const minuteState=JSON.stringify(['BranchBookingPolicy','BranchCancellationPolicy','GroupPurchaseCancellationPolicy','GroupPurchaseRefundPolicy'].map(table=>storage.sql.exec(`SELECT * FROM "${table}" ORDER BY id`).toArray()));
    applyMigrations(storage,migrations);
    if(JSON.stringify(['BranchBookingPolicy','BranchCancellationPolicy','GroupPurchaseCancellationPolicy','GroupPurchaseRefundPolicy'].map(table=>storage.sql.exec(`SELECT * FROM "${table}" ORDER BY id`).toArray()))!==minuteState)throw new Error('Minute migration multiplied thresholds twice');
    const legacyVerification=storage.sql.exec("SELECT emailVerified,emailVerifiedAt FROM User WHERE id='customer'").one();
    if(legacyVerification.emailVerified!==1||legacyVerification.emailVerifiedAt!==null)throw new Error('Existing customer lost access or received an invented verification timestamp');
    storage.sql.exec("INSERT INTO User (id,name,email,passwordHash,updatedAt) VALUES ('new-unverified','New','new-unverified@example.com','hash',1)");
    applyMigrations(storage,migrations);
    const unverified=storage.sql.exec("SELECT emailVerified,emailVerifiedAt FROM User WHERE id='new-unverified'").one();
    if(unverified.emailVerified!==0||unverified.emailVerifiedAt!==null)throw new Error('Repeat startup verified a new customer');
    if(JSON.stringify(storage.sql.exec('SELECT * FROM BrandEmailSetting ORDER BY id').toArray())!==settingsBeforeDefault)throw new Error('Default migration overwrote an existing merchant choice');
    if(storage.sql.exec("SELECT name FROM sqlite_master WHERE name='_new_BrandEmailSetting'").toArray().length)throw new Error('Default migration left a temporary table');
    storage.sql.exec("INSERT INTO Brand (id,name,updatedAt) VALUES ('default-brand','New merchant',1)");
    storage.sql.exec("INSERT INTO BrandEmailSetting (id,brandId,provider,fromName,fromEmail,updatedAt) VALUES ('default-setting','default-brand','GMAIL','New','new@example.com',1)");
    const newDefault=storage.sql.exec("SELECT isEnabled,isVerified FROM BrandEmailSetting WHERE id='default-setting'").one();
    if(newDefault.isEnabled!==1||newDefault.isVerified!==0)throw new Error('New SQL defaults are not enabled/unverified');
    let defaultUnique=false;try{storage.sql.exec("INSERT INTO BrandEmailSetting (id,brandId,provider,fromName,fromEmail,updatedAt) VALUES ('duplicate-default','default-brand','GMAIL','New','new@example.com',1)");}catch{defaultUnique=true;}
    if(!defaultUnique||storage.sql.exec('PRAGMA foreign_key_check').toArray().length)throw new Error('Default migration lost constraints');
    applyMigrations(storage,migrations);
    storage.sql.exec("DELETE FROM Brand WHERE id IN ('enabled-brand','unverified-brand','default-brand')");
    const emailCutoffs = JSON.stringify(storage.sql.exec('SELECT * FROM EmailEventCursor ORDER BY id').toArray());
    if (JSON.parse(emailCutoffs).length !== 6) throw new Error('Missing email restoration stream cutoffs');
    applyMigrations(storage,migrations);
    if (JSON.stringify(storage.sql.exec('SELECT * FROM EmailEventCursor ORDER BY id').toArray()) !== emailCutoffs) throw new Error('Repeated initialization changed email restoration cutoffs');
    for(const [i]of retiredEvents.entries()) {
      const job=storage.sql.exec('SELECT * FROM EmailOutbox WHERE id=?',`retire-${i}`).one();
      if(job.status!=='SKIPPED'||job.skipReason!=='EMAIL_BUSINESS_EMAILS_RETIRED'||job.attempts!==i||job.subject!=='preserved subject'||job.html!=='preserved body'||job.terminalAt===null)throw new Error('Retirement changed records or failed to suppress pending mail');
    }
    for(const status of ['PROCESSING','SENDING']) {
      const job=storage.sql.exec('SELECT * FROM EmailOutbox WHERE id=?',`state-${status}`).one();
      if(job.status!=='DELIVERY_UNCERTAIN'||job.claimToken!==null||job.lockedUntil!==null||job.attempts!==2)throw new Error('Retirement could replay an abandoned send');
      if(storage.sql.exec('SELECT sequence FROM EmailOutboxHistory WHERE outboxId=? ORDER BY sequence DESC LIMIT 1',job.id).one().sequence!==6)throw new Error('Retirement history sequence lost');
    }
    if(JSON.stringify(storage.sql.exec("SELECT * FROM EmailOutbox WHERE id IN ('state-DELIVERY_UNCERTAIN','state-SENT','state-FAILED','state-SKIPPED','never-attempted') ORDER BY id").toArray())!==retainedBefore)throw new Error('Retirement modified historical or unrelated records');
    for(const row of JSON.parse(priorHistory)) if(JSON.stringify(storage.sql.exec('SELECT * FROM EmailOutboxHistory WHERE id=?',row.id).one())!==JSON.stringify(row))throw new Error('Prior history modified');
    const afterRetirement=JSON.stringify(storage.sql.exec('SELECT * FROM EmailOutboxHistory ORDER BY id').toArray());
    applyMigrations(storage,migrations);
    storage.transactionSync(()=>storage.sql.exec(migrations[23].sql));
    if(JSON.stringify(storage.sql.exec('SELECT * FROM EmailOutboxHistory ORDER BY id').toArray())!==afterRetirement)throw new Error('Repeated retirement duplicated history');
    const emailSetting = storage.sql.exec("SELECT * FROM BrandEmailSetting WHERE id='email-setting'").one();
    if (emailSetting.isEnabled !== 0 || emailSetting.isVerified !== 0 || emailSetting.encryptedCredential !== 'test-ciphertext') throw new Error('Email settings defaults/persistence failed');
    if (emailSetting.configurationVersion !== 1 || emailSetting.providerData !== null) throw new Error('Email provider configuration upgrade defaults failed');
    storage.sql.exec("UPDATE BrandEmailSetting SET isEnabled=1,isVerified=1 WHERE id='email-setting'");
    applyMigrations(storage, migrations);
    if (storage.sql.exec("SELECT isEnabled FROM BrandEmailSetting WHERE id='email-setting'").one().isEnabled !== 1) throw new Error('Repeated upgrade invalidated newly verified settings');
    storage.sql.exec("INSERT INTO Banner (id,brandId,title,updatedAt) VALUES ('banner','banner-brand','Launch',1)");
    storage.sql.exec("INSERT INTO BannerBranch (bannerId,branchId) VALUES ('banner','branch')");
    storage.sql.exec("INSERT INTO BannerMedia (id,bannerId,mediaType,objectKey) VALUES ('image','banner','IMAGE','banners/banner/image.jpg'),('video','banner','VIDEO','banners/banner/video.mp4')");
    applyMigrations(storage, migrations);
    const banner = storage.sql.exec("SELECT status,scope,sortOrder FROM Banner WHERE id='banner'").one();
    if (banner.status !== 'DRAFT' || banner.scope !== 'SELECTED_BRANCHES' || banner.sortOrder !== 0) throw new Error('Banner defaults changed');
    if (storage.sql.exec("SELECT COUNT(*) AS count FROM BannerMedia WHERE bannerId='banner'").one().count !== 2) throw new Error('Repeated initialization lost banner media');
    let orphanBanner = false;
    try { storage.sql.exec("INSERT INTO BannerBranch (bannerId,branchId) VALUES ('banner','missing')"); } catch { orphanBanner = true; }
    if (!orphanBanner) throw new Error('Banner branch foreign key not enforced');
    storage.sql.exec("DELETE FROM Brand WHERE id='banner-brand'");
    for (const table of ['Banner', 'BannerBranch', 'BannerMedia', 'BrandEmailSetting']) {
      if (storage.sql.exec(`SELECT COUNT(*) AS count FROM "${table}"`).one().count !== 0) throw new Error('Banner cascade delete failed');
    }
    if (JSON.stringify(storage.sql.exec("SELECT * FROM Wallet WHERE id='wallet'").one()) !== walletBeforeBanners) throw new Error('Banner migration changed wallet data');
    for (const [table,before] of [['GroupPurchaseRefundPolicy',refundBefore],['GroupPurchaseCancellationPolicy',cancelBefore]]) {
      const {packageId,...preserved} = before;
      const after = storage.sql.exec(`SELECT * FROM "${table}" WHERE id=?`,before.id).one();
      const minutes={minimumCancellationHours:'minimumCancellationMinutes',restorationMinimumHours:'restorationMinimumMinutes'};
      if (after.branchId !== mappedBranch || Object.entries(preserved).some(([key,value]) => {
        if(minutes[key])return after[minutes[key]]!==value*60;
        if(key==='refundTiers'){
          const expected=JSON.parse(value),actual=JSON.parse(after[key]);
          return actual.length!==expected.length||actual.some((t,i)=>JSON.stringify(Object.entries(t).map(([k,v])=>k==='minimumMinutesAfterPurchase'?['minimumHoursAfterPurchase',v/60]:[k,v]).sort())!==JSON.stringify(Object.entries(expected[i]).sort()));
        }
        return after[key]!==value;
      })) throw new Error('Mapped policy settings, version, timestamps or identity changed');
    }
    if (storage.sql.exec('SELECT COUNT(*) AS count FROM PackageBranch WHERE packageId=?',mappedPackage).one().count !== 2) throw new Error('Multi-branch package assignments changed');
    const merchantDefaults=storage.sql.exec("SELECT policyFormat,boundaryMode FROM GroupPurchaseRefundPolicy WHERE id='mapped-refund'").one();
    if(merchantDefaults.policyFormat!=='REFUND_TIERS_V1'||merchantDefaults.boundaryMode!=='MINIMUM_INCLUSIVE')throw new Error('v12 changed historical tier semantics');
    const historical=storage.sql.exec("SELECT purchaseBranchId,refundPolicySnapshot FROM GroupPurchase WHERE id='legacy-direct'").one();
    if(historical.purchaseBranchId!==null||historical.refundPolicySnapshot!==JSON.stringify({refundAllowed:true,refundTiers:[]}))throw new Error('v12 changed historical branch or saved policy terms');
    let invalidBranch=false;
    try{storage.sql.exec("UPDATE GroupPurchase SET purchaseBranchId='missing' WHERE id='legacy-direct'");}catch{invalidBranch=true;}
    if(!invalidBranch)throw new Error('Purchase policy branch foreign key not enforced');
    let mismatch = false;
    try { applyMigrations(storage, [{ ...migrations[0], checksum: 'changed' }, migrations[1]]); } catch { mismatch = true; }
    if (!mismatch) throw new Error('Edited applied migration accepted');
    storage.sql.exec("INSERT INTO Brand (id,name,updatedAt) VALUES ('carousel-brand','Carousel test',1)");
    storage.sql.exec("INSERT INTO Branch (id,name,address,updatedAt) VALUES ('carousel-a','A','A',1),('carousel-b','B','B',1)");
    storage.sql.exec("INSERT INTO BannerCarouselSetting (id,branchId,updatedAt) VALUES ('carousel-default','carousel-a',1)");
    storage.sql.exec("INSERT INTO BannerCarouselSetting (id,branchId,brandId,imageIntervalMs,videoIntervalMs,updatedAt) VALUES ('carousel-custom','carousel-b','carousel-brand',9000,20000,1)");
    const carouselDefault=storage.sql.exec("SELECT imageIntervalMs,videoIntervalMs,brandId FROM BannerCarouselSetting WHERE id='carousel-default'").one();
    if(carouselDefault.imageIntervalMs!==5000||carouselDefault.videoIntervalMs!==15000||carouselDefault.brandId!==null)throw new Error('Carousel defaults changed');
    let carouselUnique=false,carouselForeignKey=false,carouselRequired=false;
    try{storage.sql.exec("INSERT INTO BannerCarouselSetting (id,branchId,updatedAt) VALUES ('duplicate-carousel','carousel-a',1)");}catch{carouselUnique=true;}
    try{storage.sql.exec("INSERT INTO BannerCarouselSetting (id,branchId,updatedAt) VALUES ('orphan-carousel','missing',1)");}catch{carouselForeignKey=true;}
    try{storage.sql.exec("INSERT INTO BannerCarouselSetting (id,updatedAt) VALUES ('null-carousel',1)");}catch{carouselRequired=true;}
    if(!carouselUnique||!carouselForeignKey||!carouselRequired)throw new Error('Carousel constraints missing');
    const carouselBefore=JSON.stringify(storage.sql.exec('SELECT * FROM BannerCarouselSetting ORDER BY id').toArray());
    applyMigrations(storage,migrations);
    if(JSON.stringify(storage.sql.exec('SELECT * FROM BannerCarouselSetting ORDER BY id').toArray())!==carouselBefore)throw new Error('Repeat initialization reset carousel settings');
    storage.sql.exec("DELETE FROM Brand WHERE id='carousel-brand'");
    if(storage.sql.exec("SELECT brandId FROM BannerCarouselSetting WHERE id='carousel-custom'").one().brandId!==null)throw new Error('Carousel brand deletion must retain branch settings');
    storage.sql.exec("DELETE FROM Branch WHERE id IN ('carousel-a','carousel-b')");
    if(storage.sql.exec('SELECT COUNT(*) AS n FROM BannerCarouselSetting').one().n!==0||storage.sql.exec('PRAGMA foreign_key_check').toArray().length)throw new Error('Carousel branch cascade failed');
    return Response.json({ preserved: true, repeatable: true, foreignKey: true, checksumProtected: true });
  }
}
export default { fetch(request, env) { return env.DB.get(env.DB.idFromName('upgrade')).fetch(request); } };
