import { AppError } from "./app-error.js";

export const MAX_BCRYPT_PASSWORD_BYTES = 72;

export const isWithinBcryptPasswordLimit = (password: string): boolean => {
  return new TextEncoder().encode(password).length <= MAX_BCRYPT_PASSWORD_BYTES;
};

export const assertBcryptPasswordLength = (password: string): void => {
  if (typeof password !== "string" || !isWithinBcryptPasswordLimit(password)) {
    throw new AppError("Password must not exceed 72 UTF-8 bytes", 400);
  }
};
