import Root from "./avatar.svelte";
import Image from "./avatar-image.svelte";
import Fallback from "./avatar-fallback.svelte";
import Badge from "./avatar-badge.svelte";
import Group from "./avatar-group.svelte";
import GroupCount from "./avatar-group-count.svelte";
import { monogramFor } from "./monogram.js";

export {
  Root,
  Image,
  Fallback,
  Badge,
  Group,
  GroupCount,
  monogramFor,
  //
  Root as Avatar,
  Image as AvatarImage,
  Fallback as AvatarFallback,
  Badge as AvatarBadge,
  Group as AvatarGroup,
  GroupCount as AvatarGroupCount,
};
