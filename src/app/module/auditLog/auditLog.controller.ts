import { Request, Response } from "express";

import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";

import { auditLogService } from "./auditLog.service.js";

const getAuditLogs = catchAsync(async (req: Request, res: Response) => {
  const result = await auditLogService.getAuditLogs(req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Audit logs fetched successfully",
    data: result,
  });
});

export const auditLogController = {
  getAuditLogs,
};
