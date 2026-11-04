export interface TelemetryEventMap {
  "marketing cta clicked": {
    action: "signup" | "pricing" | "docs" | "tool" | "github";
    placement: "navigation" | "footer" | "page";
    target: string;
  };
  "video export failed": {
    editor: "video" | "quick_cut";
    format: string;
    error_kind: string;
  };

  "growth opened": { platform_count: number };
  "growth recommendation shown": {
    platform: string;
    rank_bucket: string;
    mutual_count_bucket: string;
    follows_viewer: boolean;
  };
  "growth profile opened": {
    platform: string;
    rank_bucket: string;
    mutual_count_bucket: string;
    follows_viewer: boolean;
  };
  "signup started": Record<string, never>;
  "publication publish requested": {
    account_count: number;
    is_thread: boolean;
  };
  "publication schedule requested": {
    account_count: number;
    is_thread: boolean;
  };
  "media uploaded": {
    count: number;
    source: "upload" | "camera" | "stock_import";
  };
  "image design created": {
    source: "custom" | "preset" | "template" | "media";
  };
  "image design exported": { mode: string; pages: number };
  "billing checkout opened": { billing_period: string; plan_id: string };
  "video project created": {
    source: "openpost_media" | "files" | "blank" | "recording" | "stock" | "unknown";
    editing_mode?: string;
    file_count?: number;
    storage?: "local" | "cloud";
  };
  "video export completed": {
    format: string;
    variant_count: number;
    editor?: "video" | "quick_cut";
  };
  "public editor opened": {
    editor: "image" | "video";
    source: "marketing_tool";
  };
  "public image editor viewed": Record<string, string | number | boolean>;
  "public image design started": Record<string, string | number | boolean>;
  "public image editor meaningful edit": Record<string, string | number | boolean>;
  "public image export completed": Record<string, string | number | boolean>;
  "public image editor signup clicked": Record<string, string | number | boolean>;
  "public image editor signup completed": Record<string, string | number | boolean>;
  "public image workspace import completed": Record<string, string | number | boolean>;
  "docs search used": { result_count?: number };
  "docs code copied": { language?: string };
}

export type TelemetryEventName = keyof TelemetryEventMap;

export const eventPropertyAllowlists: Record<TelemetryEventName, readonly string[]> = {
  "marketing cta clicked": ["action", "placement", "target"],
  "video export failed": ["editor", "format", "error_kind"],
  "growth opened": ["platform_count"],
  "growth recommendation shown": [
    "platform",
    "rank_bucket",
    "mutual_count_bucket",
    "follows_viewer",
  ],
  "growth profile opened": ["platform", "rank_bucket", "mutual_count_bucket", "follows_viewer"],
  "signup started": [],
  "publication publish requested": ["account_count", "is_thread"],
  "publication schedule requested": ["account_count", "is_thread"],
  "media uploaded": ["count", "source"],
  "image design created": ["source"],
  "image design exported": ["mode", "pages"],
  "billing checkout opened": ["billing_period", "plan_id"],
  "video project created": ["source", "editing_mode", "file_count", "storage"],
  "video export completed": ["format", "variant_count", "editor"],
  "public editor opened": ["editor", "source"],
  "public image editor viewed": ["returning_guest"],
  "public image design started": ["entry", "preset", "template"],
  "public image editor meaningful edit": ["source"],
  "public image export completed": ["format", "pages"],
  "public image editor signup clicked": ["source"],
  "public image editor signup completed": ["source"],
  "public image workspace import completed": ["source"],
  "docs search used": ["result_count"],
  "docs code copied": ["language"],
};
const planIDs = new Set(["founder", "team", "agency"]);
const billingPeriods = new Set(["monthly", "annual"]);

export function allowlistedEventProperties(
  name: TelemetryEventName,
  properties: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!Object.hasOwn(eventPropertyAllowlists, name)) return null;
  const allowlist = eventPropertyAllowlists[name];
  if (!allowlist) return null;
  if (Object.keys(properties).some((key) => !allowlist.includes(key))) {
    return null;
  }
  if (Object.values(properties).some(containsSensitiveValue)) return null;
  if (
    name === "billing checkout opened" &&
    (!planIDs.has(String(properties.plan_id)) ||
      !billingPeriods.has(String(properties.billing_period)))
  ) {
    return null;
  }
  const result = Object.fromEntries(
    allowlist.filter((key) => properties[key] !== undefined).map((key) => [key, properties[key]]),
  );
  return result;
}

export function containsSensitiveValue(value: unknown): boolean {
  if (typeof value === "string") {
    return /(?:https?:\/\/|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:token|secret|password|authorization)=|^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$)/iu.test(
      value,
    );
  }
  if (Array.isArray(value)) return value.some(containsSensitiveValue);
  if (value && typeof value === "object") {
    return Object.values(value).some(containsSensitiveValue);
  }
  return false;
}
