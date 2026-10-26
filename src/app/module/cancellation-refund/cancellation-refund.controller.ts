import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { getPolicy, savePolicy } from "./policy-management.service.js";
import { PolicyModule } from "./policy.calculation.js";
import {
  cancelWithPolicy,
  previewAppointment,
  previewGroupRefund,
  requestGroupRefund,
} from "./cancellation-refund.service.js";
import { groupPurchaseService } from "../group-purchase/group-purchase.service.js";
import { groupPurchaseValidation } from "../group-purchase/group-purchase.validation.js";
const id = (req: Request, key: string) => z.uuid().parse(req.params[key]);
const result = (res: Response, data: unknown) =>
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Cancellation/refund operation completed",
    data,
  });
const read = (module: PolicyModule, admin: boolean) =>
  catchAsync(async (req: Request, res: Response) =>
    result(
      res,
      await getPolicy(
        id(req, "branchId"),
        module,
        admin ? req.user!.userId : undefined,
        admin ? req.user!.role : undefined,
      ),
    ),
  );
const update = (module: PolicyModule) =>
  catchAsync(async (req: Request, res: Response) =>
    result(
      res,
      await savePolicy(
        id(req, "branchId"),
        module,
        req.body,
        req.user!.userId,
        req.user!.role,
      ),
    ),
  );
export const cancellationRefundController = {
  getService: read("SERVICE", true),
  putService: update("SERVICE"),
  getGroupRefund: read("GROUP_REFUND", true),
  putGroupRefund: update("GROUP_REFUND"),
  getGroupCancellation: read("GROUP_CANCEL", true),
  putGroupCancellation: update("GROUP_CANCEL"),
  displayService: read("SERVICE", false),
  displayGroupRefund: read("GROUP_REFUND", false),
  displayGroupCancellation: read("GROUP_CANCEL", false),
  appointmentPreview: catchAsync(async (req: Request, res: Response) =>
    result(
      res,
      await previewAppointment(id(req, "appointmentId"), req.user!.userId),
    ),
  ),
  groupPreview: catchAsync(async (req: Request, res: Response) =>
    result(
      res,
      await previewGroupRefund(id(req, "groupPurchaseId"), req.user!.userId),
    ),
  ),
  cancelAppointment: catchAsync(async (req: Request, res: Response) =>
    result(
      res,
      await cancelWithPolicy(
        id(req, "appointmentId"),
        req.user!.userId,
        req.user!.role,
        req.body,
      ),
    ),
  ),
  requestGroupRefund: catchAsync(async (req: Request, res: Response) =>
    result(
      res,
      await requestGroupRefund(
        id(req, "groupPurchaseId"),
        req.user!.userId,
        req.body,
      ),
    ),
  ),
  checkout: catchAsync(async (req: Request, res: Response) => {
    const parsed =
      groupPurchaseValidation.createGroupPurchaseValidationSchema.parse({
        body: req.body,
      }).body;
    z.uuid().parse(parsed.branchId);
    return result(
      res,
      await groupPurchaseService.createGroupPurchase(req.user!.userId, parsed),
    );
  }),
};
