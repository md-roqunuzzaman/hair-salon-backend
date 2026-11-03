import OpenAI from "openai";

// =====================================================
// 1. OPENAI CLIENT CONFIGURATION
// =====================================================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,

  // Timeout per API attempt: 8 seconds.
  timeout: 8000,

  // Initial attempt + 1 retry = maximum 2 attempts.
  maxRetries: 1,
});

// =====================================================
// 2. MODERATION RESULT INTERFACE
// =====================================================

export interface IModerationResult {
  safe: boolean;
  flagged: boolean;
  reason: string | null;
  categories: string[];
}

// =====================================================
// 3. VALIDATE INDIVIDUAL MODERATION RESULT
// =====================================================

const extractModerationResult = (result: unknown): IModerationResult => {
  // =====================================================
  // 3.1 VALIDATE RESPONSE STRUCTURE
  // =====================================================

  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new Error("MODERATION_RESPONSE_INVALID");
  }

  const moderation = result as Record<string, unknown>;

  // =====================================================
  // 3.2 VALIDATE FLAGGED FIELD
  // =====================================================

  if (typeof moderation.flagged !== "boolean") {
    throw new Error("MODERATION_RESPONSE_INVALID");
  }

  // =====================================================
  // 3.3 VALIDATE CATEGORIES
  // =====================================================

  const categories = moderation.categories;

  if (
    typeof categories !== "object" ||
    categories === null ||
    Array.isArray(categories)
  ) {
    throw new Error("MODERATION_RESPONSE_INVALID");
  }

  const categoryEntries = Object.entries(categories);

  if (
    categoryEntries.length === 0 ||
    categoryEntries.some(([, flagged]) => typeof flagged !== "boolean")
  ) {
    throw new Error("MODERATION_RESPONSE_INVALID");
  }

  // =====================================================
  // 3.4 EXTRACT FLAGGED CATEGORIES
  // =====================================================

  const flaggedCategories = categoryEntries
    .filter(([, flagged]) => flagged === true)
    .map(([category]) => category);

  if (!moderation.flagged && flaggedCategories.length > 0) {
    throw new Error("MODERATION_RESPONSE_INVALID");
  }

  // =====================================================
  // 3.5 RETURN VALIDATED RESULT
  // =====================================================

  return {
    safe: !moderation.flagged,
    flagged: moderation.flagged,
    reason: flaggedCategories.length > 0 ? flaggedCategories.join(", ") : null,
    categories: flaggedCategories,
  };
};

// =====================================================
// 4. VALIDATE COMPLETE MODERATION RESPONSE
// =====================================================

const extractModerationResponse = (response: unknown): IModerationResult => {
  // =====================================================
  // 4.1 VALIDATE RESPONSE STRUCTURE
  // =====================================================

  if (
    typeof response !== "object" ||
    response === null ||
    Array.isArray(response)
  ) {
    throw new Error("MODERATION_RESPONSE_INVALID");
  }

  const results = (response as Record<string, unknown>).results;

  if (!Array.isArray(results) || results.length === 0) {
    throw new Error("MODERATION_RESPONSE_INVALID");
  }

  // =====================================================
  // 4.2 VALIDATE EVERY RESULT
  // =====================================================

  // Neither malformed results nor flagged later
  // items can be ignored.

  const validated = Array.from(results, extractModerationResult);

  // =====================================================
  // 4.3 COMBINE FLAGGED CATEGORIES
  // =====================================================

  const categories = [
    ...new Set(validated.flatMap((result) => result.categories)),
  ];

  const flagged = validated.some((result) => result.flagged);

  // =====================================================
  // 4.4 RETURN COMBINED RESULT
  // =====================================================

  return {
    safe: !flagged,
    flagged,
    reason: categories.length > 0 ? categories.join(", ") : null,
    categories,
  };
};

// =====================================================
// 5. TEXT MODERATION
// =====================================================

const moderateText = async (
  text?: string | null,
): Promise<IModerationResult> => {
  // Rating-only review is allowed.
  if (!text?.trim()) {
    return {
      safe: true,
      flagged: false,
      reason: null,
      categories: [],
    };
  }

  // Timeout and retry are controlled by the
  // OpenAI client configuration.

  const response = await openai.moderations.create({
    model: "omni-moderation-latest",
    input: text.trim(),
  });

  // Invalid responses throw an error.
  // API failures are never treated as safe.

  return extractModerationResponse(response);
};

// =====================================================
// 6. IMAGE MODERATION
// =====================================================

const moderateImage = async (imageUrl: string): Promise<IModerationResult> => {
  // =====================================================
  // 6.1 VALIDATE IMAGE URL
  // =====================================================

  if (!imageUrl?.trim()) {
    throw new Error("IMAGE_URL_REQUIRED");
  }

  // =====================================================
  // 6.2 MODERATE IMAGE
  // =====================================================

  const response = await openai.moderations.create({
    model: "omni-moderation-latest",

    input: [
      {
        type: "image_url",
        image_url: {
          url: imageUrl,
        },
      },
    ],
  });

  // =====================================================
  // 6.3 RETURN VALIDATED RESULT
  // =====================================================

  return extractModerationResponse(response);
};

// =====================================================
// 7. REVIEW CONTENT MODERATION
// Text + multiple images
// =====================================================

const moderateReviewContent = async (
  text: string | null | undefined,
  imageUrls: string[],
): Promise<IModerationResult> => {
  const inputs: any[] = [];

  // =====================================================
  // 7.1 ADD TEXT INPUT
  // =====================================================

  if (text?.trim()) {
    inputs.push({
      type: "text",
      text: text.trim(),
    });
  }

  // =====================================================
  // 7.2 ADD IMAGE INPUTS
  // =====================================================

  for (const imageUrl of imageUrls) {
    inputs.push({
      type: "image_url",

      image_url: {
        url: imageUrl,
      },
    });
  }

  // =====================================================
  // 7.3 HANDLE RATING-ONLY REVIEW
  // =====================================================

  if (inputs.length === 0) {
    return {
      safe: true,
      flagged: false,
      reason: null,
      categories: [],
    };
  }

  // =====================================================
  // 7.4 MODERATE REVIEW CONTENT
  // =====================================================

  const response = await openai.moderations.create({
    model: "omni-moderation-latest",
    input: inputs,
  });

  // =====================================================
  // 7.5 RETURN VALIDATED RESULT
  // =====================================================

  return extractModerationResponse(response);
};

// =====================================================
// 8. EXPORT SERVICE
// =====================================================

export const contentModerationService = {
  moderateText,
  moderateImage,
  moderateReviewContent,
};
