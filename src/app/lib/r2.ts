import { S3Client } from "@aws-sdk/client-s3";
import config from "../config/index.js";

if (
  !config.r2.accountId ||
  !config.r2.accessKeyId ||
  !config.r2.secretAccessKey
) {
  throw new Error("R2 configuration is missing");
}

export const r2Client = new S3Client({
  region: "auto",

  endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,

  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
});
