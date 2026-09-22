import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Application, Request, Response } from "express";
import httpStatus from "http-status";
import config from "./app/config/index.js";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler.js";
import { notFound } from "./app/middleware/notFound.js";
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

const app: Application = express();

app.use(
  cors({
    origin: config.frontend_url,
    credentials: true,
  }),
);

// Enable URL-encoded form data parsing
app.use(express.urlencoded({ extended: true }));

// Middleware to parse JSON bodies
app.use(express.json());
app.use(cookieParser());

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", UserRoutes);
app.use("/api/v1/brand", BrandRoutes);
app.use("/api/v1/branches", BranchRoutes);
app.use("/api/v1/services", ServiceRoutes);
app.use("/api/v1/packages", PackageRoutes);
app.use("/api/v1/group-purchases", GroupPurchaseRoutes);
app.use("/api/v1/staff", StaffRoutes);
app.use("/api/v1/availability", AvailabilityRoutes);
app.use("/api/v1/appointments", AppointmentRoutes);
// Basic route
app.get("/", async (req: Request, res: Response) => {
  res.status(httpStatus.OK).json({
    success: true,
    message: "Welcome hair salon booking System Backend",
  });
});

app.use(globalErrorHandler);
app.use(notFound);

export default app;
