
import "dotenv/config";
import tencentcloud from "tencentcloud-sdk-nodejs";

const secretId = process.env.TENCENT_SECRET_ID?.trim();
const secretKey = process.env.TENCENT_SECRET_KEY?.trim();
const bizType = process.env.TENCENT_MODERATION_BIZ_TYPE?.trim();
const region = process.env.TENCENT_REGION?.trim() || "ap-hongkong";

if (!secretId || !secretKey) {
  console.error("Missing Tencent SecretId or SecretKey");
  process.exitCode = 1;
} else {
  const TmsClient = tencentcloud.tms.v20201229.Client;

  const client = new TmsClient({
    credential: {
      secretId,
      secretKey,
    },
    region,
    profile: {
      httpProfile: {
        endpoint: "tms.tencentcloudapi.com",
        reqTimeout: 15,
      },
    },
  });

  const text = "Hello, this is a safe moderation test.";

  const request = {
    Content: Buffer.from(text, "utf8").toString("base64"),
    Type: "TEXT",
    ...(bizType ? { BizType: bizType } : {}),
  };

  console.log("TMS TEST CONFIG:", {
    endpoint: "tms.tencentcloudapi.com",
    region,
    bizTypeConfigured: Boolean(bizType),
    bizTypeLength: bizType?.length ?? 0,
    credentialsConfigured: true,
  });

  try {
    const response = await client.TextModeration(request);

    console.log("TMS TEST SUCCESS");
    console.log({
      RequestId: response.RequestId,
      BizType: response.BizType,
      Suggestion: response.Suggestion,
      Label: response.Label,
      SubLabel: response.SubLabel,
      Score: response.Score,
    });
  } catch (error) {
    console.error("TMS TEST FAILED");

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
}
