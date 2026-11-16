import { Prisma } from "../../../../generated/prisma/client.js";
import { getLocalizedContent } from "../../utils/localization.js";
import {
  DEFAULT_LANGUAGE,
  isLanguage,
  type Language,
} from "../../utils/language.js";
import { enqueueBusinessEmail } from "./brand-email-setting.outbox.js";
import { BUSINESS_EMAIL_GENERATION } from "./brand-email-setting.outbox-validation.js";
import {
  emailAppointmentTime,
  emailInstant,
  emailMoney,
  renderBusinessEmail,
  type BusinessEmailEvent,
  type EmailBrand,
  type EmailDetail,
  type EmailLabel,
  type EmailSection,
} from "./brand-email-setting.templates.js";

const successful = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
type Customer = {
  id: string;
  email: string;
  name: string;
  preferredLanguage: string;
};
const language = (customer: Customer): Language =>
  isLanguage(customer.preferredLanguage)
    ? customer.preferredLanguage
    : DEFAULT_LANGUAGE;
const localizedName = (
  row: { name: string; translations: unknown },
  lang: Language,
) => getLocalizedContent(row.translations, lang, { name: row.name }).name;
const detail = (label: EmailLabel, value: unknown): EmailDetail[] =>
  value === null || value === undefined || value === ""
    ? []
    : [{ label, value: String(value) }];
const sum = (rows: { amount: Prisma.Decimal }[]) =>
  rows.reduce((total, row) => total.plus(row.amount), new Prisma.Decimal(0));
const appointmentInclude = {
  customer: true,
  branch: true,
  staff: true,
  groupPurchase: {
    include: {
      payments: {
        where: { status: { in: [...successful] }, purpose: "GROUP_PURCHASE" },
      },
    },
  },
  payments: { where: { status: { in: [...successful] } } },
} satisfies Prisma.AppointmentInclude;
type Appointment = Prisma.AppointmentGetPayload<{
  include: typeof appointmentInclude;
}>;

async function brandContext(tx: Prisma.TransactionClient, lang: Language) {
  const brands = await tx.brand.findMany({
    take: 2,
    select: {
      id: true,
      name: true,
      translations: true,
      phone: true,
      email: true,
      primaryColor: true,
      timezone: true,
    },
  });
  if (brands.length !== 1) throw new Error("EMAIL_BRAND_CONTEXT_INVALID");
  const b = brands[0]!;
  const brand: EmailBrand = {
    name: localizedName(b, lang),
    phone: b.phone,
    email: b.email,
    accentColor: b.primaryColor,
  };
  return { id: b.id, timezone: b.timezone, brand };
}
async function enqueue(
  tx: Prisma.TransactionClient,
  customer: Customer,
  event: BusinessEmailEvent,
  key: string,
  sections: EmailSection[],
  validation: Prisma.InputJsonObject,
  context: Awaited<ReturnType<typeof brandContext>>,
  appointmentId?: string,
) {
  // Render once at enqueue time. Delivery/retries keep the stored subject/body.
  return enqueueBusinessEmail(
    {
      brandId: context.id,
      userId: customer.id,
      appointmentId,
      eventType: event,
      idempotencyKey: `merchant-v1:${context.id}:${event}:${key}`,
      recipientEmail: customer.email,
      ...renderBusinessEmail(
        event,
        customer.preferredLanguage,
        customer.name,
        sections,
        context.brand,
      ),
      validationData: { generation: BUSINESS_EMAIL_GENERATION, ...validation },
    },
    tx,
  );
}
function appointmentRows(a: Appointment, lang: Language): EmailDetail[] {
  return [
    ...detail(
      "bookingNumber",
      /^[A-Z0-9]{6}$/i.test(a.orderNumber) ? a.orderNumber : null,
    ),
    ...detail(
      "item",
      getLocalizedContent(a.itemNameTranslations, lang, { name: a.itemName })
        .name,
    ),
    ...detail("branch", localizedName(a.branch, lang)),
    ...detail("branchAddress", a.branch.address),
    ...detail("branchPhone", a.branch.phone),
  ];
}
function assertCurrencies(rows: { currency: string }[], currency: string) {
  if (rows.some((row) => row.currency !== currency))
    throw new Error("EMAIL_TRANSACTION_CURRENCY_MISMATCH");
}

export async function enqueueAppointmentEmail(
  tx: Prisma.TransactionClient,
  id: string,
  event:
    | "PAY_NOW_CONFIRMED"
    | "RESERVE_NOW_RESERVED"
    | "DEPOSIT_RECEIVED"
    | "BOOKING_CANCELLED"
    | "BOOKING_RESCHEDULED",
  previous?: {
    date: Date;
    startTime: string;
    endTime: string;
    staffId: string | null;
  },
  key = id,
  target?: {
    date: string;
    startTime: string;
    endTime: string;
    staffId: string | null;
    revision?: number;
  },
) {
  // =====================================================
  // 1. FETCH APPOINTMENT
  // =====================================================

  const a = await tx.appointment.findUnique({
    where: { id },
    include: appointmentInclude,
  });

  if (!a) return null;

  // =====================================================
  // 2. VALIDATE EMAIL EVENT
  // =====================================================

  if (
    event === "PAY_NOW_CONFIRMED" &&
    (a.groupPurchaseId ||
      a.bookingMethod !== "PAY_NOW" ||
      !a.payments.some((p) => p.purpose === "APPOINTMENT"))
  ) {
    return null;
  }

  if (event === "RESERVE_NOW_RESERVED" && a.bookingMethod !== "RESERVE_NOW") {
    return null;
  }

  const deposit = a.payments.find((p) => p.purpose === "APPOINTMENT_DEPOSIT");

  if (
    event === "DEPOSIT_RECEIVED" &&
    (a.groupPurchaseId || a.bookingMethod !== "DEPOSIT" || !deposit)
  ) {
    return null;
  }

  if (event === "BOOKING_CANCELLED" && a.appointmentStatus !== "CANCELLED") {
    return null;
  }

  // =====================================================
  // 3. VALIDATE RESCHEDULE EVENT
  // =====================================================

  if (
    event === "BOOKING_RESCHEDULED" &&
    (!previous ||
      !target ||
      (previous.date.toISOString() === target.date &&
        previous.startTime === target.startTime &&
        previous.endTime === target.endTime &&
        previous.staffId === target.staffId))
  ) {
    return null;
  }

  // =====================================================
  // 4. CUSTOMER LANGUAGE + BRAND CONTEXT
  // =====================================================

  const lang = language(a.customer);

  const context = await brandContext(tx, lang);

  const zone = a.timezone ?? context.timezone;

  // =====================================================
  // 5. RESOLVE APPOINTMENT SCHEDULE
  // =====================================================

  // ISSUE #152:
  // staffId may be null when the appointment
  // does not require staff selection.

  const schedule = target ?? {
    date: a.date.toISOString(),
    startTime: a.startTime,
    endTime: a.endTime,
    staffId: a.staffId,
    revision: event === "RESERVE_NOW_RESERVED" ? 0 : a.emailScheduleRevision,
  };

  // =====================================================
  // 6. INITIAL EMAIL SECTIONS
  // =====================================================

  const sections: EmailSection[] = [
    {
      title: "appointment",
      rows: appointmentRows(a, lang),
    },
  ];

  // =====================================================
  // 7. RESCHEDULE EMAIL
  // =====================================================

  if (event === "BOOKING_RESCHEDULED") {
    // ISSUE #152:
    // Exclude null staff IDs before querying Prisma.
    // Staff-free appointments must not trigger
    // invalid staff lookups.

    const staffIds = [
      ...new Set(
        [previous!.staffId, schedule.staffId].filter(
          (staffId): staffId is string => staffId !== null,
        ),
      ),
    ];

    const staff =
      staffIds.length > 0
        ? await tx.staff.findMany({
            where: {
              id: {
                in: staffIds,
              },
            },
            select: {
              id: true,
              name: true,
            },
          })
        : [];

    sections.push(
      {
        title: "previous",
        rows: [
          ...detail(
            "appointment",
            emailAppointmentTime(
              previous!.date,
              previous!.startTime,
              previous!.endTime,
              zone,
            ),
          ),

          // Staff-free booking:
          // Omit stylist when no staff was assigned.
          ...detail(
            "stylist",
            previous!.staffId === null
              ? null
              : staff.find((s) => s.id === previous!.staffId)?.name,
          ),
        ],
      },
      {
        title: "updated",
        rows: [
          ...detail(
            "appointment",
            emailAppointmentTime(
              new Date(schedule.date),
              schedule.startTime,
              schedule.endTime,
              zone,
            ),
          ),

          ...detail(
            "stylist",
            schedule.staffId === null
              ? null
              : staff.find((s) => s.id === schedule.staffId)?.name,
          ),

          ...detail("bookingStatus", a.appointmentStatus),
        ],
      },
    );
  } else {
    // ===================================================
    // 8. STANDARD APPOINTMENT EMAIL
    // ===================================================

    sections[0]!.rows.push(
      // Existing optional relation access already
      // supports staff-free appointments.
      ...detail("stylist", a.staff?.name),

      ...detail(
        "appointment",
        emailAppointmentTime(
          new Date(schedule.date),
          schedule.startTime,
          schedule.endTime,
          zone,
        ),
      ),

      ...detail("bookingStatus", a.appointmentStatus),
    );
  }

  // =====================================================
  // 9. PAYMENT CURRENCY VALIDATION
  // =====================================================

  assertCurrencies(a.payments, a.currency);

  const total = a.groupPurchase?.amount ?? a.price;

  const relevantPayments = a.groupPurchase?.payments ?? a.payments;

  assertCurrencies(relevantPayments, a.currency);

  const paid = sum(relevantPayments);

  const money = (value: Prisma.Decimal) => emailMoney(value, a.currency, lang);

  // =====================================================
  // 10. BOOKING PAYMENT DETAILS
  // =====================================================

  if (
    ["PAY_NOW_CONFIRMED", "RESERVE_NOW_RESERVED", "DEPOSIT_RECEIVED"].includes(
      event,
    )
  ) {
    const rows = [...detail("total", money(total))];

    if (event === "DEPOSIT_RECEIVED") {
      rows.push(
        ...detail(
          "depositPercentage",
          a.depositPercentage === null
            ? null
            : `${a.depositPercentage.toString()}%`,
        ),

        ...detail("depositPaid", money(deposit!.amount)),

        ...detail(
          "remaining",
          money(a.remainingAmount ?? total.minus(deposit!.amount)),
        ),
      );
    } else {
      rows.push(...detail("paid", money(paid)));

      if (event === "RESERVE_NOW_RESERVED") {
        rows.push(
          ...detail(
            "dueAtSalon",
            money(a.remainingAmount ?? total.minus(paid)),
          ),
        );
      }
    }

    rows.push(...detail("paymentStatus", a.paymentStatus));

    sections.push({
      title: "payment",
      rows,
    });
  }

  // =====================================================
  // 11. CANCELLATION EMAIL
  // =====================================================

  if (event === "BOOKING_CANCELLED") {
    sections[0]!.rows.push(
      ...detail(
        "cancelledAt",
        a.cancelledAt ? emailInstant(a.cancelledAt, zone, lang) : null,
      ),

      ...detail("cancellationReason", a.cancellationReason),
    );

    if (a.payments.length) {
      sections.push({
        title: "payment",
        rows: [
          ...detail("paid", money(paid)),
          ...detail("paymentStatus", a.paymentStatus),
        ],
      });
    }

    // ===================================================
    // 12. REFUND REQUEST DETAILS
    // ===================================================

    const requests = await tx.refundRequest.findMany({
      where: {
        payment: {
          appointmentId: id,
        },
      },
    });

    for (const request of requests) {
      if (request.isCancellationOnly || request.amount.lte(0)) {
        continue;
      }

      // Request approval is not provider refund completion.

      sections.push({
        title: "refund",
        rows: [
          ...detail("refundAmount", money(request.amount)),
          ...detail("refundStatus", request.status),
        ],
      });
    }
  }

  // =====================================================
  // 13. ENQUEUE EMAIL
  // =====================================================

  return enqueue(
    tx,
    a.customer,
    event,
    key,
    sections,
    {
      kind: "APPOINTMENT",
      id,
      target: schedule,
    },
    context,
    id,
  );
}

export async function enqueueGroupPurchaseEmail(
  tx: Prisma.TransactionClient,
  id: string,
  sourcePaymentId?: string,
) {
  const p = await tx.groupPurchase.findUnique({
    where: { id },
    include: {
      customer: true,
      package: true,
      settledPayment: true,
      purchaseBranch: true,
      appointments: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { branch: true, staff: true },
      },
      payments: {
        where: {
          status: { in: [...successful] },
          purpose: "GROUP_PURCHASE",
          paidAt: { not: null },
        },
      },
    },
  });
  if (!p) return null;
  const paid =
    p.settledPayment ??
    (await tx.payment.findFirst({
      where: {
        groupPurchaseId: id,
        status: { in: [...successful] },
        purpose: "GROUP_PURCHASE",
        paidAt: { not: null },
      },
      orderBy: [{ paidAt: "asc" }, { id: "asc" }],
    }));
  if (
    !paid ||
    !successful.includes(paid.status as any) ||
    paid.customerId !== p.customerId ||
    paid.groupPurchaseId !== id ||
    (sourcePaymentId && sourcePaymentId !== paid.id)
  )
    return null;
  const lang = language(p.customer),
    context = await brandContext(tx, lang);
  assertCurrencies(p.payments, p.currency);
  const initial =
    p.purchaseFlow === "DIRECT_BOOK"
      ? p.appointments.find((a) => a.bookingMethod === p.bookingMethod)
      : undefined;
  const zone = initial?.timezone ?? context.timezone;
  const money = (value: Prisma.Decimal) => emailMoney(value, p.currency, lang);
  const amountPaid = sum(p.payments);
  const sections: EmailSection[] = [
    {
      title: "purchase",
      rows: [
        ...detail(
          "item",
          initial
            ? getLocalizedContent(initial.itemNameTranslations, lang, {
                name: initial.itemName,
              }).name
            : localizedName(p.package, lang),
        ),
        ...detail(
          "purchaseDate",
          p.purchasedAt ? emailInstant(p.purchasedAt, zone, lang) : null,
        ),
        ...detail("quantity", p.quantity),
        ...detail("unitPrice", money(p.unitPrice)),
        ...detail("total", money(p.amount)),
        ...detail("paid", money(amountPaid)),
        ...detail(
          "remaining",
          p.remainingAmount !== null && p.paymentStatus === "PARTIALLY_PAID"
            ? money(p.remainingAmount)
            : amountPaid.lt(p.amount)
              ? money(p.amount.minus(amountPaid))
              : null,
        ),
        ...detail("paymentStatus", p.paymentStatus),
      ],
    },
  ];
  const allocated = p.appointments.filter(
    (a) => a.appointmentStatus !== "CANCELLED",
  ).length;
  const available = Math.max(
    0,
    p.quantity - allocated - p.forfeitedQuantity - p.refundedQuantity,
  );
  sections.push({
    title: "vouchers",
    rows: [
      ...detail("totalVouchers", p.quantity),
      ...detail("availableVouchers", available),
      ...detail("allocatedVouchers", allocated),
      ...detail(
        "usedVouchers",
        p.appointments.filter((a) => a.appointmentStatus === "COMPLETED")
          .length,
      ),
      ...detail("validity", p.validDaysSnapshot),
      ...detail(
        "expiry",
        p.purchasedAt && p.validDaysSnapshot !== null
          ? emailInstant(
              new Date(
                p.purchasedAt.getTime() + p.validDaysSnapshot * 86400000,
              ),
              zone,
              lang,
            )
          : null,
      ),
    ],
  });
  if (initial)
    sections.push({
      title: "appointment",
      rows: [
        ...detail(
          "bookingNumber",
          /^[A-Z0-9]{6}$/i.test(initial.orderNumber)
            ? initial.orderNumber
            : null,
        ),
        ...detail("branch", localizedName(initial.branch, lang)),
        ...detail("branchPhone", initial.branch.phone),
        ...detail("stylist", initial.staff?.name),
        ...detail(
          "appointment",
          emailAppointmentTime(
            initial.date,
            initial.startTime,
            initial.endTime,
            zone,
          ),
        ),
        ...detail("bookingStatus", initial.appointmentStatus),
      ],
    });
  return enqueue(
    tx,
    p.customer,
    "GROUP_PURCHASE_SUCCESSFUL",
    id,
    sections,
    { kind: "GROUP", id },
    context,
  );
}

export async function enqueueRefundEmail(
  tx: Prisma.TransactionClient,
  id: string,
) {
  const r = await tx.refund.findUnique({
    where: { id },
    include: {
      payment: {
        include: {
          customer: true,
          appointment: { include: { branch: true, staff: true } },
          groupPurchase: {
            include: {
              package: true,
              purchaseBranch: true,
              appointments: {
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                take: 1,
                include: { branch: true },
              },
            },
          },
        },
      },
    },
  });
  if (!r || r.status !== "SUCCEEDED" || !r.refundedAt) return null;
  const p = r.payment,
    a = p.appointment,
    purchase = p.groupPurchase;
  if (
    (!a && !purchase) ||
    (a && a.customerId !== p.customerId) ||
    (purchase && purchase.customerId !== p.customerId)
  )
    return null;
  const lang = language(p.customer),
    context = await brandContext(tx, lang);
  // Reconciliation revisits old refunds. Preserve every existing job verbatim
  // before rebuilding historical details, including terminal/non-retryable jobs.
  const existing = await tx.emailOutbox.findUnique({
    where: {
      idempotencyKey: `merchant-v1:${context.id}:REFUND_COMPLETED:${id}`,
    },
  });
  if (existing) return existing;
  const initial =
    purchase?.purchaseFlow === "DIRECT_BOOK"
      ? purchase.appointments[0]
      : undefined;
  const booking =
    a ??
    (initial?.bookingMethod === purchase?.bookingMethod ? initial : undefined);
  const zone = booking?.timezone ?? context.timezone;
  const branch = booking?.branch ?? purchase?.purchaseBranch;
  const money = (value: Prisma.Decimal) => emailMoney(value, p.currency, lang);
  const original: EmailDetail[] = [
    ...detail(
      "item",
      booking
        ? getLocalizedContent(booking.itemNameTranslations, lang, {
            name: booking.itemName,
          }).name
        : localizedName(purchase!.package, lang),
    ),
    ...detail("branch", branch ? localizedName(branch, lang) : null),
    ...detail("branchPhone", branch?.phone),
    ...detail(
      "bookingNumber",
      booking && /^[A-Z0-9]{6}$/i.test(booking.orderNumber)
        ? booking.orderNumber
        : null,
    ),
    ...detail(
      "appointment",
      booking
        ? emailAppointmentTime(
            booking.date,
            booking.startTime,
            booking.endTime,
            zone,
          )
        : null,
    ),
    ...detail(
      "bookingDate",
      booking?.createdAt ? emailInstant(booking.createdAt, zone, lang) : null,
    ),
    ...detail(
      "purchaseDate",
      purchase?.purchasedAt
        ? emailInstant(purchase.purchasedAt, zone, lang)
        : null,
    ),
  ];
  const summary = [
    ...detail("originalPaid", p.paidAt ? money(p.amount) : null),
    ...detail("refundAmount", money(r.amount)),
    ...detail("refundStatus", r.status),
    ...detail("refundDate", emailInstant(r.refundedAt, zone, lang)),
  ];
  if (p.provider === "STRIPE")
    summary.push(
      ...detail("refundMethod", "STRIPE"),
      ...detail("refundDestination", "ORIGINAL_PAYMENT"),
    );
  if (p.provider === "WALLET") {
    summary.push(...detail("refundMethod", "WALLET"));
    // Actual refund credits, not an assumed paid/bonus split or today's balance.
    // Legacy credits link to the exact refund reference but predate paymentId.
    // Verify all referenced credits rather than guessing from today's balance or
    // ignoring a conflicting payment, customer, currency or balance type.
    const credits = await tx.walletTransaction.findMany({
      where: { referenceId: r.id, type: "REFUND" },
      select: {
        paymentId: true,
        balanceType: true,
        amount: true,
        wallet: { select: { customerId: true, currency: true } },
      },
    });
    if (
      !credits.length ||
      credits.some(
        (credit) =>
          (credit.paymentId !== null && credit.paymentId !== p.id) ||
          credit.wallet.customerId !== p.customerId ||
          credit.wallet.currency !== p.currency ||
          !["PAID", "BONUS"].includes(credit.balanceType) ||
          credit.amount.lte(0),
      ) ||
      !sum(credits).equals(r.amount)
    )
      throw new Error("EMAIL_REFUND_LEDGER_RECONCILIATION_REQUIRED");
    for (const type of ["PAID", "BONUS"] as const) {
      const amount = sum(credits.filter((row) => row.balanceType === type));
      if (amount.gt(0))
        summary.push(
          ...detail(
            type === "PAID" ? "walletPaid" : "walletBonus",
            money(amount),
          ),
        );
    }
  }
  return enqueue(
    tx,
    p.customer,
    "REFUND_COMPLETED",
    id,
    [
      { title: a ? "appointment" : "purchase", rows: original },
      { title: "refund", rows: summary },
    ],
    { kind: "REFUND", id },
    context,
    p.appointmentId ?? undefined,
  );
}
