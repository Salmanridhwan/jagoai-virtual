// Shared theme validation math and thresholds.
//
// DOM-free: no DOM, no Svelte, no runtime dependencies. Both the web theme
// validator (`packages/ui`) and the native theme validator (`apps/mobile`)
// import this module instead of restating the constants and reimplementing
// the compositing, luminance, contrast, and Oklab math. Each platform keeps
// its own manifest shape, color parsing, and field checks; only the shared
// numeric contract lives here.
//
// Thresholds follow the product bar: body text stays at 4.5:1, focus stays
// at 3:1, and dithered button texture stays between 1.18:1 and 1.8:1 at the
// default 16% ink tint. This is an extraction, not a rule change: every
// accept/reject result must stay identical.
import {
  DITHER_BUTTON_MAX_CONTRAST,
  DITHER_BUTTON_MIN_CONTRAST,
  DITHER_BUTTON_OPACITY,
} from "./paint.js";

export { DITHER_BUTTON_MAX_CONTRAST, DITHER_BUTTON_MIN_CONTRAST, DITHER_BUTTON_OPACITY };

/** Zero-to-one premultiplied-input RGBA. Parsing stays per platform. */
export interface ThemeValidationRgba {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

export const MINIMUM_TEXT_CONTRAST = 4.5;
export const MINIMUM_FOCUS_CONTRAST = 3;
export const MINIMUM_SEMANTIC_ACTION_DISTANCE = 0.014;
export const MINIMUM_STATUS_COLOR_DISTANCE = 0.04;

export type ThemeValidationOklab = readonly [lightness: number, a: number, b: number];

export function compositeValidationColor(
  foreground: ThemeValidationRgba,
  background: ThemeValidationRgba,
): ThemeValidationRgba {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
  return {
    red:
      (foreground.red * foreground.alpha +
        background.red * background.alpha * (1 - foreground.alpha)) /
      alpha,
    green:
      (foreground.green * foreground.alpha +
        background.green * background.alpha * (1 - foreground.alpha)) /
      alpha,
    blue:
      (foreground.blue * foreground.alpha +
        background.blue * background.alpha * (1 - foreground.alpha)) /
      alpha,
    alpha,
  };
}

function toLinearChannel(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: ThemeValidationRgba): number {
  return (
    0.2126 * toLinearChannel(color.red) +
    0.7152 * toLinearChannel(color.green) +
    0.0722 * toLinearChannel(color.blue)
  );
}

/** WCAG contrast of two colors that are already in the same composited space. */
export function contrastRatio(first: ThemeValidationRgba, second: ThemeValidationRgba): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

const OPAQUE_WHITE: ThemeValidationRgba = { red: 1, green: 1, blue: 1, alpha: 1 };

/**
 * Contrast of a foreground over a possibly translucent background, itself
 * composited over a base (default white) that is forced opaque. Matches the
 * long-standing web semantics: translucent layers composite down to an
 * opaque page before the ratio is read.
 */
export function compositedContrastRatio(
  foreground: ThemeValidationRgba,
  background: ThemeValidationRgba,
  base: ThemeValidationRgba = OPAQUE_WHITE,
): number {
  const opaqueBase = compositeValidationColor(base, OPAQUE_WHITE);
  const compositedBackground = compositeValidationColor(background, opaqueBase);
  const compositedForeground = compositeValidationColor(foreground, compositedBackground);
  return contrastRatio(compositedForeground, compositedBackground);
}

export function toValidationOklab(color: ThemeValidationRgba): ThemeValidationOklab {
  const red = toLinearChannel(color.red);
  const green = toLinearChannel(color.green);
  const blue = toLinearChannel(color.blue);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * Perceptual distance of two colors after compositing each over the same
 * opaque underlay. Returns undefined for a translucent underlay instead of
 * guessing, matching both previous implementations.
 */
export function oklabDistance(
  first: ThemeValidationRgba,
  second: ThemeValidationRgba,
  underlay: ThemeValidationRgba,
): number | undefined {
  if (underlay.alpha !== 1) return undefined;
  const firstLab = toValidationOklab(compositeValidationColor(first, underlay));
  const secondLab = toValidationOklab(compositeValidationColor(second, underlay));
  return Math.hypot(
    firstLab[0] - secondLab[0],
    firstLab[1] - secondLab[1],
    firstLab[2] - secondLab[2],
  );
}

/** The `color-mix(in srgb, ink <opacity>, fill)` equivalent for opaque fills. */
export function ditherTextureColor(
  ink: ThemeValidationRgba,
  fill: ThemeValidationRgba,
  opacity: number = DITHER_BUTTON_OPACITY,
): ThemeValidationRgba {
  return compositeValidationColor({ ...ink, alpha: opacity }, fill);
}

/**
 * Whether a dithered action keeps both endpoints readable: the ink stays at
 * text contrast against its own texture, and the texture stays inside the
 * dither texture band against the fill. Both ratios composite over the
 * underlay first.
 */
export function balancedDitherAction(
  ink: ThemeValidationRgba,
  fill: ThemeValidationRgba,
  underlay: ThemeValidationRgba,
  opacity: number = DITHER_BUTTON_OPACITY,
): boolean {
  const texture = ditherTextureColor(ink, fill, opacity);
  const inkRatio = compositedContrastRatio(ink, texture, underlay);
  if (inkRatio < MINIMUM_TEXT_CONTRAST) return false;
  const textureRatio = compositedContrastRatio(fill, texture, underlay);
  return textureRatio >= DITHER_BUTTON_MIN_CONTRAST && textureRatio <= DITHER_BUTTON_MAX_CONTRAST;
}
