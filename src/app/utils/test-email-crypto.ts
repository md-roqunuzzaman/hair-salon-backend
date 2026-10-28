import "dotenv/config";

import {
  encryptEmailCredential,
  decryptEmailCredential,
} from "./email-credential-crypto.js";

const original = "test-password-123";

const encrypted = encryptEmailCredential(original);
const decrypted = decryptEmailCredential(encrypted);

if (decrypted !== original || encrypted === original) {
  throw new Error("Encryption test failed");
}

console.log("Email credential encryption test PASSED");
