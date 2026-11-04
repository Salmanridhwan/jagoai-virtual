// Single owner of the character-counter platform list.
//
// Both the marketing character-counter tool
// (apps/marketing/src/routes/tools/_lib/tool-utils.ts) and the public tool
// catalogue entry in ./index.js derive from this list, so the advertised
// platform count can never disagree with the rows the tool renders. Keep this
// list limited to the networks the counter actually checks: it is independent
// of the publishing-provider catalogue (platformNames in ./index.js).
export const counterPlatforms = Object.freeze([
  { key: "x", name: "X" },
  { key: "bluesky", name: "Bluesky" },
  { key: "mastodon", name: "Mastodon" },
  { key: "threads", name: "Threads" },
  { key: "linkedin", name: "LinkedIn" },
  { key: "instagram", name: "Instagram" },
  { key: "tiktok", name: "TikTok" },
  { key: "youtube", name: "YouTube" },
  { key: "facebook", name: "Facebook Pages" },
  { key: "pinterest", name: "Pinterest" },
  { key: "telegram", name: "Telegram" },
  { key: "discord", name: "Discord" },
]);
