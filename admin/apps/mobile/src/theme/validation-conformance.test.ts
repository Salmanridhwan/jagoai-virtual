import { describe, expect, test } from "bun:test";

import {
  MINIMUM_TEXT_CONTRAST,
  compositedContrastRatio,
  contrastRatio,
  oklabDistance,
  type ThemeValidationRgba,
} from "@openpost/dither/theme-validation";
import { isReadableOnThemeSurfaces } from "./validation";

function rgba(tuple: readonly [number, number, number, number]): ThemeValidationRgba {
  return { red: tuple[0], green: tuple[1], blue: tuple[2], alpha: tuple[3] };
}

const channel = (hex: string): ThemeValidationRgba => {
  const value = hex.slice(1);
  const channels = [0, 2, 4].map(
    (offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255,
  );
  return { red: channels[0]!, green: channels[1]!, blue: channels[2]!, alpha: 1 };
};

// The native validator must reach the same verdict as the shared core for the
// same inputs. Parsing stays native (hex/rgba only); the math is single-source.
describe("native validation conformance with the shared theme core", () => {
  test("agrees on opaque light-on-dark and dark-on-light pairs", () => {
    expect(contrastRatio(channel("#ffffff"), channel("#000000"))).toBe(21);
    expect(isReadableOnThemeSurfaces("#000000", "#ffffff", "#ffffff")).toBe(true);
    expect(isReadableOnThemeSurfaces("#ffffff", "#000000", "#000000")).toBe(true);
  });

  test("agrees on a pair just below the text threshold", () => {
    const ratio = contrastRatio(channel("#777777"), channel("#ffffff"));
    expect(ratio).toBeGreaterThan(4.47);
    expect(ratio).toBeLessThan(MINIMUM_TEXT_CONTRAST);
    expect(isReadableOnThemeSurfaces("#777777", "#ffffff", "#ffffff")).toBe(false);
  });

  test("reads a translucent pair through compositing, like the core", () => {
    const ratio = compositedContrastRatio(
      rgba([0, 0, 0, 0.5]),
      channel("#ffffff"),
      channel("#ffffff"),
    );
    expect(ratio).toBeGreaterThan(3.9);
    expect(ratio).toBeLessThan(4.1);
  });

  test("keeps perceptual distance symmetric and zero for identical colors", () => {
    const white = channel("#ffffff");
    const black = channel("#000000");
    const forward = oklabDistance(white, black, white);
    const backward = oklabDistance(black, white, white);
    expect(forward).toBeDefined();
    expect(backward).toBeCloseTo(forward!, 12);
    expect(oklabDistance(white, white, white)).toBeCloseTo(0, 12);
  });
});
