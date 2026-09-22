import { Request, Response } from "express";

import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";

import { sendResponse } from "../../utils/sendResponse.js";

import { staffService } from "./staff.service.js";

const createStaff = catchAsync(async (req: Request, res: Response) => {
  const result = await staffService.createStaff(req.body, {
    userId: req.user!.userId,
    role: req.user!.role,
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Staff created successfully",
    data: result,
  });
});

const getStaff = catchAsync(async (req: Request, res: Response) => {
  const result = await staffService.getStaff(req.query, {
    userId: req.user!.userId,
    role: req.user!.role,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Staff fetched successfully",
    data: result,
  });
});

const getStaffById = catchAsync(async (req: Request, res: Response) => {
  const staffId = req.params.staffId as string;

  const result = await staffService.getStaffById(staffId, {
    userId: req.user!.userId,
    role: req.user!.role,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Staff fetched successfully",
    data: result,
  });
});

const updateStaff = catchAsync(async (req: Request, res: Response) => {
  const staffId = req.params.staffId as string;

  const result = await staffService.updateStaff(staffId, req.body, {
    userId: req.user!.userId,
    role: req.user!.role,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Staff updated successfully",
    data: result,
  });
});
const updateStaffStatus = catchAsync(async (req: Request, res: Response) => {
  const staffId = req.params.staffId as string;

  const result = await staffService.updateStaffStatus(staffId, req.body, {
    userId: req.user!.userId,
    role: req.user!.role,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Staff status updated successfully",
    data: result,
  });
});

const assignStaffBranches = catchAsync(async (req: Request, res: Response) => {
  const staffId = req.params.staffId as string;

  const result = await staffService.assignStaffBranches(staffId, req.body, {
    userId: req.user!.userId,
    role: req.user!.role,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Staff branches updated successfully",
    data: result,
  });
});

const assignStaffServices = catchAsync(async (req: Request, res: Response) => {
  const staffId = req.params.staffId as string;

  const result = await staffService.assignStaffServices(staffId, req.body, {
    userId: req.user!.userId,
    role: req.user!.role,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Staff services updated successfully",
    data: result,
  });
});

const assignStaffPackages = catchAsync(async (req: Request, res: Response) => {
  const staffId = req.params.staffId as string;

  const result = await staffService.assignStaffPackages(staffId, req.body, {
    userId: req.user!.userId,
    role: req.user!.role,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Staff packages updated successfully",
    data: result,
  });
});

const getBranchStaff = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const result = await staffService.getBranchStaff(branchId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Branch staff fetched successfully",
    data: result,
  });
});

const getEligibleStaffForService = catchAsync(
  async (req: Request, res: Response) => {
    const branchId = req.params.branchId as string;
    const serviceId = req.params.serviceId as string;

    const result = await staffService.getEligibleStaffForService(
      branchId,
      serviceId,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Eligible staff fetched successfully",
      data: result,
    });
  },
);

const getEligibleStaffForPackage = catchAsync(
  async (req: Request, res: Response) => {
    const branchId = req.params.branchId as string;
    const packageId = req.params.packageId as string;

    const result = await staffService.getEligibleStaffForPackage(
      branchId,
      packageId,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Eligible staff for package fetched successfully",
      data: result,
    });
  },
);

const updateStaffSchedule = catchAsync(async (req: Request, res: Response) => {
  const staffId = req.params.staffId as string;

  const result = await staffService.updateStaffSchedule(staffId, req.body, {
    userId: req.user!.userId,
    role: req.user!.role,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Schedule updated successfully",
    data: result,
  });
});

const getStaffSchedule = catchAsync(async (req: Request, res: Response) => {
  const staffId = req.params.staffId as string;

  const result = await staffService.getStaffSchedule(staffId, {
    userId: req.user!.userId,
    role: req.user!.role,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Staff schedule fetched successfully",
    data: result,
  });
});

const createStaffUnavailability = catchAsync(
  async (req: Request, res: Response) => {
    const staffId = req.params.staffId as string;

    const result = await staffService.createStaffUnavailability(
      staffId,
      req.body,
      {
        userId: req.user!.userId,
        role: req.user!.role,
      },
    );

    sendResponse(res, {
      statusCode: httpStatus.CREATED,
      success: true,
      message: "Staff unavailability created successfully",
      data: result,
    });
  },
);

const getStaffUnavailability = catchAsync(
  async (req: Request, res: Response) => {
    const staffId = req.params.staffId as string;

    const from = req.query.from as string | undefined;

    const to = req.query.to as string | undefined;

    const result = await staffService.getStaffUnavailability(
      staffId,
      {
        from,
        to,
      },
      {
        userId: req.user!.userId,
        role: req.user!.role,
      },
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Staff unavailability fetched successfully",
      data: result,
    });
  },
);

const updateStaffUnavailability = catchAsync(
  async (req: Request, res: Response) => {
    const staffId = req.params.staffId as string;

    const unavailabilityId = req.params.id as string;

    const result = await staffService.updateStaffUnavailability(
      staffId,
      unavailabilityId,
      req.body,
      {
        userId: req.user!.userId,
        role: req.user!.role,
      },
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Staff unavailability updated successfully",
      data: result,
    });
  },
);

const deleteStaffUnavailability = catchAsync(
  async (req: Request, res: Response) => {
    const staffId = req.params.staffId as string;
    const unavailabilityId = req.params.id as string;

    const result = await staffService.deleteStaffUnavailability(
      staffId,
      unavailabilityId,
      {
        userId: req.user!.userId,
        role: req.user!.role,
      },
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Unavailability removed successfully",
      data: result,
    });
  },
);

const getMyStaffSchedule = catchAsync(async (req: Request, res: Response) => {
  /*
   * userId comes from the authenticated JWT.
   * Frontend does NOT need to send staffId.
   */
  const userId = req.user!.userId;

  const result = await staffService.getMyStaffSchedule(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "My staff schedule fetched successfully",
    data: result,
  });
});

export const staffController = {
  createStaff,
  getStaff,
  getStaffById,
  updateStaff,
  updateStaffStatus,
  assignStaffBranches,
  assignStaffServices,
  assignStaffPackages,
  getBranchStaff,
  getEligibleStaffForService,
  getEligibleStaffForPackage,
  updateStaffSchedule,
  getStaffSchedule,
  createStaffUnavailability,
  getStaffUnavailability,
  updateStaffUnavailability,
  deleteStaffUnavailability,
  getMyStaffSchedule,
};
