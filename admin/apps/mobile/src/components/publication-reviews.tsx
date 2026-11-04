import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  appBootstrapQueryOptions,
  publicationReviewKeys,
  publicationReviewsQueryOptions,
} from "@openpost/query-catalog";
import type { Publication } from "@/lib/query-cache";
import { invalidatePublicationData } from "@/lib/query-cache";
import { api, errorMessage } from "@/lib/api/client";
import { getWorkspaceId } from "@/lib/api/token-store";
import { readAppBootstrap } from "@/lib/app-bootstrap";
import { getServer } from "@/lib/server";
import { mobileQueryAPI } from "@/lib/query-api";
import { useAccounts, useWorkspaceCapabilities } from "@/lib/queries";
import {
  captureWorkspaceQueryScope,
  requireCurrentQuerySession,
  workspaceQueryScopeIsCurrent,
} from "@/lib/query-session";
import { formatDateTime, platformLabel } from "@/lib/format";
import { useNativeTheme } from "@/theme";
import { BodyText, Button, SectionHeader, TextField } from "./ui";
import { QueryNotice } from "./query-state";
import { ReviewAttachment } from "./review-attachment";

export function PublicationReviews({ publication }: { publication: Publication }) {
  const { spacing } = useNativeTheme().manifest;
  const workspace = useWorkspaceCapabilities();
  const queryClient = useQueryClient();
  const reviews = useQuery(
    publicationReviewsQueryOptions(
      { list: mobileQueryAPI.listPublicationReviews },
      publication.workspace_id,
      publication.id,
    ),
  );
  const bootstrap = useQuery(
    appBootstrapQueryOptions(
      {
        getAppBootstrap: (preferred, signal) => {
          const server = getServer();
          if (!server) throw new Error("No server selected");
          return readAppBootstrap(server.baseUrl, preferred, signal);
        },
      },
      publication.workspace_id,
    ),
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const latest = reviews.data?.[0];
  const canDecide = Boolean(
    workspace?.can_approve &&
    workspace.id === publication.workspace_id &&
    latest?.current &&
    !latest.decision &&
    latest.reviewer_id === bootstrap.data?.user?.id &&
    publication.review_state === "pending",
  );
  async function decide(decision: "approved" | "changes_requested") {
    if (!latest || !canDecide || busy || (decision === "changes_requested" && !feedback.trim()))
      return;
    const scope = captureWorkspaceQueryScope(publication.workspace_id);
    const current = () => mounted.current && workspaceQueryScopeIsCurrent(scope, getWorkspaceId());
    if (!current()) return;
    setBusy(true);
    setError("");
    try {
      requireCurrentQuerySession(scope);
      const result = await api().PUT("/publications/{id}/reviews/{review_id}", {
        params: { path: { id: publication.id, review_id: latest.id } },
        body: { expected_epoch: latest.epoch, decision, feedback },
      });
      if (result.error)
        throw new Error(await errorMessage(result.response, "Could not save the review"));
      if (!current()) return;
      setFeedback("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: publicationReviewKeys.list(publication.workspace_id, publication.id),
        }),
        invalidatePublicationData(queryClient, {
          workspaceId: publication.workspace_id,
          publicationId: publication.id,
          activities: ["draft", "scheduled", "published", "failed"],
          calendar: true,
        }),
      ]);
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : "Could not save the review");
    } finally {
      if (current()) setBusy(false);
    }
  }
  return (
    <View style={{ gap: spacing.medium }}>
      <SectionHeader label="Client review" />
      <BodyText>Approval does not publish the post.</BodyText>
      {reviews.isPending ? (
        <BodyText accessibilityRole="progressbar">Loading reviews…</BodyText>
      ) : null}
      {bootstrap.error ? (
        <QueryNotice
          message="Could not check review permissions"
          retry={() => void bootstrap.refetch()}
        />
      ) : null}
      {reviews.error ? (
        <QueryNotice message="Could not load client reviews" retry={() => void reviews.refetch()} />
      ) : null}
      {error ? <QueryNotice message={error} /> : null}
      {(reviews.data ?? []).map((review, index) => {
        const visible = expanded === review.id || (index === 0 && canDecide);
        return (
          <View key={review.id} style={{ gap: spacing.small }}>
            <BodyText>
              {review.decision === "approved"
                ? "Client approved"
                : review.decision === "changes_requested"
                  ? "Changes requested"
                  : "Awaiting client review"}{" "}
              · {formatDateTime(review.created_at)}
            </BodyText>
            {!review.current ? <BodyText>Previous version</BodyText> : null}
            {review.note ? <BodyText selectable>{review.note}</BodyText> : null}
            {review.feedback ? <BodyText selectable>{review.feedback}</BodyText> : null}
            {index === 0 && canDecide ? null : (
              <Button
                title={visible ? "Hide submitted version" : "Inspect submitted version"}
                intent="quiet"
                onPress={() => setExpanded(visible ? null : review.id)}
              />
            )}
            {visible ? <ReviewSnapshot publication={review.snapshot} /> : null}
            {index === 0 && canDecide ? (
              <>
                <TextField
                  accessibilityLabel="Feedback"
                  placeholder="Feedback"
                  multiline
                  maxLength={4000}
                  editable={!busy}
                  value={feedback}
                  onChangeText={setFeedback}
                />
                <Button
                  title="Approve this version"
                  intent="primary"
                  disabled={busy || reviews.isFetching}
                  onPress={() => void decide("approved")}
                />
                <Button
                  title="Request changes"
                  intent="ordinary"
                  disabled={busy || reviews.isFetching || !feedback.trim()}
                  onPress={() => void decide("changes_requested")}
                />
              </>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
function ReviewSnapshot({ publication }: { publication: Publication }) {
  const { spacing } = useNativeTheme().manifest;
  const accounts = useAccounts();
  return (
    <View style={{ gap: spacing.medium }}>
      {(publication.renditions ?? []).map((rendition) => (
        <View key={rendition.id} style={{ gap: spacing.small }}>
          <SectionHeader
            label={`${accounts.data?.find((account) => account.id === rendition.social_account_id)?.alias || accounts.data?.find((account) => account.id === rendition.social_account_id)?.account_username || rendition.social_account_id} · ${platformLabel(rendition.platform)}`}
          />
          {rendition.target_key && rendition.target_key !== rendition.platform ? (
            <BodyText selectable>{rendition.target_key}</BodyText>
          ) : null}
          <BodyText>
            {rendition.schedule_override || publication.scheduled_at
              ? formatDateTime(rendition.schedule_override || publication.scheduled_at!)
              : "Publishing time will be chosen later."}
          </BodyText>
          {(rendition.segments?.length ? rendition.segments : [null]).map((segment, index) => {
            const title = segment?.title?.trim()
              ? segment.title
              : rendition.title || publication.title;
            const description = segment?.description?.trim()
              ? segment.description
              : rendition.description;
            const settings = { ...rendition.settings, ...segment?.settings };
            return (
              <View key={segment?.id ?? rendition.id} style={{ gap: spacing.small }}>
                {title ? <BodyText selectable>Title: {title}</BodyText> : null}
                {description ? <BodyText selectable>Description: {description}</BodyText> : null}
                <BodyText selectable>{segment?.body ?? rendition.body}</BodyText>
                {segment?.url ? <BodyText selectable>{segment.url}</BodyText> : null}
                {(segment?.output_media ?? segment?.media ?? rendition.media ?? []).map((media) => (
                  <View key={media.id} style={{ gap: spacing.small }}>
                    <ReviewAttachment media={media} />
                    {media.alt_text ? <BodyText selectable>{media.alt_text}</BodyText> : null}
                  </View>
                ))}
                {Object.entries(settings)
                  .filter(
                    ([key, value]) =>
                      value != null && value !== "" && (key !== "first_comment" || index === 0),
                  )
                  .map(([key, value]) => (
                    <BodyText selectable key={key}>
                      {key === "first_comment" ? "First comment" : key.replaceAll("_", " ")}:{" "}
                      {typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}
                    </BodyText>
                  ))}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
