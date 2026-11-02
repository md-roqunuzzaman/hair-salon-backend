import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface IModerationResult {
  safe: boolean;
  flagged: boolean;
  reason: string | null;
  categories: string[];
}

const extractModerationResult = (result: unknown): IModerationResult => {
  // =====================================================
  // 1. VALIDATE MODERATION RESPONSE STRUCTURE
  // =====================================================

  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new Error("MODERATION_RESPONSE_INVALID");
  }

  const moderation = result as Record<string, unknown>;

  // =====================================================
  // 2. VALIDATE FLAGGED FIELD
  // =====================================================

  if (typeof moderation.flagged !== "boolean") {
    throw new Error("MODERATION_RESPONSE_INVALID");
  }

  // =====================================================
  // 3. VALIDATE CATEGORIES
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
  // 4. EXTRACT FLAGGED CATEGORIES
  // =====================================================

  const flaggedCategories = categoryEntries
    .filter(([, flagged]) => flagged === true)
    .map(([category]) => category);

  if (!moderation.flagged && flaggedCategories.length > 0) {
    throw new Error("MODERATION_RESPONSE_INVALID");
  }

  // =====================================================
  // 5. RETURN VALIDATED RESULT
  // =====================================================

  return {
    safe: !moderation.flagged,
    flagged: moderation.flagged,
    reason: flaggedCategories.length > 0 ? flaggedCategories.join(", ") : null,
    categories: flaggedCategories,
  };
};

const extractModerationResponse = (response: unknown): IModerationResult => {
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    throw new Error("MODERATION_RESPONSE_INVALID");
  }
  const results = (response as Record<string, unknown>).results;
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error("MODERATION_RESPONSE_INVALID");
  }

  // Validate every result; neither malformed nor flagged later items can be ignored.
  const validated = Array.from(results, extractModerationResult);
  const categories = [...new Set(validated.flatMap(result => result.categories))];
  const flagged = validated.some(result => result.flagged);
  return {
    safe: !flagged,
    flagged,
    reason: categories.length > 0 ? categories.join(", ") : null,
    categories,
  };
};

// =====================================================
// TEXT MODERATION
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

  const response = await openai.moderations.create({
    model: "omni-moderation-latest",

    input: text.trim(),
  });

  return extractModerationResponse(response);
};

// =====================================================
// IMAGE MODERATION
// =====================================================

const moderateImage = async (imageUrl: string): Promise<IModerationResult> => {
  if (!imageUrl?.trim()) {
    throw new Error("IMAGE_URL_REQUIRED");
  }

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

  return extractModerationResponse(response);
};

// =====================================================
// REVIEW CONTENT MODERATION
// Text + multiple images
// =====================================================

const moderateReviewContent = async (
  text: string | null | undefined,
  imageUrls: string[],
): Promise<IModerationResult> => {
  const inputs: any[] = [];

  if (text?.trim()) {
    inputs.push({
      type: "text",
      text: text.trim(),
    });
  }

  for (const imageUrl of imageUrls) {
    inputs.push({
      type: "image_url",

      image_url: {
        url: imageUrl,
      },
    });
  }

  // Rating-only review:
  // no text + no image
  if (inputs.length === 0) {
    return {
      safe: true,
      flagged: false,
      reason: null,
      categories: [],
    };
  }

  const response = await openai.moderations.create({
    model: "omni-moderation-latest",

    input: inputs,
  });

  return extractModerationResponse(response);
};

export const contentModerationService = {
  moderateText,
  moderateImage,
  moderateReviewContent,
};
