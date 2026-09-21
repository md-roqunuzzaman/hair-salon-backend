import { Request, Response } from "express";

import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";

import { sendResponse } from "../../utils/sendResponse.js";

import { serviceService } from "./service.service.js";

const createService = catchAsync(async (req: Request, res: Response) => {
  const result = await serviceService.createService(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Service created successfully",
    data: result,
  });
});

const getServices = catchAsync(async (req: Request, res: Response) => {
  const result = await serviceService.getServices(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Services fetched successfully",
    data: result,
  });
});

const getServiceById = catchAsync(async (req: Request, res: Response) => {
  const serviceId = req.params.serviceId as string;

  const result = await serviceService.getServiceById(serviceId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Service fetched successfully",
    data: result,
  });
});

const updateService = catchAsync(async (req: Request, res: Response) => {
  const serviceId = req.params.serviceId as string;

  const result = await serviceService.updateService(serviceId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Service updated successfully",
    data: result,
  });
});

const updateServiceStatus = catchAsync(async (req: Request, res: Response) => {
  const serviceId = req.params.serviceId as string;

  const result = await serviceService.updateServiceStatus(serviceId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Service status updated successfully",
    data: result,
  });
});

const assignServiceToBranches = catchAsync(
  async (req: Request, res: Response) => {
    const serviceId = req.params.serviceId as string;

    const result = await serviceService.assignServiceToBranches(
      serviceId,
      req.body,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Service branches updated successfully",
      data: result,
    });
  },
);

const getBranchServices = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const result = await serviceService.getBranchServices(branchId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Branch services fetched successfully",
    data: result,
  });
});

export const serviceController = {
  createService,
  getServices,
  getServiceById,
  updateService,
  updateServiceStatus,
  assignServiceToBranches,
  getBranchServices,
};
