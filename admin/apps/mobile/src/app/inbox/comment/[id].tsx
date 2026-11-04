import { countUTF8Bytes } from "@openpost/platform-text";
import { ReviewContext } from "@/components/inbox/review-context";
import { InboxSessionBoundary } from "@/components/inbox/session-boundary";
import { useEffect, useRef, useState } from "react";
import { Alert, Linking, ScrollView, View } from "react-native";
import { Stack, useLocalSearchParams, router } from "expo-router";
import { useHeaderHeight, useIsFocused } from "expo-router/react-navigation";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { inboxQueryKeys } from "@openpost/query-catalog";
import { AccountAvatar } from "@/components/account-avatar";
import { BodyText, Button, ContentTitle, Screen, TextField } from "@/components/ui";
import { DelayedQueryPlaceholder, QueryNotice } from "@/components/query-state";
import { MediaImage } from "@/components/media-image";
import { useComment } from "@/lib/inbox/queries";
import { commentAction, setCommentState } from "@/lib/inbox/api";
import { orderedCommentAncestors } from "@/lib/inbox/ancestors";
import { useInboxOnline } from "@/lib/inbox/connection";
import { useOwnerReplyRemoval, usePublicReply } from "@/lib/inbox/use-public-reply";
import { useInboxJob } from "@/lib/inbox/use-job";
import { captureApiRequestIdentity, apiRequestIdentityIsCurrent } from "@/lib/api/client";
import { useInboxUpdates } from "@/lib/inbox/lifecycle";
import { newInboxOperationId } from "@/lib/inbox/storage";
import { useAccounts, useWorkspaceCapabilities, useWorkspaceId } from "@/lib/queries";
import { platformLabel } from "@/lib/format";
import { useNativeTheme } from "@/theme";

export default function CommentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const workspaceId = useWorkspaceId() ?? "";
  return (
    <InboxSessionBoundary>
      <CommentContent key={`${workspaceId}:${id}`} workspaceId={workspaceId} id={id} />
    </InboxSessionBoundary>
  );
}
function CommentContent({ workspaceId, id }: { workspaceId: string; id: string }) {
  const { colors, spacing, shape, typography } = useNativeTheme().manifest;
  const compactAction = { minHeight: 44, paddingHorizontal: spacing.medium };
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const focused = useIsFocused();
  const item = useComment(id);
  const comment = item.data?.item;
  const accounts = useAccounts();
  const account = accounts.data?.find((row) => row.id === comment?.social_account_id);
  const canEdit = !!useWorkspaceCapabilities()?.can_edit;
  const queryClient = useQueryClient();
  const online = useInboxOnline();
  const isReview = comment?.kind === "review";
  const activityName = isReview ? "review" : comment?.kind === "mention" ? "mention" : "comment";
  const authorName = comment?.subject?.review?.anonymous
    ? "Anonymous reviewer"
    : comment?.author_name || comment?.author_handle || "Unknown author";
  const reviewActive = isReview && comment?.reply_operation_state === "active";
  const replyable = canEdit && !!comment?.can_reply && !comment.deleted_at && !comment.archived_at;
  const reply = usePublicReply(workspaceId, id, replyable);
  const replyUncertain =
    reply.operation?.state === "ambiguous" || reply.operation?.state === "sending";
  const canSubmitReply = replyable && (!reviewActive || replyUncertain);
  const removal = useOwnerReplyRemoval(workspaceId, id, canEdit && isReview);
  const removalUncertain =
    removal.operation?.state === "ambiguous" || removal.operation?.state === "sending";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undoArchive, setUndoArchive] = useState<boolean | null>(null);
  const [moderationJobId, setModerationJobId] = useState<string>();
  const moderation = useInboxJob(workspaceId, isReview ? comment?.reply_job_id : moderationJobId);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const composerScroll = useRef<ScrollView>(null);
  const composerFocused = useRef(false);
  function revealComposer() {
    requestAnimationFrame(() => {
      if (composerFocused.current) composerScroll.current?.scrollToEnd({ animated: false });
    });
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const liveError = useInboxUpdates("comments");
  const ancestors = comment ? orderedCommentAncestors(comment, item.data?.parents ?? []) : [];
  const [showReceipts, setShowReceipts] = useState(false);
  const commentRead = comment?.read_at;
  const commentId = comment?.id;
  useEffect(() => {
    if (!canEdit || !focused || !commentId || commentRead) return;
    void setCommentState(workspaceId, id, { read: true }, canEdit)
      .then(() =>
        queryClient.invalidateQueries({ queryKey: inboxQueryKeys.engagementRoot(workspaceId) }),
      )
      .catch(() => setError("Could not mark this comment read. Reopen it to retry."));
  }, [canEdit, commentId, commentRead, focused, workspaceId, id, queryClient]);
  useEffect(() => {
    if (moderation.job?.status === "completed")
      void queryClient.invalidateQueries({ queryKey: inboxQueryKeys.engagementRoot(workspaceId) });
  }, [moderation.job, queryClient, workspaceId]);
  useEffect(() => {
    if (removal.receipt.job?.status === "completed")
      void queryClient.invalidateQueries({ queryKey: inboxQueryKeys.engagementRoot(workspaceId) });
  }, [removal.receipt.job, queryClient, workspaceId]);
  async function archive(archived: boolean, undo = false) {
    if (!canEdit || !comment || inFlight.current) return;
    const identity = captureApiRequestIdentity();
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await setCommentState(workspaceId, id, { archived }, canEdit);
      if (!mounted.current || !apiRequestIdentityIsCurrent(identity)) return;
      setUndoArchive(undo ? null : !!comment.archived_at);
      setNotice(
        `${activityName[0].toUpperCase()}${activityName.slice(1)} ${archived ? "archived" : "reopened"}`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inboxQueryKeys.engagementRoot(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: inboxQueryKeys.summary(workspaceId) }),
      ]);
    } catch (cause) {
      if (mounted.current && apiRequestIdentityIsCurrent(identity))
        setError(cause instanceof Error ? cause.message : "Could not update comment.");
    } finally {
      inFlight.current = false;
      if (mounted.current && apiRequestIdentityIsCurrent(identity)) setBusy(false);
    }
  }
  async function action(kind: "hide" | "delete" | "like" | "unlike") {
    if (!canEdit || !comment || inFlight.current) return;
    const identity = captureApiRequestIdentity();
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const receipt = await commentAction(workspaceId, id, kind, undefined, newInboxOperationId());
      if (!mounted.current || !apiRequestIdentityIsCurrent(identity)) return;
      if (!receipt.job_id) throw new Error("The server did not confirm a durable action receipt.");
      setModerationJobId(receipt.job_id);
      setNotice("Action queued. Waiting for network confirmation.");
    } catch (cause) {
      if (mounted.current && apiRequestIdentityIsCurrent(identity))
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not confirm this action. Check the thread before trying again.",
        );
    } finally {
      inFlight.current = false;
      if (mounted.current && apiRequestIdentityIsCurrent(identity)) setBusy(false);
    }
  }
  return (
    <Screen safeTop={false}>
      <Stack.Screen
        options={{
          title: isReview ? "Business review" : comment?.kind === "mention" ? "Mention" : "Comment",
          headerBackTitle: "Inbox",
          headerLeft: router.canGoBack()
            ? undefined
            : () => (
                <Button
                  title="Inbox"
                  intent="quiet"
                  onPress={() => router.replace("/(tabs)/inbox")}
                />
              ),
          headerShown: true,
        }}
      />
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={headerHeight}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing.large, gap: 20 }}
        >
          <DelayedQueryPlaceholder pending={item.isPending} shape="detail" />
          {item.isError ? (
            <QueryNotice
              message={item.error instanceof Error ? item.error.message : "Could not load comment"}
              retry={() => void item.refetch()}
            />
          ) : null}
          {comment ? (
            <>
              <View
                style={{
                  gap: 8,
                  paddingBottom: 16,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.outlineVariant,
                }}
              >
                <ContentTitle>
                  {isReview
                    ? "Business review"
                    : comment.kind === "mention"
                      ? "Incoming mention"
                      : "Original post"}
                </ContentTitle>
                <BodyText selectable style={{ color: colors.onSurface }}>
                  {comment.publication_title ||
                    comment.publication_excerpt ||
                    (isReview
                      ? "Customer feedback on this location."
                      : comment.kind === "mention"
                        ? "This post mentions your connected account."
                        : "Post context is unavailable.")}
                </BodyText>
                {comment.publication_title && comment.publication_excerpt ? (
                  <BodyText selectable>{comment.publication_excerpt}</BodyText>
                ) : null}
                {comment.provider_post_url && /^https?:\/\//.test(comment.provider_post_url) ? (
                  <Button
                    title={isReview ? "Open review" : "Open original post"}
                    intent="link"
                    onPress={() => void Linking.openURL(comment.provider_post_url!)}
                    style={{ alignSelf: "flex-start" }}
                  />
                ) : null}
              </View>
              {comment.subject?.review ? <ReviewContext review={comment.subject.review} /> : null}
              {removal.operation ? (
                <View style={{ gap: 8 }}>
                  <BodyText selectable>Removal intent: {removal.operation.operationId}</BodyText>
                  {removal.operation.jobId ? (
                    <BodyText selectable>Removal receipt: {removal.operation.jobId}</BodyText>
                  ) : null}
                  <BodyText>
                    Removal status: {removal.receipt.job?.status ?? removal.operation.state}
                  </BodyText>
                  {removal.error ? <QueryNotice message={removal.error} /> : null}
                  {removalUncertain ? (
                    <Button
                      title="Recover removal receipt"
                      intent="ordinary"
                      onPress={removal.submit}
                      disabled={!canEdit || !online || removal.operation.state === "sending"}
                    />
                  ) : null}
                  {removal.operation.jobId ? (
                    <Button
                      title="Check removal receipt"
                      intent="ordinary"
                      onPress={removal.receipt.check}
                      disabled={removal.receipt.checking}
                    />
                  ) : null}
                </View>
              ) : null}
              {isReview && comment.reply_job_id ? (
                <View style={{ gap: 8 }}>
                  <BodyText selectable>Reply receipt: {comment.reply_job_id}</BodyText>
                  <BodyText>
                    Reply operation:{" "}
                    {moderation.job?.status || comment.reply_operation_state || "Not specified"}
                  </BodyText>
                  {reviewActive ? (
                    <BodyText>
                      A reply operation is still being checked. Inspect its receipt before replacing
                      it.
                    </BodyText>
                  ) : null}
                  <Button
                    title="Check reply receipt"
                    intent="ordinary"
                    onPress={moderation.check}
                    disabled={moderation.checking}
                  />
                </View>
              ) : null}
              {comment.parent_remote_id ? (
                <View style={{ gap: 6 }}>
                  <ContentTitle>Earlier in this thread</ContentTitle>
                  {ancestors.length ? (
                    <View style={{ gap: 12 }}>
                      {ancestors[0].parent_remote_id ? (
                        <BodyText>Earlier replies are not available in stored history.</BodyText>
                      ) : null}
                      {ancestors.map((ancestor) => (
                        <View key={ancestor.id} style={{ gap: 4 }}>
                          <BodyText>
                            {ancestor.author_name || ancestor.author_handle || "Unknown author"}
                          </BodyText>
                          <BodyText selectable>
                            {ancestor.deleted_at ? "This comment was deleted." : ancestor.body}
                          </BodyText>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <BodyText>
                      {item.isPending
                        ? "Loading parent comment…"
                        : "The parent comment is not available in stored history."}
                    </BodyText>
                  )}
                </View>
              ) : null}
              <View style={{ gap: 12 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <AccountAvatar
                    name={authorName}
                    platform={comment.platform}
                    avatarUrl={comment.author_avatar_url}
                    size={40}
                  />
                  <View style={{ flex: 1 }}>
                    <ContentTitle>{authorName}</ContentTitle>
                    <BodyText>
                      {[comment.author_handle, platformLabel(comment.platform)]
                        .filter(Boolean)
                        .join(" · ")}
                    </BodyText>
                  </View>
                </View>
                <BodyText selectable style={{ color: colors.onSurface }}>
                  {comment.deleted_at
                    ? "This item was deleted."
                    : comment.body || (isReview ? "Rating without written feedback" : "")}
                </BodyText>
                {comment.hidden ? <BodyText>Hidden on the network</BodyText> : null}
                {comment.attachments?.map((attachment, index) =>
                  attachment.type === "image" ? (
                    <MediaImage
                      key={index}
                      uri={attachment.url}
                      accessibilityLabel={attachment.name || "Comment attachment"}
                      contentFit="contain"
                      style={{
                        height: 180,
                        width: "100%",
                        borderRadius: shape.medium,
                      }}
                    />
                  ) : null,
                )}
              </View>
              {canEdit ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <Button
                    title={`${comment.archived_at ? "Reopen" : "Archive"} ${activityName}`}
                    intent="ordinary"
                    disabled={busy || moderation.checking}
                    onPress={() => void archive(!comment.archived_at)}
                    style={compactAction}
                  />
                  {undoArchive !== null ? (
                    <Button
                      title="Undo"
                      intent="ordinary"
                      disabled={busy || moderation.checking}
                      onPress={() => void archive(undoArchive, true)}
                      style={compactAction}
                    />
                  ) : null}
                  {!comment.deleted_at ? (
                    <>
                      {comment.can_like && !comment.liked ? (
                        <Button
                          title="Like"
                          intent="ordinary"
                          disabled={busy || moderation.checking}
                          onPress={() => void action("like")}
                          style={compactAction}
                        />
                      ) : null}
                      {comment.can_unlike && comment.liked ? (
                        <Button
                          title="Unlike"
                          intent="ordinary"
                          disabled={busy || moderation.checking}
                          onPress={() => void action("unlike")}
                          style={compactAction}
                        />
                      ) : null}
                      {comment.can_hide && !comment.hidden ? (
                        <Button
                          title="Hide"
                          intent="ordinary"
                          disabled={busy || moderation.checking}
                          onPress={() => void action("hide")}
                          style={compactAction}
                        />
                      ) : null}
                      {comment.can_delete_reply ? (
                        <Button
                          title={
                            removalUncertain ? "Retry reply removal safely" : "Remove your reply"
                          }
                          intent="destructive"
                          disabled={
                            busy ||
                            !online ||
                            !removal.ready ||
                            (reviewActive && !removalUncertain) ||
                            removal.operation?.state === "queued" ||
                            removal.operation?.state === "sending"
                          }
                          onPress={() =>
                            Alert.alert(
                              "Remove your reply?",
                              "Remove only your reply from Google. The customer review stays visible.",
                              [
                                { text: "Cancel", style: "cancel" },
                                {
                                  text: "Remove reply",
                                  style: "destructive",
                                  onPress: () =>
                                    void (async () => {
                                      if (
                                        removal.operation?.state === "confirmed" ||
                                        removal.operation?.state === "failed"
                                      )
                                        await removal.startNewReply("");
                                      removal.submit();
                                    })(),
                                },
                              ],
                            )
                          }
                          style={compactAction}
                        />
                      ) : null}
                      {comment.can_delete ? (
                        <Button
                          title="Delete"
                          intent="destructive"
                          disabled={busy || moderation.checking}
                          onPress={() =>
                            Alert.alert(
                              "Delete comment?",
                              "This removes the comment from the network. This cannot be undone.",
                              [
                                { text: "Cancel", style: "cancel" },
                                {
                                  text: "Delete",
                                  style: "destructive",
                                  onPress: () => void action("delete"),
                                },
                              ],
                            )
                          }
                          style={compactAction}
                        />
                      ) : null}
                    </>
                  ) : null}
                </View>
              ) : null}
            </>
          ) : null}
          {reply.history.length ? (
            <View style={{ gap: 8 }}>
              <Button
                title={`Previous reply receipts (${reply.history.length})`}
                intent="ordinary"
                accessibilityState={{ expanded: showReceipts }}
                onPress={() => setShowReceipts((value) => !value)}
                style={{
                  alignSelf: "flex-start",
                  minHeight: 44,
                  paddingHorizontal: spacing.medium,
                }}
              />
              {showReceipts
                ? reply.history.map((receipt) => (
                    <View key={receipt.operationId} style={{ gap: 6, paddingVertical: 8 }}>
                      <ContentTitle>
                        {receipt.state === "confirmed" ? "Accepted reply" : "Failed reply"} ·{" "}
                        {new Date(receipt.createdAt).toLocaleString()}
                      </ContentTitle>
                      <BodyText selectable>{receipt.body}</BodyText>
                      {receipt.error ? <BodyText>{receipt.error}</BodyText> : null}
                      <BodyText selectable>Receipt: {receipt.jobId}</BodyText>
                    </View>
                  ))
                : null}
            </View>
          ) : null}
          {liveError ? <BodyText>Reconnecting to Inbox…</BodyText> : null}
          {error ? <QueryNotice message={error} /> : null}
          {moderation.job?.status === "completed" ? (
            <BodyText accessibilityLiveRegion="polite">Action confirmed by the network.</BodyText>
          ) : moderation.job?.status === "failed" ? (
            <QueryNotice
              message={`Action failed: ${moderation.job.last_error || "Check the original thread."}`}
            />
          ) : moderation.needsCheck ? (
            <QueryNotice
              message="Action outcome needs checking. Open the original thread before trying again."
              retry={moderation.check}
            />
          ) : notice ? (
            <BodyText accessibilityLiveRegion="polite">{notice}</BodyText>
          ) : null}
        </ScrollView>
        {comment ? (
          <View
            style={{
              flexShrink: 1,
              maxHeight: "65%",
              borderTopWidth: 1,
              borderTopColor: colors.outlineVariant,
            }}
          >
            <ScrollView
              ref={composerScroll}
              style={{ flexGrow: 0 }}
              keyboardShouldPersistTaps="handled"
              onLayout={revealComposer}
              onContentSizeChange={revealComposer}
              contentContainerStyle={{ paddingHorizontal: spacing.large, paddingTop: 12, gap: 8 }}
            >
              <BodyText style={[typography.labelMedium]}>
                Public reply to{" "}
                {comment.subject?.review?.anonymous
                  ? "the anonymous reviewer"
                  : comment.author_name || comment.author_handle || "this person"}
                , as{" "}
                {account?.alias ||
                  comment.account_username ||
                  account?.account_username ||
                  "receiving account"}{" "}
                · {platformLabel(comment.platform)}
              </BodyText>
              {!online ? (
                <BodyText>
                  You’re offline. Your draft is saved. Reconnect, then tap Reply publicly.
                </BodyText>
              ) : null}
              {!replyable || reviewActive ? (
                <BodyText>
                  {reviewActive
                    ? "A reply operation is still being checked. Recover its existing receipt before starting another."
                    : comment.deleted_at
                      ? "This comment has been deleted."
                      : comment.archived_at
                        ? "Reopen this comment to reply."
                        : !canEdit
                          ? "Your Workspace role cannot reply."
                          : "This network or account does not support replies here."}
                </BodyText>
              ) : null}
              {reply.operation?.state === "confirmed" ? (
                <BodyText accessibilityLiveRegion="polite">
                  {isReview
                    ? "Reply accepted by Google. Its public visibility depends on moderation."
                    : "Public reply confirmed by the network."}
                </BodyText>
              ) : reply.operation?.state === "failed" ? (
                <QueryNotice
                  message={`Public reply failed: ${reply.operation.error || "The network did not confirm delivery."} Your reply is retained. Check the original thread before writing another.`}
                />
              ) : reply.receipt.needsCheck ? (
                <QueryNotice message="Reply delivery needs checking. Your reply and receipt are retained." />
              ) : reply.operation?.jobId ? (
                <BodyText accessibilityLiveRegion="polite">
                  Public reply queued. Waiting for network confirmation.
                </BodyText>
              ) : reply.operation?.state === "ambiguous" ? (
                <BodyText>Admission is unconfirmed. Retry safely with the same reply.</BodyText>
              ) : null}
              {reply.error || reply.receipt.error ? (
                <QueryNotice
                  message={reply.error || reply.receipt.error || "Could not check reply."}
                />
              ) : null}
              {reply.operation?.jobId && reply.operation.state !== "confirmed" ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <Button
                    title="Check delivery status"
                    intent="ordinary"
                    disabled={reply.receipt.checking}
                    onPress={reply.receipt.check}
                  />
                  {comment.provider_post_url && /^https?:\/\//.test(comment.provider_post_url) ? (
                    <Button
                      title="Check original thread"
                      intent="link"
                      onPress={() => void Linking.openURL(comment.provider_post_url!)}
                    />
                  ) : null}
                  {reply.operation.state === "failed" && replyable ? (
                    <Button
                      title="Start a new reply"
                      intent="ordinary"
                      accessibilityHint="Check the original thread first, then edit the retained text and send another reply explicitly."
                      onPress={reply.startNewReply}
                    />
                  ) : null}
                </View>
              ) : null}
              {isReview &&
              comment.subject?.review?.owner_reply &&
              (!reply.operation || reply.operation.state === "confirmed") &&
              replyable &&
              !reviewActive ? (
                <Button
                  title="Edit owner reply"
                  intent="ordinary"
                  onPress={() => {
                    const text = comment.subject?.review?.owner_reply?.text || "";
                    if (reply.operation?.state === "confirmed") reply.startNewReply(text);
                    else reply.setText(text);
                  }}
                />
              ) : null}
              {isReview ? (
                <BodyText>{countUTF8Bytes(reply.text.trim())}/4096 UTF-8 bytes</BodyText>
              ) : null}
              <TextField
                accessibilityLabel="Public reply"
                placeholder="Write a public reply"
                multiline
                editable={
                  replyable &&
                  !reviewActive &&
                  reply.ready &&
                  !busy &&
                  (!reply.operation || reply.operation.state === "confirmed")
                }
                value={reply.text}
                onChangeText={reply.setText}
                onFocus={() => {
                  composerFocused.current = true;
                  revealComposer();
                }}
                onBlur={() => {
                  composerFocused.current = false;
                }}
                style={{ minHeight: 48, maxHeight: 144, paddingVertical: 12 }}
              />
            </ScrollView>
            <View
              style={{
                paddingHorizontal: spacing.large,
                paddingTop: 8,
                paddingBottom: Math.max(insets.bottom, 12),
              }}
            >
              <Button
                title={
                  reply.operation?.state === "ambiguous" && !reply.operation.jobId
                    ? "Retry public reply safely"
                    : isReview
                      ? "Save owner reply"
                      : "Reply publicly"
                }
                intent="focal"
                loading={reply.operation?.state === "sending"}
                disabled={
                  !online ||
                  !canSubmitReply ||
                  !reply.ready ||
                  !reply.text.trim() ||
                  (isReview && countUTF8Bytes(reply.text.trim()) > 4096) ||
                  !!reply.operation?.jobId ||
                  reply.operation?.state === "failed"
                }
                onPress={reply.submit}
              />
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}
