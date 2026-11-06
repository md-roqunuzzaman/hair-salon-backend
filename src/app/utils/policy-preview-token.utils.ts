import { createHmac, timingSafeEqual } from "node:crypto";
import config from "../config/index.js";
import { AppError } from "./app-error.js";

const TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 30 * 1000;
const VERSION = "v1";

type TokenPayload = {
  version: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
};

const sign = (value: unknown, issuedAt: number, expiresAt: number) =>
  createHmac("sha256", config.jwt_access_secret)
    .update(
      JSON.stringify({
        purpose: "POLICY_PREVIEW",
        value,
        issuedAt,
        expiresAt,
      }),
    )
    .digest("hex");

export const createPolicyPreviewToken = (
  value: unknown,
  evaluatedAt: Date,
): string => {
  const issuedAt = evaluatedAt.getTime();

  if (!Number.isSafeInteger(issuedAt)) {
    throw new AppError("POLICY_PREVIEW_INVALID", 409);
  }

  const expiresAt = issuedAt + TTL_MS;

  const payload: TokenPayload = {
    version: VERSION,
    issuedAt,
    expiresAt,
    signature: sign(value, issuedAt, expiresAt),
  };

  return Buffer.from(JSON.stringify(payload)).toString("base64url");
};

export const verifyPolicyPreviewToken = (
  token: string,
  value: unknown,
): void => {
  let payload: TokenPayload;

  try {
    if (
      typeof token !== "string" ||
      token.length > 4096 ||
      !/^[A-Za-z0-9_-]+$/.test(token)
    ) {
      throw new Error("Invalid token");
    }

    const decoded = JSON.parse(
      Buffer.from(token, "base64url").toString("utf8"),
    );

    if (
      !decoded ||
      typeof decoded !== "object" ||
      decoded.version !== VERSION ||
      !Number.isSafeInteger(decoded.issuedAt) ||
      !Number.isSafeInteger(decoded.expiresAt) ||
      decoded.expiresAt - decoded.issuedAt !== TTL_MS ||
      typeof decoded.signature !== "string" ||
      !/^[a-f0-9]{64}$/.test(decoded.signature)
    ) {
      throw new Error("Invalid payload");
    }

    payload = decoded;
  } catch {
    throw new AppError("POLICY_PREVIEW_INVALID", 409);
  }

  const expected = Buffer.from(
    sign(value, payload.issuedAt, payload.expiresAt),
    "hex",
  );

  const received = Buffer.from(payload.signature, "hex");

  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    throw new AppError("POLICY_PREVIEW_STALE", 409);
  }

  const now = Date.now();

  if (payload.issuedAt > now + CLOCK_SKEW_MS) {
    throw new AppError("POLICY_PREVIEW_INVALID", 409);
  }

  if (now >= payload.expiresAt) {
    throw new AppError("POLICY_PREVIEW_EXPIRED", 409);
  }
};
