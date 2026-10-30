import type { Request } from "express";

export const registrationClientIp = (req: Request): string | undefined => req.ip;
