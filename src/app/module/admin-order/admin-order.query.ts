import { Prisma } from '../../../../generated/prisma/client.js';
import { AppError } from '../../utils/app-error.js';
import type { OrderActor, OrderQuery, OrderType } from './admin-order.validation.js';

export type Dialect = 'postgresql' | 'sqlite';
export function assertOrderActor(actor: OrderActor) {
  if (!['BRAND_OWNER', 'BRANCH_MANAGER'].includes(actor.role)) throw new AppError('Forbidden', 403);
}

// Immutable purchase-time policy evidence, never current PackageBranch assignments.
// Both supported databases implement JSON ->> extraction. Treat mismatched evidence as unowned.
const snapshotBranch = (field: 'refundPolicySnapshot' | 'cancellationPolicySnapshot', module: string) => Prisma.sql`
  CASE WHEN CAST(g.${Prisma.raw('"' + field + '"')} -> 'engineVersion' AS TEXT) = '1'
    AND g.${Prisma.raw('"' + field + '"')} ->> 'module' = ${module}
  THEN g.${Prisma.raw('"' + field + '"')} ->> 'branchId' ELSE NULL END`;
const refundBranch = snapshotBranch('refundPolicySnapshot', 'GROUP_REFUND');
const cancellationBranch = snapshotBranch('cancellationPolicySnapshot', 'GROUP_CANCEL');
export const purchaseEvidence = Prisma.sql`COALESCE(g."purchaseBranchId", ${refundBranch}, ${cancellationBranch})`;
const agreesWithBrand = (snapshot: Prisma.Sql) => Prisma.sql`(${snapshot} IS NULL OR ${snapshot} = ${purchaseEvidence}
  OR EXISTS (SELECT 1 FROM "Branch" evidenceBranch JOIN "Branch" saleBranch ON saleBranch.id = ${purchaseEvidence}
    WHERE evidenceBranch.id = ${snapshot} AND evidenceBranch."brandId" = saleBranch."brandId"))`;
export const consistentEvidence = Prisma.sql`${agreesWithBrand(refundBranch)} AND ${agreesWithBrand(cancellationBranch)}`;

const scope = (actor: OrderActor, branch: Prisma.Sql) => actor.role === 'BRAND_OWNER'
  ? Prisma.sql`EXISTS (SELECT 1 FROM "Branch" sb JOIN "Brand" brand ON brand.id = sb."brandId"
      WHERE sb.id = ${branch} AND brand."ownerId" = ${actor.userId})`
  : Prisma.sql`EXISTS (SELECT 1 FROM "BranchManagerBranch" bm WHERE bm."branchId" = ${branch} AND bm."userId" = ${actor.userId})`;

export function orderSQL(actor: OrderActor, q: OrderQuery, dialect: Dialect, detail?: { type: OrderType; id: string }) {
  assertOrderActor(actor);
  const parts = (['APPOINTMENT', 'GROUP_PURCHASE'] as const).map(type => {
    const appointment = type === 'APPOINTMENT';
    const a = Prisma.raw(appointment ? 'a' : 'g');
    // Prisma's D1 adapter writes ISO text; older SQL defaults may use SQLite's
    // space-separated form. Also support historical epoch-millisecond values.
    const timestamp = (field: 'createdAt' | 'updatedAt') => {
      const value = Prisma.sql`${a}.${Prisma.raw('"' + field + '"')}`;
      return dialect === 'sqlite'
        ? Prisma.sql`CASE WHEN typeof(${value}) IN ('integer','real') THEN ${value} / 86400000.0 + 2440587.5 ELSE julianday(${value}) END`
        : value;
    };
    const branch = appointment ? Prisma.sql`a."branchId"` : Prisma.sql`g."purchaseBranchId"`;
    const evidence = appointment ? branch : actor.role === 'BRAND_OWNER' ? purchaseEvidence : branch;
    const paymentLink = Prisma.sql`p."walletTopupId" IS NULL AND p."customerId" = ${a}."customerId" AND ${appointment
      ? Prisma.sql`p."appointmentId" = a.id AND p."groupPurchaseId" IS NULL AND NOT EXISTS (SELECT 1 FROM "GroupPurchase" sg WHERE sg."settledPaymentId" = p.id)`
      : Prisma.sql`(p."groupPurchaseId" = g.id OR p.id = g."settledPaymentId" OR EXISTS (SELECT 1 FROM "Appointment" pa WHERE pa.id = p."appointmentId" AND pa."groupPurchaseId" = g.id))
        AND (p."groupPurchaseId" IS NULL OR p."groupPurchaseId" = g.id)
        AND (p."appointmentId" IS NULL OR EXISTS (SELECT 1 FROM "Appointment" pa WHERE pa.id = p."appointmentId" AND pa."groupPurchaseId" = g.id AND ${scope(actor, Prisma.sql`pa."branchId"`)}))
        AND NOT EXISTS (SELECT 1 FROM "GroupPurchase" sg WHERE sg."settledPaymentId" = p.id AND sg.id <> g.id)`}`;
    const clauses: Prisma.Sql[] = [scope(actor, evidence), appointment
      ? Prisma.sql`a."groupPurchaseId" IS NULL AND CAST(a."bookingMethod" AS TEXT) IN ('PAY_NOW','RESERVE_NOW','DEPOSIT')`
      : consistentEvidence];
    if (q.orderType && q.orderType !== type || detail && detail.type !== type) clauses.push(Prisma.sql`1 = 0`);
    if (detail) clauses.push(Prisma.sql`${a}.id = ${detail.id}`);
    if (q.branchId) clauses.push(Prisma.sql`${branch} = ${q.branchId}`);
    if (q.customerId) clauses.push(Prisma.sql`${a}."customerId" = ${q.customerId}`);
    if (q.bookingMethod) clauses.push(Prisma.sql`CAST(${a}."bookingMethod" AS TEXT) = ${q.bookingMethod}`);
    if (q.paymentStatus) clauses.push(Prisma.sql`CAST(${a}."paymentStatus" AS TEXT) = ${q.paymentStatus}`);
    if (q.appointmentStatus) clauses.push(appointment
      ? Prisma.sql`CAST(a."appointmentStatus" AS TEXT) = ${q.appointmentStatus}`
      : Prisma.sql`EXISTS (SELECT 1 FROM "Appointment" fa WHERE fa."groupPurchaseId" = g.id AND CAST(fa."appointmentStatus" AS TEXT) = ${q.appointmentStatus} AND ${scope(actor, Prisma.sql`fa."branchId"`)})`);
    if (q.paymentProvider || q.salonPaymentMethod) clauses.push(Prisma.sql`EXISTS (SELECT 1 FROM "Payment" p WHERE ${paymentLink}
      ${q.paymentProvider ? Prisma.sql`AND CAST(p.provider AS TEXT) = ${q.paymentProvider}` : Prisma.empty}
      ${q.salonPaymentMethod ? Prisma.sql`AND CAST(p.provider AS TEXT) = 'SALON' AND CAST(p."salonPaymentMethod" AS TEXT) = ${q.salonPaymentMethod}` : Prisma.empty})`);
    for (const [value, operator] of [[q.startDate, '>='], [q.endDate, '<']] as const) {
      if (value) clauses.push(Prisma.sql`(${timestamp('createdAt')}) ${Prisma.raw(operator)} ${dialect === 'sqlite' ? Prisma.sql`julianday(${value.toISOString()})` : Prisma.sql`CAST(${value.toISOString()} AS timestamp)`}`);
    }
    if (q.search) {
      const pattern = '%' + q.search.replace(/[!%_]/g, c => '!' + c).toLowerCase() + '%';
      clauses.push(Prisma.sql`(LOWER(COALESCE(${a}."orderNumber", '')) LIKE ${pattern} ESCAPE '!'
        OR LOWER(${a}.id) LIKE ${pattern} ESCAPE '!'
        OR LOWER(u.name) LIKE ${pattern} ESCAPE '!' OR LOWER(u.email) LIKE ${pattern} ESCAPE '!'
        OR LOWER(COALESCE(u.phone, '')) LIKE ${pattern} ESCAPE '!'
        OR LOWER(${appointment ? Prisma.sql`a."itemName"` : Prisma.sql`pkg.name`}) LIKE ${pattern} ESCAPE '!'
        OR LOWER(COALESCE(CAST(${appointment ? Prisma.sql`a."itemNameTranslations"` : Prisma.sql`pkg.translations`} AS TEXT), '')) LIKE ${pattern} ESCAPE '!'
        OR EXISTS (SELECT 1 FROM "Branch" searchBranch WHERE searchBranch.id = ${branch} AND LOWER(searchBranch.name) LIKE ${pattern} ESCAPE '!'))`);
    }
    return Prisma.sql`SELECT ${type} AS "orderType", ${a}.id,
      (SELECT ownershipBranch."brandId" FROM "Branch" ownershipBranch WHERE ownershipBranch.id = ${evidence}) AS "brandId",
      ${timestamp('createdAt')} AS "createdAt", ${timestamp('updatedAt')} AS "updatedAt",
      ${a}."orderNumber", ${appointment ? Prisma.sql`a.price` : Prisma.sql`g.amount`} AS amount
      FROM ${appointment ? Prisma.sql`"Appointment" a` : Prisma.sql`"GroupPurchase" g JOIN "Package" pkg ON pkg.id = g."packageId"`}
      JOIN "User" u ON u.id = ${a}."customerId" WHERE ${Prisma.join(clauses, ' AND ')}`;
  });
  const cte = Prisma.sql`WITH orders AS (${Prisma.join(parts, ' UNION ALL ')})`;
  const column = Prisma.raw('"' + q.sortBy + '"');
  const direction = Prisma.raw(q.sortOrder.toUpperCase());
  return {
    count: Prisma.sql`${cte} SELECT COUNT(*) AS total FROM orders`,
    page: Prisma.sql`${cte} SELECT "orderType", id, "brandId" FROM orders ORDER BY ${column} ${direction}, "orderType" ASC, id ASC LIMIT ${detail ? 1 : q.limit} OFFSET ${detail ? 0 : (q.page - 1) * q.limit}`,
  };
}
