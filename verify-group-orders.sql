SELECT
  COUNT(*) AS "total",
  COUNT(*) FILTER (WHERE "orderNumber" IS NULL) AS "missing",
  COUNT(*) FILTER (WHERE "orderNumber" IS NOT NULL) AS "completed"
FROM "GroupPurchase";
