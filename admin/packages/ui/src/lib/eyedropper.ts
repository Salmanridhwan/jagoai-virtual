export interface OpenPostEyeDropperResult {
  sRGBHex: string;
}

export interface OpenPostEyeDropper {
  open(): Promise<OpenPostEyeDropperResult>;
}

export type OpenPostEyeDropperConstructor = new () => OpenPostEyeDropper;

declare global {
  interface Window {
    EyeDropper?: OpenPostEyeDropperConstructor;
  }
}
