type ParentLink = { remote_id: string; parent_remote_id: string };
/** Orders only the known chain from the canonical detail, without additional readers. */
export function orderedCommentAncestors<T extends ParentLink>(
  selected: Pick<ParentLink, "parent_remote_id">,
  parents: readonly T[],
): T[] {
  const byRemoteId = new Map(parents.map((parent) => [parent.remote_id, parent]));
  const visited = new Set<string>();
  const chain: T[] = [];
  let remoteId = selected.parent_remote_id;
  while (remoteId && !visited.has(remoteId)) {
    visited.add(remoteId);
    const parent = byRemoteId.get(remoteId);
    if (!parent) break;
    chain.push(parent);
    remoteId = parent.parent_remote_id;
  }
  return chain.reverse();
}
