import { gradientMask } from "@openpost/dither/paint";

// Bundle-free controls keep the same Bayer geometry and interaction densities as Button.
export const staticActionTexture = {
  "--static-dither-rest": gradientMask({ kind: "button", length: 44 }),
  "--static-dither-hover": gradientMask({ kind: "button", length: 44, intensity: 1 }),
  "--static-dither-pressed": gradientMask({ kind: "button", length: 44, intensity: 1.5 }),
  "--dither-mask": "var(--static-dither-rest)",
  "--dither-mask-size": "8px 44px",
};
