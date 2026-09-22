import { Request, Response } from "express";
import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { appointmentService } from "./appointment.service.js";
import { AppError } from "../../utils/app-error.js";

const createPayNowAppointment = catchAsync(
  async (req: Request, res: Response) => {
    const customerId = req.user!.userId;

    const result = await appointmentService.createPayNowAppointment(
      customerId,
      req.body,
    );

    sendResponse(res, {
      statusCode: httpStatus.CREATED,
      success: true,
      message: "Pay now appointment created successfully",
      data: result,
    });
  },
);

const createReserveAppointment = catchAsync(
  async (req: Request, res: Response) => {
    const customerId = req.user!.userId;

    const result = await appointmentService.createReserveAppointment(
      customerId,
      req.body,
    );

    sendResponse(res, {
      statusCode: httpStatus.CREATED,
      success: true,
      message: "Reservation created successfully",
      data: result,
    });
  },
);

const getMyAppointments = catchAsync(async (req: Request, res: Response) => {
  const customerId = req.user!.userId;

  const result = await appointmentService.getMyAppointments(
    customerId,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointments fetched successfully",
    data: result,
  });
});

const getAppointmentById = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const role = req.user!.role;

  const appointmentId = req.params.appointmentId;

  if (Array.isArray(appointmentId)) {
    throw new AppError("Invalid appointmentId", 400);
  }

  const result = await appointmentService.getAppointmentById(
    appointmentId,
    userId,
    role,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointment fetched successfully",
    data: result,
  });
});

const cancelAppointment = catchAsync(async (req: Request, res: Response) => {
  const appointmentId = req.params.appointmentId;

  if (Array.isArray(appointmentId)) {
    throw new AppError("Invalid appointmentId", 400);
  }

  const userId = req.user!.userId;
  const role = req.user!.role;

  const result = await appointmentService.cancelAppointment(
    appointmentId,
    userId,
    role,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointment cancelled successfully",
    data: result,
  });
});

const rescheduleAppointment = catchAsync(
  async (req: Request, res: Response) => {
    const appointmentId = req.params.appointmentId;

    if (Array.isArray(appointmentId)) {
      throw new AppError("Invalid appointmentId", 400);
    }

    const customerId = req.user!.userId;

    const result = await appointmentService.rescheduleAppointment(
      appointmentId,
      customerId,
      req.body,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Appointment rescheduled successfully",
      data: result,
    });
  },
);

const getAppointmentQr = catchAsync(async (req: Request, res: Response) => {
  const appointmentId = req.params.appointmentId;

  if (Array.isArray(appointmentId)) {
    throw new AppError("Invalid appointmentId", 400);
  }

  const customerId = req.user!.userId;

  const result = await appointmentService.getAppointmentQr(
    appointmentId,
    customerId,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointment QR fetched successfully",
    data: result,
  });
});

export const appointmentController = {
  createPayNowAppointment,
  createReserveAppointment,
  getMyAppointments,
  getAppointmentById,
  cancelAppointment,
  rescheduleAppointment,
  getAppointmentQr,
};
