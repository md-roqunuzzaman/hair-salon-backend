import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface ITextModerationResult {
  safe: boolean;
  flagged: boolean;
  reason: string | null;
  categories: string[];
}

const moderateText = async (
  text?: string | null,
): Promise<ITextModerationResult> => {
  // Empty review comment is allowed.
  // Rating-only review does not need moderation.
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

export const contentModerationService = {
  moderateText,
};
