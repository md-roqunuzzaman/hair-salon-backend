"""SQLite constraint/rollback checks only; not a substitute for D1 runtime tests."""
import sqlite3
import unittest
from pathlib import Path

SCHEMA = Path(__file__).with_name('schema.sql').read_text(encoding='utf-8')


class FinancialSqlTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:', isolation_level=None)
        self.addCleanup(self.db.close)
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript(SCHEMA)
        self.db.execute("INSERT INTO Wallet VALUES ('user', 10000, 3000)")
        self.db.execute("INSERT INTO Booking VALUES ('booking','user','slot',5000,2000,5000,'PENDING_PAYMENT')")

    def pay(self, payment='payment'):
        self.db.execute("INSERT INTO Payment(id,bookingId,customerId,amount,bonusUsed,paidAt) VALUES (?, 'booking','user',5000,3000,1000)", (payment,))

    def approve(self, amount=5000, status='APPROVED', created=1000):
        self.db.execute("INSERT INTO RefundRequest VALUES ('request','payment',?,?, 'owner',?)", (amount, created, status))

    def refund(self, refund='refund'):
        self.db.execute("INSERT INTO Refund VALUES (?, 'request','payment')", (refund,))

    def balances(self):
        return self.db.execute('SELECT paid, bonus FROM Wallet').fetchone()

    def test_payment_and_refund_restore_components(self):
        self.pay()
        self.assertEqual(self.balances(), (8000, 0))
        self.approve()
        self.refund()
        self.assertEqual(self.balances(), (10000, 3000))
        self.assertEqual(self.db.execute('SELECT status FROM Booking').fetchone()[0], 'CANCELLED')
        self.assertEqual(self.db.execute('SELECT sum(paid),sum(bonus) FROM Ledger').fetchone(), (0, 0))

    def test_duplicate_payment_cannot_debit_twice(self):
        self.pay()
        with self.assertRaises(sqlite3.IntegrityError):
            self.pay('another')
        self.assertEqual(self.balances(), (8000, 0))

    def test_payment_failure_rolls_back_all_effects(self):
        self.db.executescript("CREATE TRIGGER fail BEFORE INSERT ON Notification BEGIN SELECT RAISE(ABORT,'FAIL'); END;")
        with self.assertRaises(sqlite3.IntegrityError):
            self.pay()
        self.assertEqual(self.balances(), (10000, 3000))
        self.assertEqual(self.db.execute('SELECT count(*) FROM Payment').fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT count(*) FROM Ledger').fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT status FROM Booking').fetchone()[0], 'PENDING_PAYMENT')

    def test_refund_failure_rolls_back_all_effects(self):
        self.pay()
        self.approve()
        self.db.executescript("CREATE TRIGGER fail BEFORE INSERT ON Ledger WHEN NEW.kind='REFUND' BEGIN SELECT RAISE(ABORT,'FAIL'); END;")
        with self.assertRaises(sqlite3.IntegrityError):
            self.refund()
        self.assertEqual(self.balances(), (8000, 0))
        self.assertEqual(self.db.execute('SELECT count(*) FROM Refund').fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT status FROM RefundRequest').fetchone()[0], 'APPROVED')

    def test_duplicate_refund_cannot_credit_twice(self):
        self.pay()
        self.approve()
        self.refund()
        with self.assertRaises(sqlite3.IntegrityError):
            self.refund('another')
        self.assertEqual(self.balances(), (10000, 3000))

    def test_refund_requires_full_amount_approval_and_before_cutoff(self):
        self.pay()
        for amount, status, created in [(1000, 'APPROVED', 1000), (5000, 'PENDING', 1000), (5000, 'APPROVED', 5000)]:
            self.db.execute('DELETE FROM RefundRequest')
            self.approve(amount, status, created)
            with self.assertRaises(sqlite3.IntegrityError):
                self.refund()
            self.assertEqual(self.balances(), (8000, 0))


if __name__ == '__main__':
    unittest.main(verbosity=2)
