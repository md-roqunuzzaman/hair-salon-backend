import * as tencentcloud from "tencentcloud-sdk-nodejs";
import config from "../../config/index.js";

// =====================================================
// 1. MODERATION RESULT INTERFACE
// =====================================================

export type ModerationDecision = "PASS" | "REVIEW" | "REJECT";

export interface IModerationResult {
  safe: boolean;
  flagged: boolean;
  reason: string | null;
  categories: string[];

  // Backward-compatible addition.
  decision?: ModerationDecision;
}

// =====================================================
// 2. TENCENT CLIENT CONFIGURATION
// =====================================================

const getTencentCredentials = () => {
  const secretId = config.tencent.secretId?.trim();
  const secretKey = config.tencent.secretKey?.trim();

  if (!secretId || !secretKey) {
    throw new Error("TENCENT_MODERATION_CREDENTIALS_MISSING");
  }

  return { secretId, secretKey };
};

const createTencentClientConfig = (endpoint: string) => ({
  credential: getTencentCredentials(),
  region: config.tencent.region || "ap-guangzhou",
  profile: {
    httpProfile: {
      endpoint,
      reqTimeout: 10,
    },
  },
});

const getTextClient = () => {
  return new tencentcloud.tms.v20201229.Client(
    createTencentClientConfig("tms.tencentcloudapi.com"),
  );
};

const getImageClient = () => {
  return new tencentcloud.ims.v20201229.Client(
    createTencentClientConfig("ims.tencentcloudapi.com"),
  );
};

// =====================================================
// 3. SAFE EMPTY RESULT
// =====================================================

const emptyResult = (): IModerationResult => ({
  safe: true,
  flagged: false,
  reason: null,
  categories: [],
  decision: "PASS",
});

// =====================================================
// 4. VALIDATE TENCENT MODERATION RESPONSE
// =====================================================

const extractModerationResult = (response: unknown): IModerationResult => {
  if (
    typeof response !== "object" ||
    response === null ||
    Array.isArray(response)
  ) {
    throw new Error("MODERATION_RESPONSE_INVALID");
  }

  const data = response as Record<string, unknown>;

  if (
    data.Suggestion !== "Pass" &&
    data.Suggestion !== "Review" &&
    data.Suggestion !== "Block"
  ) {
    throw new Error("MODERATION_RESPONSE_INVALID");
  }

  const decision: ModerationDecision =
    data.Suggestion === "Pass"
      ? "PASS"
      : data.Suggestion === "Review"
        ? "REVIEW"
        : "REJECT";

  const categories: string[] = [];

  if (typeof data.Label === "string") {
    const label = data.Label.trim();

    if (label && label.toLowerCase() !== "normal") {
      categories.push(label);
    }
  }

  if (typeof data.SubLabel === "string") {
    const subLabel = data.SubLabel.trim();

    if (
      subLabel &&
      subLabel.toLowerCase() !== "normal" &&
      !categories.includes(subLabel)
    ) {
      categories.push(subLabel);
    }
  }

  const safe = decision === "PASS";

  return {
    safe,
    flagged: !safe,
    reason: safe
      ? null
      : categories.length > 0
        ? categories.join(", ")
        : `Tencent moderation: ${data.Suggestion}`,
    categories,
    decision,
  };
};

// =====================================================
// 5. COMBINE TEXT + IMAGE MODERATION RESULTS
// =====================================================

const combineModerationResults = (
  results: IModerationResult[],
): IModerationResult => {
  if (results.length === 0) {
    return emptyResult();
  }

  const decisions = results.map((result) => {
    if (result.decision) {
      return result.decision;
    }

    // Conservative fallback for legacy results.
    return result.safe && !result.flagged ? "PASS" : "REJECT";
  });

  // Priority: REJECT > REVIEW > PASS.
  const decision: ModerationDecision = decisions.includes("REJECT")
    ? "REJECT"
    : decisions.includes("REVIEW")
      ? "REVIEW"
      : "PASS";

  const categories = [
    ...new Set(results.flatMap((result) => result.categories)),
  ];

  const reasons = [
    ...new Set(
      results
        .map((result) => result.reason)
        .filter((reason): reason is string => Boolean(reason)),
    ),
  ];

  const safe = decision === "PASS";

  return {
    safe,
    flagged: !safe,
    reason: safe
      ? null
      : reasons.length > 0
        ? reasons.join("; ")
        : `Tencent moderation: ${decision}`,
    categories,
    decision,
  };
};

// =====================================================
// 6. TEXT MODERATION - TENCENT TMS
// =====================================================

const moderateText = async (
  text?: string | null,
): Promise<IModerationResult> => {
  // Rating-only review is allowed.
  if (!text?.trim()) {
    return emptyResult();
  }

  const content = text.trim();

  const request = {
    Content: Buffer.from(content, "utf8").toString("base64"),
    Type: "TEXT",
    ...(config.tencent.moderationBizType
      ? { BizType: config.tencent.moderationBizType }
      : {}),
  };

  // API errors must propagate to the caller.
  // Never treat an API failure as safe.
  const response = await getTextClient().TextModeration(request);

  return extractModerationResult(response);
};

// =====================================================
// 7. IMAGE MODERATION - TENCENT IMS
// =====================================================

const moderateImage = async (imageUrl: string): Promise<IModerationResult> => {
  // =====================================================
  // 7.1 VALIDATE IMAGE URL
  // =====================================================

  if (!imageUrl?.trim()) {
    throw new Error("IMAGE_URL_REQUIRED");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(imageUrl.trim());
  } catch {
    throw new Error("IMAGE_URL_INVALID");
  }

  if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname) {
    throw new Error("IMAGE_URL_INVALID");
  }

  // IMPORTANT:
  // This URL must originate from our trusted
  // Cloudflare R2 signed URL generator.
  // Do not expose this function to arbitrary
  // user-provided URLs.

  // =====================================================
  // 7.2 MODERATE IMAGE
  // =====================================================

  const request = {
    FileUrl: parsedUrl.toString(),
    ...(config.tencent.imageBizType
      ? { BizType: config.tencent.imageBizType }
      : {}),
  };

  const response = await getImageClient().ImageModeration(request);

  // =====================================================
  // 7.3 VALIDATE AND RETURN RESULT
  // =====================================================

  return extractModerationResult(response);
};

// =====================================================
// 8. REVIEW CONTENT MODERATION
// Text + multiple images
// =====================================================

const moderateReviewContent = async (
  text: string | null | undefined,
  imageUrls: string[],
): Promise<IModerationResult> => {
  const results: IModerationResult[] = [];

  // =====================================================
  // 8.1 HANDLE RATING-ONLY REVIEW
  // =====================================================

  if (!text?.trim() && imageUrls.length === 0) {
    return emptyResult();
  }

  // =====================================================
  // 8.2 MODERATE TEXT
  // =====================================================

  if (text?.trim()) {
    const textResult = await moderateText(text);
    results.push(textResult);
  }

  // =====================================================
  // 8.3 MODERATE EVERY IMAGE
  // =====================================================

  // Sequential requests avoid uncontrolled API bursts.
  // Do not stop at the first flagged image:
  // every image must receive a moderation result.
  for (const imageUrl of imageUrls) {
    const imageResult = await moderateImage(imageUrl);
    results.push(imageResult);
  }

  // =====================================================
  // 8.4 COMBINE RESULTS
  // =====================================================

  // Any failed request throws before this point.
  // REJECT takes priority over REVIEW and PASS.

  return combineModerationResults(results);
};

// =====================================================
// 9. EXPORT SERVICE
// =====================================================

export const contentModerationService = {
  moderateText,
  moderateImage,
  moderateReviewContent,
};
