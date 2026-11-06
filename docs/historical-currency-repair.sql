-- DRAFT: NOT APPROVED; DO NOT EXECUTE ON STAGING. One atomic statement.
WITH approved(id) AS (VALUES
    ('00941e18-e6c6-4949-ab62-68e271cd8d00'),
    ('03a8b09d-278c-4955-8278-7900258d6ada'),
    ('058c08ca-5971-4f7a-beb8-e1442c326075'),
    ('0bb04854-621b-41a2-9e51-0c780096a822'),
    ('0f742cf8-19b1-4506-bdb7-cf9442d9f3bb'),
    ('147d72b4-2987-4ea6-9b97-6f61d74c20e5'),
    ('18547917-d900-4aa4-8d5a-7a0a1bf21c6c'),
    ('1f54bec8-66dd-45fe-be4b-d039b17b14df'),
    ('26b78193-48b4-4575-a4e1-6d53731030b6'),
    ('2b2228d8-8d26-42f8-b9e5-ff7b0d0bd8fa'),
    ('3d913fc7-0a01-4faa-960f-b4dfbe3af8d9'),
    ('3fec171f-4738-41fe-b4dd-b8b3de51feed'),
    ('4d81f84b-37ff-4a36-8918-9ef9194a5030'),
    ('68af976f-f711-451d-9d62-f719723880e2'),
    ('6b5610f1-e3d1-4313-8800-cacd9c2f6c7e'),
    ('6bf83fc1-26d4-4085-b3dc-0f37504cf28c'),
    ('71e5ec4d-2c85-443a-aff9-c06ba492b1ad'),
    ('720a6df5-de17-4f42-a8d3-8c59837973b8'),
    ('764c1bab-59e8-4ad5-a7c1-61dd61bd94d1'),
    ('7ccca35d-6f87-4179-a910-e646aed0ca07'),
    ('7dbf6454-952c-4ea6-8222-e21a7d6fdc03'),
    ('7ee82f34-eb82-4ebd-92b9-b0cd06751903'),
    ('80a316c8-8d6c-400f-9216-3c094caa56a3'),
    ('82b871ff-0a3e-4aa2-971a-5ea45adad7e6'),
    ('8970754b-e250-4c03-b0d9-b934fcf1b3db'),
    ('91422ac4-c42e-4c48-bf6d-8b0e81317758'),
    ('a453540c-bdb7-4881-998c-bf14a4ef81b7'),
    ('a63e6f39-e710-4211-8e92-a5885277ce1d'),
    ('b5fca63e-562a-42aa-b4d7-93328db225bc'),
    ('b60477f4-77ea-4397-b380-ee1765fe8345'),
    ('bea9472b-5e33-43f4-88c2-6a1f3859214c'),
    ('c5344eaf-6250-4bb8-b967-c54bed86a50e'),
    ('d34fe09f-22b3-4bde-ae3a-5b276e44439c'),
    ('d7bb3f20-ad57-43ba-9be6-c1cec96aa7c8'),
    ('d9f6c30e-27d3-4b86-bcf8-09f5cf425ae5'),
    ('e565af0d-0eba-45b1-91d6-7e0d5efad7cf'),
    ('f6960877-7ba5-4e6a-bb11-fa4c15d2035a'),
    ('fc9b03e7-6f01-47b1-9d1e-110e8718a41d')
), expected AS (SELECT value FROM json_each(?1)), checked AS MATERIALIZED (
  SELECT g.id FROM GroupPurchase g
  JOIN approved a ON a.id=g.id
  JOIN expected e ON json_extract(e.value,'$.id')=g.id
  WHERE (g.currency IS NULL OR g.currency='HKD')
      AND json_extract(e.value,'$.currency') IS NULL
      AND g."id" IS json_extract(e.value,'$.id')
      AND g."customerId" IS json_extract(e.value,'$.customerId')
      AND g."packageId" IS json_extract(e.value,'$.packageId')
      AND g."quantity" IS json_extract(e.value,'$.quantity')
      AND g."unitPrice" IS json_extract(e.value,'$.unitPrice')
      AND g."amount" IS json_extract(e.value,'$.amount')
      AND g."paymentStatus" IS json_extract(e.value,'$.paymentStatus')
      AND g."reservationExpiresAt" IS json_extract(e.value,'$.reservationExpiresAt')
      AND g."purchasedAt" IS json_extract(e.value,'$.purchasedAt')
      AND g."createdAt" IS json_extract(e.value,'$.createdAt')
      AND g."updatedAt" IS json_extract(e.value,'$.updatedAt')
      AND g."purchaseFlow" IS json_extract(e.value,'$.purchaseFlow')
      AND g."bookingMethod" IS json_extract(e.value,'$.bookingMethod')
      AND g."depositPercentage" IS json_extract(e.value,'$.depositPercentage')
      AND g."depositAmount" IS json_extract(e.value,'$.depositAmount')
      AND g."remainingAmount" IS json_extract(e.value,'$.remainingAmount')
      AND g."settledPaymentId" IS json_extract(e.value,'$.settledPaymentId')
      AND g."cancellationPolicySnapshot" IS json_extract(e.value,'$.cancellationPolicySnapshot')
      AND g."cancellationPolicyVersion" IS json_extract(e.value,'$.cancellationPolicyVersion')
      AND g."refundPolicySnapshot" IS json_extract(e.value,'$.refundPolicySnapshot')
      AND g."refundPolicyVersion" IS json_extract(e.value,'$.refundPolicyVersion')
      AND g."forfeitedQuantity" IS json_extract(e.value,'$.forfeitedQuantity')
      AND g."refundedQuantity" IS json_extract(e.value,'$.refundedQuantity')
      AND g."purchaseBranchId" IS json_extract(e.value,'$.purchaseBranchId')
      AND g."emailPurchaseConfirmedAt" IS json_extract(e.value,'$.emailPurchaseConfirmedAt')
      AND g."validDaysSnapshot" IS json_extract(e.value,'$.validDaysSnapshot')
), decision AS MATERIALIZED (SELECT 1 AS ok WHERE (SELECT COUNT(*) FROM expected)=38
  AND (SELECT COUNT(DISTINCT json_extract(value,'$.id')) FROM expected)=38
  AND NOT EXISTS (SELECT 1 FROM expected WHERE json_extract(value,'$.id') NOT IN (SELECT id FROM approved))
  AND (SELECT COUNT(*) FROM checked)=38
  AND (SELECT COUNT(*) FROM "Payment") = json_array_length(json_extract(?2,'$.Payment'))
  AND NOT EXISTS (SELECT 1 FROM "Payment" t WHERE NOT EXISTS (
    SELECT 1 FROM json_each(?2,'$.Payment') witness
    WHERE t."id" IS json_extract(witness.value,'$.id') AND t."customerId" IS json_extract(witness.value,'$.customerId') AND t."groupPurchaseId" IS json_extract(witness.value,'$.groupPurchaseId') AND t."appointmentId" IS json_extract(witness.value,'$.appointmentId') AND t."purpose" IS json_extract(witness.value,'$.purpose') AND t."provider" IS json_extract(witness.value,'$.provider') AND t."amount" IS json_extract(witness.value,'$.amount') AND t."currency" IS json_extract(witness.value,'$.currency') AND t."status" IS json_extract(witness.value,'$.status') AND t."createdAt" IS json_extract(witness.value,'$.createdAt') AND t."updatedAt" IS json_extract(witness.value,'$.updatedAt')))
  AND (SELECT COUNT(*) FROM "Appointment") = json_array_length(json_extract(?2,'$.Appointment'))
  AND NOT EXISTS (SELECT 1 FROM "Appointment" t WHERE NOT EXISTS (
    SELECT 1 FROM json_each(?2,'$.Appointment') witness
    WHERE t."id" IS json_extract(witness.value,'$.id') AND t."customerId" IS json_extract(witness.value,'$.customerId') AND t."groupPurchaseId" IS json_extract(witness.value,'$.groupPurchaseId') AND t."currency" IS json_extract(witness.value,'$.currency') AND t."paymentStatus" IS json_extract(witness.value,'$.paymentStatus') AND t."appointmentStatus" IS json_extract(witness.value,'$.appointmentStatus') AND t."createdAt" IS json_extract(witness.value,'$.createdAt') AND t."updatedAt" IS json_extract(witness.value,'$.updatedAt')))
  AND (SELECT COUNT(*) FROM "Wallet") = json_array_length(json_extract(?2,'$.Wallet'))
  AND NOT EXISTS (SELECT 1 FROM "Wallet" t WHERE NOT EXISTS (
    SELECT 1 FROM json_each(?2,'$.Wallet') witness
    WHERE t."id" IS json_extract(witness.value,'$.id') AND t."customerId" IS json_extract(witness.value,'$.customerId') AND t."paidBalance" IS json_extract(witness.value,'$.paidBalance') AND t."bonusBalance" IS json_extract(witness.value,'$.bonusBalance') AND t."currency" IS json_extract(witness.value,'$.currency')))
  AND (SELECT COUNT(*) FROM "WalletTransaction") = json_array_length(json_extract(?2,'$.WalletTransaction'))
  AND NOT EXISTS (SELECT 1 FROM "WalletTransaction" t WHERE NOT EXISTS (
    SELECT 1 FROM json_each(?2,'$.WalletTransaction') witness
    WHERE t."id" IS json_extract(witness.value,'$.id') AND t."walletId" IS json_extract(witness.value,'$.walletId') AND t."paymentId" IS json_extract(witness.value,'$.paymentId') AND t."referenceId" IS json_extract(witness.value,'$.referenceId') AND t."type" IS json_extract(witness.value,'$.type') AND t."balanceType" IS json_extract(witness.value,'$.balanceType') AND t."amount" IS json_extract(witness.value,'$.amount') AND t."ledgerKey" IS json_extract(witness.value,'$.ledgerKey') AND t."createdAt" IS json_extract(witness.value,'$.createdAt')))
  AND (SELECT COUNT(*) FROM "Refund") = json_array_length(json_extract(?2,'$.Refund'))
  AND NOT EXISTS (SELECT 1 FROM "Refund" t WHERE NOT EXISTS (
    SELECT 1 FROM json_each(?2,'$.Refund') witness
    WHERE t."id" IS json_extract(witness.value,'$.id') AND t."paymentId" IS json_extract(witness.value,'$.paymentId') AND t."amount" IS json_extract(witness.value,'$.amount') AND t."status" IS json_extract(witness.value,'$.status') AND t."refundedAt" IS json_extract(witness.value,'$.refundedAt') AND t."idempotencyKey" IS json_extract(witness.value,'$.idempotencyKey')))
  AND (SELECT COUNT(*) FROM "RefundRequest") = json_array_length(json_extract(?2,'$.RefundRequest'))
  AND NOT EXISTS (SELECT 1 FROM "RefundRequest" t WHERE NOT EXISTS (
    SELECT 1 FROM json_each(?2,'$.RefundRequest') witness
    WHERE t."id" IS json_extract(witness.value,'$.id') AND t."paymentId" IS json_extract(witness.value,'$.paymentId') AND t."customerId" IS json_extract(witness.value,'$.customerId') AND t."refundId" IS json_extract(witness.value,'$.refundId') AND t."requestType" IS json_extract(witness.value,'$.requestType') AND t."policySnapshot" IS json_extract(witness.value,'$.policySnapshot') AND t."amount" IS json_extract(witness.value,'$.amount') AND t."status" IS json_extract(witness.value,'$.status') AND t."createdAt" IS json_extract(witness.value,'$.createdAt') AND t."updatedAt" IS json_extract(witness.value,'$.updatedAt')))
  AND (SELECT COUNT(*) FROM "RefundAllocation") = json_array_length(json_extract(?2,'$.RefundAllocation'))
  AND NOT EXISTS (SELECT 1 FROM "RefundAllocation" t WHERE NOT EXISTS (
    SELECT 1 FROM json_each(?2,'$.RefundAllocation') witness
    WHERE t."id" IS json_extract(witness.value,'$.id')))
  AND NOT EXISTS (SELECT 1 FROM Payment WHERE currency IS NOT 'HKD')
  AND NOT EXISTS (SELECT 1 FROM Appointment WHERE currency IS NOT 'HKD')
  AND NOT EXISTS (SELECT 1 FROM Wallet WHERE currency IS NOT 'HKD')
  AND NOT EXISTS (SELECT 1 FROM GroupPurchase WHERE currency IS NOT NULL AND currency<>'HKD')
  AND (SELECT COUNT(*) FROM Brand WHERE countryCode='HK' AND currency='HKD' AND timezone='Asia/Hong_Kong')=1 AND ((SELECT COUNT(*) FROM GroupPurchase WHERE id IN (SELECT id FROM approved) AND currency IS NULL)=38
  OR (SELECT COUNT(*) FROM GroupPurchase WHERE id IN (SELECT id FROM approved) AND currency='HKD')=38))
UPDATE GroupPurchase SET currency='HKD'
WHERE id IN (SELECT id FROM approved) AND currency IS NULL
  AND EXISTS (SELECT 1 FROM decision)
RETURNING id,currency;
