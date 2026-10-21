-- Isolated PAY_NOW financial proof. Not the application schema or a production migration.
CREATE TABLE Wallet (
  customerId TEXT PRIMARY KEY,
  paid INTEGER NOT NULL CHECK (paid >= 0 AND paid <= 9999999999),
  bonus INTEGER NOT NULL CHECK (bonus >= 0 AND bonus <= 9999999999)
) STRICT;
CREATE TABLE Booking (
  id TEXT PRIMARY KEY,
  customerId TEXT NOT NULL REFERENCES Wallet(customerId),
  slot TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0 AND amount <= 9999999999),
  holdUntil INTEGER NOT NULL,
  cancelCutoff INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT'
    CHECK (status IN ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED'))
) STRICT;
-- A single-capacity slot represents only the concurrency primitive in this proof.
CREATE UNIQUE INDEX active_slot ON Booking(slot) WHERE status <> 'CANCELLED';
CREATE TABLE Payment (
  id TEXT PRIMARY KEY,
  bookingId TEXT NOT NULL UNIQUE REFERENCES Booking(id),
  customerId TEXT NOT NULL REFERENCES Wallet(customerId),
  amount INTEGER NOT NULL CHECK (amount > 0),
  bonusUsed INTEGER NOT NULL CHECK (bonusUsed >= 0 AND bonusUsed <= amount),
  paidUsed INTEGER GENERATED ALWAYS AS (amount - bonusUsed) STORED,
  paidAt INTEGER NOT NULL
) STRICT;
CREATE TABLE RefundRequest (
  id TEXT PRIMARY KEY,
  paymentId TEXT NOT NULL REFERENCES Payment(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  createdAt INTEGER NOT NULL,
  reviewedBy TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REFUNDED'))
) STRICT;
CREATE TABLE Refund (
  id TEXT PRIMARY KEY,
  requestId TEXT NOT NULL UNIQUE REFERENCES RefundRequest(id),
  paymentId TEXT NOT NULL UNIQUE REFERENCES Payment(id)
) STRICT;
CREATE TABLE Ledger (
  id INTEGER PRIMARY KEY,
  customerId TEXT NOT NULL REFERENCES Wallet(customerId),
  referenceId TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('PAYMENT', 'REFUND')),
  paid INTEGER NOT NULL,
  bonus INTEGER NOT NULL,
  UNIQUE(referenceId, kind)
) STRICT;
CREATE TABLE Notification (
  referenceId TEXT PRIMARY KEY,
  customerId TEXT NOT NULL,
  kind TEXT NOT NULL
) STRICT;

CREATE TRIGGER validate_payment BEFORE INSERT ON Payment BEGIN
  SELECT RAISE(ABORT, 'APPOINTMENT_PAYMENT_CONFLICT') WHERE NOT EXISTS (
    SELECT 1 FROM Booking WHERE id = NEW.bookingId AND customerId = NEW.customerId
      AND status = 'PENDING_PAYMENT' AND holdUntil > NEW.paidAt AND amount = NEW.amount
  );
  SELECT RAISE(ABORT, 'INSUFFICIENT_WALLET_BALANCE') WHERE NOT EXISTS (
    SELECT 1 FROM Wallet WHERE customerId = NEW.customerId
      AND paid >= NEW.paidUsed AND bonus >= NEW.bonusUsed
  );
END;
CREATE TRIGGER apply_payment AFTER INSERT ON Payment BEGIN
  UPDATE Wallet SET paid = paid - NEW.paidUsed, bonus = bonus - NEW.bonusUsed
    WHERE customerId = NEW.customerId;
  UPDATE Booking SET status = 'CONFIRMED' WHERE id = NEW.bookingId;
  INSERT INTO Ledger(customerId, referenceId, kind, paid, bonus)
    VALUES (NEW.customerId, NEW.id, 'PAYMENT', -NEW.paidUsed, -NEW.bonusUsed);
  INSERT INTO Notification VALUES (NEW.id, NEW.customerId, 'BOOKING_CONFIRMED');
END;
CREATE TRIGGER validate_refund BEFORE INSERT ON Refund BEGIN
  SELECT RAISE(ABORT, 'REFUND_NOT_ELIGIBLE') WHERE NOT EXISTS (
    SELECT 1 FROM RefundRequest r JOIN Payment p ON p.id = r.paymentId
      JOIN Booking b ON b.id = p.bookingId
    WHERE r.id = NEW.requestId AND p.id = NEW.paymentId
      AND r.status = 'APPROVED' AND r.reviewedBy IS NOT NULL
      AND r.amount = p.amount AND r.createdAt < b.cancelCutoff
      AND b.status = 'CONFIRMED'
  );
  SELECT RAISE(ABORT, 'WALLET_PAYMENT_LEDGER_MISMATCH') WHERE NOT EXISTS (
    SELECT 1 FROM Payment p JOIN Ledger l ON l.referenceId = p.id
    WHERE p.id = NEW.paymentId AND l.kind = 'PAYMENT'
      AND l.customerId = p.customerId AND l.paid = -p.paidUsed AND l.bonus = -p.bonusUsed
  );
END;
CREATE TRIGGER apply_refund AFTER INSERT ON Refund BEGIN
  UPDATE Wallet SET
    paid = paid + (SELECT paidUsed FROM Payment WHERE id = NEW.paymentId),
    bonus = bonus + (SELECT bonusUsed FROM Payment WHERE id = NEW.paymentId)
    WHERE customerId = (SELECT customerId FROM Payment WHERE id = NEW.paymentId);
  INSERT INTO Ledger(customerId, referenceId, kind, paid, bonus)
    SELECT customerId, NEW.id, 'REFUND', paidUsed, bonusUsed FROM Payment WHERE id = NEW.paymentId;
  UPDATE Booking SET status = 'CANCELLED'
    WHERE id = (SELECT bookingId FROM Payment WHERE id = NEW.paymentId);
  UPDATE RefundRequest SET status = 'REFUNDED' WHERE id = NEW.requestId;
END;
