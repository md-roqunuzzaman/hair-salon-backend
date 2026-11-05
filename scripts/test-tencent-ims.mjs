
import "dotenv/config";
import tencentcloud from "tencentcloud-sdk-nodejs";

const secretId = process.env.TENCENT_SECRET_ID?.trim();
const secretKey = process.env.TENCENT_SECRET_KEY?.trim();
const region = process.env.TENCENT_REGION?.trim() || "ap-guangzhou";
const bizType = process.env.TENCENT_IMS_BIZ_TYPE?.trim();

if (!secretId || !secretKey) {
  console.error("Missing Tencent credentials");
  process.exit(1);
}

const ImsClient = tencentcloud.ims.v20201229.Client;

const client = new ImsClient({
  credential: {
    secretId,
    secretKey,
  },
  region,
  profile: {
    httpProfile: {
      endpoint: "ims.tencentcloudapi.com",
      reqTimeout: 15,
    },
  },
});

// Replace with a publicly accessible test image URL.
// For R2, use a valid signed URL.
const imageUrl = process.env.TENCENT_TEST_IMAGE_URL?.trim();

if (!imageUrl) {
  console.error("Missing TENCENT_TEST_IMAGE_URL");
  process.exit(1);
}

const request = {
  FileUrl: imageUrl,
  ...(bizType ? { BizType: bizType } : {}),
};

console.log("IMS TEST CONFIG:", {
  endpoint: "ims.tencentcloudapi.com",
  region,
  bizTypeConfigured: Boolean(bizType),
  imageUrlConfigured: true,
});

try {
  const response = await client.ImageModeration(request);

  console.log("IMS TEST SUCCESS");
  console.log({
    RequestId: response.RequestId,
    BizType: response.BizType,
    Suggestion: response.Suggestion,
    Label: response.Label,
    SubLabel: response.SubLabel,
    Score: response.Score,
  });
} catch (error) {
  console.error("IMS TEST FAILED");
  console.error({
    code: error.code ?? error.Code ?? null,
    message: error.message ?? error.Message ?? String(error),
    requestId:
      error.requestId ??
      error.request_id ??
      error.RequestId ??
      null,
  });
  process.exitCode = 1;
}
