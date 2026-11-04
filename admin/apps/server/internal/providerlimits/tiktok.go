package providerlimits

// Verified 2026-10-17 against TikTok's Content Posting API media transfer guide:
// https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
//
// TikTok documents a maximum of 1080p without naming an image axis. OpenPost's
// shorter-side interpretation follows the 2172x2896 rejection and 1080x1440
// success recorded by Postiz in commit a15f6ea3023b. Keep unknown dimensions
// publishable until TikTok documents a stricter contract.
const TikTokPhotoMaxShortSidePixels = 1080
