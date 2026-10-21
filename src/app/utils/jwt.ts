import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";

const createToken = (
  payload: JwtPayload,
  secret: string,
  expiresIn: SignOptions["expiresIn"],
) => {
  const token = jwt.sign(payload, secret, {
    expiresIn,
  });

  return token;
};

const verifyToken = (token: string, secret: string) => {
  try {
    const verifiedToken = jwt.verify(token, secret);

    return {
      success: true,
      data: verifiedToken,
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof jwt.TokenExpiredError
        ? "Your session has expired. Please log in again"
        : "Authentication token is invalid. Please log in again",
    };
  }
};

// For tokens issued by this server; decoding is not an authentication check.
const getRemainingLifetimeSeconds = (token: string) => {
  const payload = jwt.decode(token);
  if (!payload || typeof payload === "string" ||
      typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    throw new Error("Token must have a valid expiry");
  }

  const remaining = payload.exp - Math.floor(Date.now() / 1000);
  if (remaining <= 0) {
    throw new Error("Token has already expired");
  }
  return remaining;
};

export const jwtUtils = {
  createToken,
  verifyToken,
  getRemainingLifetimeSeconds,
};
