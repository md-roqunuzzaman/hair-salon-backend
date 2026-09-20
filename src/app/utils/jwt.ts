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
      error: error instanceof Error ? error.message : "Invalid token",
    };
  }
};

export const jwtUtils = {
  createToken,
  verifyToken,
};
