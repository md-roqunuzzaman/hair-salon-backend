import { Request, Response } from "express";

import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";

import { sendResponse } from "../../utils/sendResponse.js";

import { serviceService } from "./service.service.js";

import { DEFAULT_LANGUAGE, isLanguage } from "../../utils/language.js";

// =====================================================
// CREATE SERVICE
// =====================================================

const createService = catchAsync(async (req: Request, res: Response) => {
  const result = await serviceService.createService(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Service created successfully",
    data: result,
  });
});

// =====================================================
// GET ALL SERVICES
// =====================================================

const getServices = catchAsync(async (req: Request, res: Response) => {
  const requestedLanguage = res.locals.language;

  const language = isLanguage(requestedLanguage)
    ? requestedLanguage
    : DEFAULT_LANGUAGE;

  const result = await serviceService.getServices(req.query, language);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Services fetched successfully",
    data: result,
  });
});

// =====================================================
// GET SINGLE SERVICE
// =====================================================

const getServiceById = catchAsync(async (req: Request, res: Response) => {
  const serviceId = req.params.serviceId as string;

  const requestedLanguage = res.locals.language;

  const language = isLanguage(requestedLanguage)
    ? requestedLanguage
    : DEFAULT_LANGUAGE;

  const result = await serviceService.getServiceById(serviceId, language);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Service fetched successfully",
    data: result,
  });
});

// =====================================================
// UPDATE SERVICE
// =====================================================

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

// =====================================================
// UPDATE SERVICE STATUS
// =====================================================

const updateServiceStatus = catchAsync(async (req: Request, res: Response) => {
  const serviceId = req.params.serviceId as string;

  const result = await serviceService.updateServiceStatus(
    serviceId,
    req.body,
    req.user!.userId,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Service status updated successfully",
    data: result,
  });
});

// =====================================================
// ASSIGN SERVICE TO BRANCHES
// =====================================================

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

// =====================================================
// GET BRANCH SERVICES
// =====================================================

const getBranchServices = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const requestedLanguage = res.locals.language;

  const language = isLanguage(requestedLanguage)
    ? requestedLanguage
    : DEFAULT_LANGUAGE;

  const result = await serviceService.getBranchServices(
    branchId,
    req.query,
    language,
  );

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
