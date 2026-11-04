import { mentionTarget, type TextMention } from "@openpost/platform-text/mentions";
import { getQueryActorRevision } from "./query-session";
// Native clipboard HTML is accepted only for identities this actor has read or
// selected in this Workspace. Unknown HTML never supplies a new mention target.
let actor = -1;
const known = new Map<string, true>();
function key(workspaceId: string, span: TextMention) {
  const current = getQueryActorRevision();
  if (actor !== current) {
    known.clear();
    actor = current;
  }
  const target = mentionTarget(span.target) ?? span.target;
  return JSON.stringify([
    workspaceId,
    target.provider,
    target.kind,
    target.authority ?? "",
    target.id,
    target.handle ?? "",
    target.profiles ?? [],
    span.text,
  ]);
}
export function rememberMentionClipboardTargets(
  workspaceId: string,
  spans: readonly TextMention[],
) {
  for (const span of spans) {
    known.set(key(workspaceId, span), true);
    while (known.size > 500) known.delete(known.keys().next().value!);
  }
}
export function knownMentionClipboardTarget(workspaceId: string, span: TextMention) {
  return known.has(key(workspaceId, span));
}
