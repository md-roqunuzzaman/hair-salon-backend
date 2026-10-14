import type { Response } from "express";
import config from "../config/index.js";
import { jwtUtils } from "./jwt.js";

export const cookieBaseOptions = {
  httpOnly: true,
  secure: config.node_env === "production",
  sameSite: "lax" as const,
};

export const setAuthCookies = (
  res: Response,
  accessToken: string,
  refreshToken: string,
) => {
  const accessMaxAge = jwtUtils.getRemainingLifetimeSeconds(accessToken) * 1000;
  const refreshMaxAge = jwtUtils.getRemainingLifetimeSeconds(refreshToken) * 1000;
  res.cookie("accessToken", accessToken, {
    ...cookieBaseOptions,
    maxAge: accessMaxAge,
  });
  res.cookie("refreshToken", refreshToken, {
    ...cookieBaseOptions,
    maxAge: refreshMaxAge,
  });
};
