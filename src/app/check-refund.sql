SELECT
  wt.id AS "transactionId",
  wt."referenceId",
  wt."paymentId",
  p."appointmentId",
  p."groupPurchaseId",
  a."itemName"
FROM "WalletTransaction" wt
LEFT JOIN "Payment" p
  ON p.id = wt."paymentId"
LEFT JOIN "Appointment" a
  ON a.id = p."appointmentId"
WHERE wt.type = 'REFUND'
  AND wt.id = '29f06257-6312-4589-83d8-14204a7208f2';