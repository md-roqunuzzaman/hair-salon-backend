import { AppError } from "../../utils/app-error.js";

import type { IBrandTheme } from "./brand.interface.js";

// =====================================================
// WCAG RELATIVE LUMINANCE
// =====================================================

const getLuminance = (hex: string): number => {
  const channels = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;

    return channel <= 0.04045
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

// =====================================================
// CONTRAST RATIO
// =====================================================

export const getContrastRatio = (
  foreground: string,
  background: string,
): number => {
  const first = getLuminance(foreground);
  const second = getLuminance(background);

  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);

  return (lighter + 0.05) / (darker + 0.05);
};

// =====================================================
// VALIDATE THEME CONTRAST
// =====================================================

export const validateBrandThemeContrast = (theme: IBrandTheme): void => {
  const checks = [
    {
      foreground: theme.onPrimaryColor,
      background: theme.primaryColor,
      label: "onPrimaryColor and primaryColor",
    },
    {
      foreground: theme.textColor,
      background: theme.backgroundColor,
      label: "textColor and backgroundColor",
    },
    {
      foreground: theme.textColor,
      background: theme.surfaceColor,
      label: "textColor and surfaceColor",
    },
    {
      foreground: theme.mutedTextColor,
      background: theme.backgroundColor,
      label: "mutedTextColor and backgroundColor",
    },
    {
      foreground: theme.mutedTextColor,
      background: theme.surfaceColor,
      label: "mutedTextColor and surfaceColor",
    },
  ];

  for (const check of checks) {
    const ratio = getContrastRatio(check.foreground, check.background);

    if (ratio < 4.5) {
      throw new AppError(
        `Insufficient color contrast between ${check.label}. Minimum ratio is 4.5:1.`,
        400,
      );
    }
  }
};
