// Financial persistence proof only. No public routes or production configuration.
export async function payBooking(db, { paymentId, bookingId, customerId, useBonus, now }) {
  // Allocation is calculated inside the same SQLite statement as validation and debit.
  const result = await db.prepare(`
    INSERT INTO Payment(id, bookingId, customerId, amount, bonusUsed, paidAt)
    SELECT ?, b.id, ?, b.amount, CASE WHEN ? THEN min(w.bonus, b.amount) ELSE 0 END, ?
    FROM Booking b JOIN Wallet w ON w.customerId = b.customerId
    WHERE b.id = ? AND b.customerId = ?
    RETURNING *
  `).bind(paymentId, customerId, useBonus ? 1 : 0, now, bookingId, customerId).first();
  // INSERT SELECT with no row is not an SQL error: explicitly reject it.
  if (!result) throw new Error('APPOINTMENT_NOT_FOUND_OR_FORBIDDEN');
  return result;
}

export async function refundBooking(db, { refundId, requestId, paymentId }) {
  return db.prepare('INSERT INTO Refund(id, requestId, paymentId) VALUES (?, ?, ?) RETURNING *')
    .bind(refundId, requestId, paymentId).first();
}
