import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const VERSION = "v1";

const getEncryptionKey = (): Buffer => {
  const key = process.env.EMAIL_ENCRYPTION_KEY;

  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) {
    throw new Error(
      "EMAIL_ENCRYPTION_KEY must be a 64-character hexadecimal string",
    );
  }

  return Buffer.from(key, "hex");
};

export const encryptEmailCredential = (plaintext: string): string => {
  if (!plaintext.trim()) {
    throw new Error("Email credential cannot be empty");
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
};

export const decryptEmailCredential = (value: string): string => {
  const parts = value.split(":");

  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Invalid encrypted credential format");
  }

  const [, ivText, tagText, encryptedText] = parts;

  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  const encrypted = Buffer.from(encryptedText, "base64url");

  if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) {
    throw new Error("Invalid encrypted credential");
  }

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);

  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
};
