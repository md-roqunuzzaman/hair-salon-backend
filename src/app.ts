import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Application, Request, Response } from "express";
import helmet from "helmet";
import httpStatus from "http-status";

import config from "./app/config/index.js";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler.js";
import { notFound } from "./app/middleware/notFound.js";
import { languageMiddleware } from "./app/middleware/language.middleware.js";

import { authRoutes } from "./app/module/auth/auth.route.js";
import { UserRoutes } from "./app/module/user/user.route.js";
import { BrandRoutes } from "./app/module/brand/brand.route.js";
import { BranchRoutes } from "./app/module/branch/branch.route.js";
import { ServiceRoutes } from "./app/module/service/service.route.js";
import { PackageRoutes } from "./app/module/package/package.route.js";
import { GroupPurchaseRoutes } from "./app/module/group-purchase/group-purchase.route.js";
import { StaffRoutes } from "./app/module/staff/staff.route.js";
import { AvailabilityRoutes } from "./app/module/availability/availability.route.js";
import { AppointmentRoutes } from "./app/module/appointment/appointment.route.js";
import { PaymentRoutes } from "./app/module/payment/payment.route.js";
import { paymentController } from "./app/module/payment/payment.controller.js";
import { WalletRoutes } from "./app/module/wallet/wallet.route.js";
import { PromotionRoutes } from "./app/module/promotion/promotion.route.js";
import { ReviewRoutes } from "./app/module/review/review.route.js";
import { NotificationRoutes } from "./app/module/notification/notification.route.js";
import { BranchManagerRoutes } from "./app/module/branch-manager/branch-manager.route.js";
import { AdminUserRoutes } from "./app/module/admin/admin.route.js";
import { DashboardRoutes } from "./app/module/dashboard/dashboard.route.js";
import { ReportRoutes } from "./app/module/report/report.route.js";
import { AuditLogRoutes } from "./app/module/auditLog/auditLog.route.js";
import { UploadRoutes } from "./app/module/upload/upload.route.js";
import { BranchHourlyCapacityRoutes } from "./app/module/branch-hourly-capacity/branch-hourly-capacity.route.js";
import { RefundRequestRoutes } from "./app/module/refund-request/refund-request.route.js";
import { PolicyManagementRoutes } from "./app/module/cancellation-refund/policy-management.route.js";
import { CancellationRefundRoutes } from "./app/module/cancellation-refund/cancellation-refund.route.js";
import { BannerRoutes } from "./app/module/banner/banner.router.js";
import { staffPortfolioRoutes } from "./app/module/staff-portfolio/staff-portfolio.route.js";
import { BrandEmailSettingRoutes } from "./app/module/brand-email-setting/brand-email-setting.route.js";

// =====================================================
// 1. CREATE EXPRESS APPLICATION
// =====================================================

const app: Application = express();

// =====================================================
// 2. S8 SECURITY FIX: HTTP SECURITY HEADERS
// =====================================================

// Prevent Express framework identification.
app.disable("x-powered-by");

// Apply security headers before API routes.
//
// CSP is disabled because this application primarily
// serves a JSON API rather than HTML pages.
//
// CORP is disabled to preserve existing cross-origin
// resource behavior. Review these settings if the API
// later serves browser-rendered HTML or sensitive media.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
  }),
);

// =====================================================
// 3. CORS CONFIGURATION
// =====================================================

app.use(
  cors({
    origin: config.frontend_url,
    credentials: true,
  }),
);

// =====================================================
// 4. STRIPE WEBHOOK
//
// IMPORTANT:
// Stripe webhook must be registered before express.json()
// to preserve the raw request body for signature verification.
// =====================================================

app.post(
  "/api/v1/payments/stripe/webhook",
  express.raw({
    type: "application/json",
  }),
  paymentController.stripeWebhook,
);

// =====================================================
// 5. BODY PARSERS
// =====================================================

app.use(
  express.urlencoded({
    extended: true,
  }),
);

app.use(express.json());

// =====================================================
// 6. COMMON MIDDLEWARE
// =====================================================

app.use(cookieParser());

app.use(languageMiddleware);

// =====================================================
// 7. S7 SECURITY FIX: SAFE REQUEST LOGGING
//
// Log only the request method and pathname.
//
// Do not log:
// - OAuth authorization codes
// - OAuth state parameters
// - Access tokens
// - Refresh tokens
// - Authorization headers
// - Cookies
// - Request bodies
// - Full request URLs
// =====================================================

app.use((req, res, next) => {
  console.log("========== INCOMING REQUEST ==========");
  console.log("METHOD:", req.method);
  console.log("PATH:", req.path);
  console.log("TIME:", new Date().toISOString());
  console.log("======================================");

  next();
});

// =====================================================
// 8. AUTHENTICATION & USER ROUTES
// =====================================================

app.use("/api/v1/auth", authRoutes);

app.use("/api/v1/users", UserRoutes);

// =====================================================
// 9. BRAND & BRANCH ROUTES
// =====================================================

app.use("/api/v1/brand", BrandRoutes);

app.use("/api/v1/branches", BranchRoutes);

app.use("/api/v1/branches", BranchHourlyCapacityRoutes);

// =====================================================
// 10. SERVICE & PACKAGE ROUTES
// =====================================================

app.use("/api/v1/services", ServiceRoutes);

app.use("/api/v1/packages", PackageRoutes);

app.use("/api/v1/group-purchases", GroupPurchaseRoutes);

// =====================================================
// 11. STAFF & APPOINTMENT ROUTES
// =====================================================

app.use("/api/v1/staff", StaffRoutes);

app.use("/api/v1/availability", AvailabilityRoutes);

app.use("/api/v1/appointments", AppointmentRoutes);

// =====================================================
// 12. PAYMENT & WALLET ROUTES
// =====================================================

app.use("/api/v1/payments", PaymentRoutes);

app.use("/api/v1/wallet", WalletRoutes);

app.use("/api/v1/promotions", PromotionRoutes);

// =====================================================
// 13. REVIEW & NOTIFICATION ROUTES
// =====================================================

app.use("/api/v1/reviews", ReviewRoutes);

app.use("/api/v1/notifications", NotificationRoutes);

// =====================================================
// 14. MANAGEMENT ROUTES
// =====================================================

app.use("/api/v1/branch-managers", BranchManagerRoutes);

app.use("/api/v1/admin/users", AdminUserRoutes);

app.use("/api/v1/dashboard", DashboardRoutes);

app.use("/api/v1/reports", ReportRoutes);

app.use("/api/v1/audit-logs", AuditLogRoutes);

// =====================================================
// 15. UPLOAD, BANNER & PORTFOLIO ROUTES
// =====================================================

app.use("/api/v1/uploads", UploadRoutes);

app.use("/api/v1/banners", BannerRoutes);

app.use("/api/v1/staff", staffPortfolioRoutes);

// =====================================================
// 16. REFUND & POLICY ROUTES
// =====================================================

app.use("/api/v1/refund-requests", RefundRequestRoutes);

app.use("/api/v1/policy-management", PolicyManagementRoutes);

app.use("/api/v1/cancellation-refund", CancellationRefundRoutes);

// =====================================================
// 17. BRAND EMAIL SETTINGS
// =====================================================

app.use("/api/v1/brand-email-settings", BrandEmailSettingRoutes);

// =====================================================
// 18. ROOT ROUTE
// =====================================================

app.get("/", async (req: Request, res: Response) => {
  res.status(httpStatus.OK).json({
    success: true,
    message: "Welcome hair salon booking System Backend",
  });
});

// =====================================================
// 19. NOT FOUND HANDLER
// =====================================================

app.use(notFound);

// =====================================================
// 20. GLOBAL ERROR HANDLER
// =====================================================

app.use(globalErrorHandler);

// =====================================================
// 21. EXPORT APPLICATION
// =====================================================

export default app;
