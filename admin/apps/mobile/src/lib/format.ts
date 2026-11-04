export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  ready: "Ready",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
};

export function statusColor(
  status: string,
  colors: Readonly<Record<string, string>>,
  fallback: string,
): string {
  return colors[status] ?? fallback;
}

const PLATFORM_LABEL: Record<string, string> = {
  x: "X",
  twitter: "X",
  mastodon: "Mastodon",
  pixelfed: "Pixelfed",
  peertube: "PeerTube",
  lemmy: "Lemmy",
  piefed: "PieFed",
  gotosocial: "GoToSocial",
  akkoma: "Akkoma",
  pleroma: "Pleroma",
  friendica: "Friendica",
  bluesky: "Bluesky",
  devnull: "dev/null",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  threads: "Threads",
  youtube: "YouTube",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  reddit: "Reddit",
  discord: "Discord",
  telegram: "Telegram",
  gmb: "Google Business",
  googlebusiness: "Google Business",
};

export function platformLabel(platform: string): string {
  const key = platformKey(platform);
  const raw = platform.trim().split(":")[0];
  return PLATFORM_LABEL[key] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
}

const HANDLE_FIRST_PLATFORMS = new Set([
  "bluesky",
  "devnull",
  "instagram",
  "mastodon",
  "pixelfed",
  "threads",
  "tiktok",
  "x",
]);

/**
 * Canonical platform-key normalization for native. Mirrors `getPlatformKey`
 * (`apps/web/src/lib/utils.ts`): trim, case-fold, strip any `:instance`
 * suffix, then resolve legacy aliases (`twitter` → `x`,
 * `gmb` → `googlebusiness`). The native bundle cannot import the web module,
 * so keep the two in sync; the proposed long-term home for both is
 * `@openpost/platform-text`.
 */
const PLATFORM_KEY_ALIASES = {
  twitter: "x",
  gmb: "googlebusiness",
} as const;

export function platformKey(platform: string): string {
  const key = platform.trim().toLowerCase().split(":")[0] ?? "";
  if (Object.hasOwn(PLATFORM_KEY_ALIASES, key)) {
    // SAFETY: `key` was just checked with `Object.hasOwn` against this exact table,
    // so narrowing to its key union cannot yield a missing entry.
    return PLATFORM_KEY_ALIASES[key as keyof typeof PLATFORM_KEY_ALIASES];
  }
  return key;
}

/**
 * Brand-chip colors per canonical platform key, as hex so they work in React
 * Native. Each value matches the web `PLATFORM_COLORS` Tailwind token in
 * `apps/web/src/lib/utils.ts` (same palette shade, e.g. sky-500 → #0ea5e9);
 * unknown platforms fall back to gray-500.
 */
export const PLATFORM_COLORS = {
  x: "#000000",
  mastodon: "#6366f1",
  pixelfed: "#8b5cf6",
  peertube: "#f97316",
  lemmy: "#059669",
  piefed: "#3b82f6",
  threads: "#f97316",
  devnull: "#65a30d",
  bluesky: "#0ea5e9",
  discord: "#6366f1",
  linkedin: "#2563eb",
  instagram: "#ec4899",
  facebook: "#1d4ed8",
  youtube: "#dc2626",
  tiktok: "#18181b",
  pinterest: "#b91c1c",
  telegram: "#0ea5e9",
} as const;

export const PLATFORM_COLOR_FALLBACK = "#6b7280";

export function platformColor(platform: string): string {
  const key = platformKey(platform);
  if (Object.hasOwn(PLATFORM_COLORS, key)) {
    // SAFETY: `key` was just checked with `Object.hasOwn` against this exact table,
    // so narrowing to its key union cannot yield a missing entry.
    return PLATFORM_COLORS[key as keyof typeof PLATFORM_COLORS];
  }
  return PLATFORM_COLOR_FALLBACK;
}

export function accountHandle(
  username: string | null | undefined,
  fallback: string,
  platform = "",
  alias = "",
): string {
  if (alias.trim()) return alias.trim();
  const value = username?.trim();
  if (!value) return fallback;
  if (/\s/.test(value)) return value;
  if (!HANDLE_FIRST_PLATFORMS.has(platformKey(platform))) return value;
  return value.startsWith("@") ? value : `@${value}`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = date.getTime() - Date.now();
  const absMinutes = Math.abs(diffMs) / 60000;
  if (absMinutes < 1) return "just now";
  if (absMinutes < 60) return relativeUnit(Math.round(diffMs / 60000), "minute");
  if (absMinutes < 60 * 24) return relativeUnit(Math.round(diffMs / 3600000), "hour");
  if (absMinutes < 60 * 24 * 7) return relativeUnit(Math.round(diffMs / 86400000), "day");
  return date.toLocaleDateString("en", { month: "short", day: "numeric" });
}

function relativeUnit(value: number, unit: "minute" | "hour" | "day"): string {
  const count = Math.abs(value);
  const label = `${unit}${count === 1 ? "" : "s"}`;
  return value < 0 ? `${count} ${label} ago` : `in ${count} ${label}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * When a publication counts on the calendar, using the same status-to-field
 * rule as the web owner `publicationCalendarOccurrence` in
 * `apps/web/src/lib/publication-calendar.ts` (separate bundle, so this is an
 * adapter, not an import): scheduled/publishing use the authored
 * `scheduled_at`; published prefers `actual_run_at`; every other status has
 * no occurrence. Keep the two in sync when statuses change.
 */
export function calendarOccurrence(pub: {
  status: string;
  scheduled_at?: string | null;
  actual_run_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}): Date | null {
  const iso = occurrenceIso(pub);
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function occurrenceIso(pub: {
  status: string;
  scheduled_at?: string | null;
  actual_run_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}): string | null {
  // Planned views retain the authored schedule; queued dispatch may be
  // randomized, so actual_run_at is never used for scheduled/publishing.
  if (pub.status === "scheduled" || pub.status === "publishing") {
    return pub.scheduled_at || null;
  }
  if (pub.status === "published") {
    return pub.actual_run_at || pub.scheduled_at || pub.updated_at || pub.created_at || null;
  }
  return null;
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}
