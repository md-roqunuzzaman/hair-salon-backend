import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync.js";
import { authService } from "./auth.service.js";
import { sendResponse } from "../../utils/sendResponse.js";
import config from "../../config/index.js";
import { AppError } from "../../utils/app-error.js";

const cookieBaseOptions = {
  httpOnly: true,
  secure: config.node_env === "production",
  sameSite: "lax" as const,
};

const setAuthCookies = (
  res: Response,
  accessToken: string,
  refreshToken: string,
) => {
  res.cookie("accessToken", accessToken, {
    ...cookieBaseOptions,
    maxAge: 1000 * 60 * 15,
  });
  res.cookie("refreshToken", refreshToken, {
    ...cookieBaseOptions,
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });
};

const registerUser = catchAsync(async (req: Request, res: Response) => {
  const result = await authService.registerUser(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "User registered successfully",
    data: result,
  });
});

const loginUser = catchAsync(async (req: Request, res: Response) => {
  const result = await authService.loginUser(req.body);

  const { accessToken, refreshToken } = result;

  setAuthCookies(res, accessToken, refreshToken);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User logged in successfully",
    data: {
      user: result.user,
      accessToken,
      refreshToken,
    },
  });
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
  const token = req.body?.refreshToken || req.cookies?.refreshToken;

  if (!token) {
    throw new AppError("Refresh token is required", 401);
  }

  const result = await authService.refreshToken(token);

  const { accessToken, refreshToken: newRefreshToken } = result;

  setAuthCookies(res, accessToken, newRefreshToken);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "New tokens generated successfully",
    data: {
      accessToken,
      refreshToken: newRefreshToken,
    },
  });
});

const logoutUser = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.userId;

  const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

  if (!userId) {
    throw new AppError("User information is missing", 401);
  }

  if (!refreshToken) {
    throw new AppError("Refresh token is required", 401);
  }

  await authService.logoutUser(userId, refreshToken);

  res.clearCookie("accessToken", {
    ...cookieBaseOptions,
  });

  res.clearCookie("refreshToken", {
    ...cookieBaseOptions,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Logged out successfully",
    data: null,
  });
});

const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  await authService.forgotPassword(req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password reset OTP sent to your email",
    data: null,
  });
});

const verifyResetOtp = catchAsync(async (req: Request, res: Response) => {
  const result = await authService.verifyResetOtp(req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "OTP verified successfully",
    data: result,
  });
});

const resetPassword = catchAsync(async (req: Request, res: Response) => {
  await authService.resetPassword(req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password reset successfully",
    data: null,
  });
});
export const authController = {
  registerUser,
  loginUser,
  refreshToken,
  logoutUser,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
};
