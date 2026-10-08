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

const extractModerationResult = (result: any): IModerationResult => {
  const flaggedCategories = Object.entries(result.categories)
    .filter(([, flagged]) => flagged === true)
    .map(([category]) => category);

  return {
    safe: !result.flagged,

    flagged: result.flagged,

    reason: flaggedCategories.length > 0 ? flaggedCategories.join(", ") : null,

    categories: flaggedCategories,
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

  const result = response.results[0];

  if (!result) {
    throw new Error("MODERATION_RESULT_MISSING");
  }

  return extractModerationResult(result);
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

  const result = response.results[0];

  if (!result) {
    throw new Error("MODERATION_RESULT_MISSING");
  }

  return extractModerationResult(result);
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

  const result = response.results[0];

  if (!result) {
    throw new Error("MODERATION_RESULT_MISSING");
  }

  return extractModerationResult(result);
};

export const contentModerationService = {
  moderateText,
  moderateImage,
  moderateReviewContent,
};
