import { useQuery } from "@tanstack/react-query";
import { engagementDetailQueryOptions } from "@openpost/query-catalog";
import { mobileInboxAPI } from "./api";
import { useWorkspaceId } from "../queries";
export function useComment(id: string) {
  const workspaceId = useWorkspaceId() ?? "";
  return useQuery(engagementDetailQueryOptions(mobileInboxAPI, workspaceId, id));
}
