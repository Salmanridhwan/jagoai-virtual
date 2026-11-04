import { renditionReadinessSegments } from "@/lib/publication-image-choices";
import { AccountImageFit, type AccountImageChoice } from "@/components/account-image-fit";
import { PostEditor } from "@/components/post-editor";
import {
  readMentionMetadata,
  remapMentionMetadata,
  type PostTextValue,
} from "@openpost/platform-text/mentions";
import { NativeText as Text } from "@/components/native-text";
import { recordNativeFirstComposition } from "@/lib/telemetry/composition";
import { nativeTelemetry } from "@/lib/telemetry";
import type * as ImagePicker from "expo-image-picker";
import { MediaImage } from "@/components/media-image";
import { DestinationChooser } from "@/components/destination-chooser";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import {
  BodyText,
  Button,
  ContentSection,
  IconButton,
  Screen,
  StatusBadge,
  TextField,
} from "@/components/ui";
import { DelayedQueryPlaceholder, InitialQueryError, QueryNotice } from "@/components/query-state";
import { CelebrationBurst } from "@/components/celebration-burst";
import { DitherPanel } from "@/components/dither-panel";
import { BottomDrawer } from "@/components/bottom-drawer";
import { ThemeIcon } from "@/components/theme-icon";
import { ProtectedIcon } from "@/components/protected-icon";
import { api, errorMessage, type Api } from "@/lib/api/client";
import { applyPickerValue, firstPickerStep, type PickerStep } from "@/lib/date-time-picker";
import {
  reconcileDestinationSelection,
  destinationSummaryLabel,
} from "@/lib/destination-selection";
import {
  destinationIssueMessages,
  destinationNeedsAttention,
  firstPublishBlocker,
  readinessDebounceMs,
  readinessRequestSignature,
  resolveDestinationCapabilities,
  type ReadinessRequestInput,
  type ResolvedDestinationCapability,
} from "@/lib/destination-readiness";
import { formatDateTime, platformLabel } from "@/lib/format";
import { errorHaptic, selectionHaptic, successHaptic } from "@/lib/haptics";
import {
  MAX_MOBILE_ATTACHMENT_COUNT,
  attachmentSizeError,
  uploadAttachment,
  type PendingAttachment,
} from "@/lib/media";
import { pickMedia } from "@/lib/media-picker";
import { takePendingAttachments } from "@/lib/share";
import { publicationContentUpdate, publicationReadinessSegments } from "@/lib/publication-content";
import {
  attachmentRequirement,
  mobileRenditionInput,
  mobileRenditionGeneratedText,
  mobileRenditionTextFields,
  mobileRenditionTextValue,
  renditionImages,
  type RenditionTextEdits,
} from "@/lib/publication-renditions";
import { invalidatePublicationData, type Publication } from "@/lib/query-cache";
import {
  currentWorkspaceId,
  useAccounts,
  usePublication,
  useSocialSets,
  useWorkspaceCapabilities,
} from "@/lib/queries";
import type { PublicationActivity } from "@/lib/query-policy";
import { getWorkspaceId } from "@/lib/api/token-store";
import {
  captureWorkspaceQueryScope,
  queryActorScopeIsCurrent,
  requireCurrentQueryActor,
  requireCurrentQuerySession,
  workspaceQueryScopeIsCurrent,
  type WorkspaceQueryScope,
} from "@/lib/query-session";
import { useNativeTheme } from "@/theme";

type Attachment = {
  localId: string;
  uri?: string;
  mediaId?: string;
  mimeType: string;
  filename: string;
  size: number | null;
  status: "local" | "uploading" | "ready" | "error";
  altText: string;
};

function attachmentsFromPublication(pub: PublicationDetail): Attachment[] {
  return (pub.segments?.[0]?.media ?? pub.media ?? []).map((media) => ({
    localId: `remote-${media.id}`,
    mediaId: media.id,
    uri: media.url,
    mimeType: media.mime_type ?? "image/jpeg",
    filename: media.original_filename ?? media.id,
    size: media.size ?? null,
    status: "ready" as const,
    altText: media.alt_text ?? "",
  }));
}

type PublicationDetail = Publication;
type AccountsQuery = ReturnType<typeof useAccounts>;
type SocialSetsQuery = ReturnType<typeof useSocialSets>;
type EditorMutationScope = WorkspaceQueryScope & {
  publicationId: string;
  originalActivity: PublicationActivity;
  originalCalendarEntry: boolean;
};

function bodyFromPublication(pub: PublicationDetail): string {
  return (
    pub.segments?.[0]?.body ??
    pub.source_text ??
    pub.renditions?.find((rendition) => rendition.body)?.body ??
    ""
  );
}

function selectedAccountsFromPublication(pub: PublicationDetail): Set<string> {
  return new Set(
    (pub.renditions ?? []).map((rendition) => rendition.social_account_id).filter(Boolean),
  );
}

function captureEditorMutationScope(
  publicationId: string,
  originalActivity: PublicationActivity,
  originalCalendarEntry: boolean,
): EditorMutationScope {
  return {
    ...captureWorkspaceQueryScope(currentWorkspaceId()),
    publicationId,
    originalActivity,
    originalCalendarEntry,
  };
}

function workspaceScopeIsCurrent(scope: WorkspaceQueryScope): boolean {
  return workspaceQueryScopeIsCurrent(scope, getWorkspaceId());
}

export default function ComposeScreen() {
  const { id, build, celebrate } = useLocalSearchParams<{
    id: string;
    build?: string;
    celebrate?: string;
  }>();

  const publication = usePublication(id);
  const accounts = useAccounts();
  const socialSets = useSocialSets();
  const workspace = useWorkspaceCapabilities();
  if (!workspace?.can_edit)
    return (
      <Screen>
        <BodyText>This Workspace is read-only for your role.</BodyText>
        <Button
          title="View post"
          onPress={() => router.replace({ pathname: "/publications/[id]", params: { id } })}
        />
      </Screen>
    );

  if (publication.isPending && !publication.data) {
    return (
      <Screen style={styles.coldState}>
        <Stack.Screen options={{ headerShown: false }} />
        <DelayedQueryPlaceholder
          pending
          shape="editor"
          offline={publication.fetchStatus === "paused"}
        />
      </Screen>
    );
  }

  if (!publication.data) {
    return (
      <Screen style={styles.coldState}>
        <Stack.Screen options={{ headerShown: false }} />
        <InitialQueryError
          title="Could not open this draft"
          message={
            publication.error instanceof Error ? publication.error.message : "Failed to load"
          }
          retry={() => void publication.refetch()}
          secondaryAction={{ label: "Close", onPress: () => router.back() }}
        />
      </Screen>
    );
  }

  return (
    <Composer
      key={String(id)}
      buildOnOpen={build === "1"}
      celebrateOnOpen={celebrate === "1"}
      id={id}
      pub={publication.data}
      accounts={accounts}
      socialSets={socialSets}
      refreshError={publication.isError}
      refreshPaused={publication.fetchStatus === "paused"}
      onRefreshPublication={() => void publication.refetch()}
    />
  );
}

function Composer({
  id,
  pub,
  accounts,
  socialSets,
  refreshError,
  refreshPaused,
  onRefreshPublication,
  buildOnOpen,
  celebrateOnOpen,
}: {
  id: string;
  pub: PublicationDetail;
  accounts: AccountsQuery;
  socialSets: SocialSetsQuery;
  refreshError: boolean;
  refreshPaused: boolean;
  onRefreshPublication: () => void;
  buildOnOpen: boolean;
  celebrateOnOpen: boolean;
}) {
  const theme = useNativeTheme();
  const { colors, editor, typography, spacing } = theme.manifest;
  const queryClient = useQueryClient();
  const [canonicalTextEdits, setCanonicalTextEdits] = useState<Record<string, PostTextValue>>({});
  const [annotatedRenditionEdits, setAnnotatedRenditionEdits] = useState<
    Record<string, Record<string, PostTextValue>>
  >({});
  const [initialPendingAttachments] = useState(() => takePendingAttachments());
  const editorDirty = useRef(initialPendingAttachments.length > 0);
  const contentSnapshot = useRef(pub);

  const [body, setBody] = useState(() => bodyFromPublication(pub));
  const [revision, setRevision] = useState(pub.revision ?? 0);
  const [scheduledAt, setScheduledAt] = useState<Date | null>(
    pub.scheduled_at ? new Date(pub.scheduled_at) : null,
  );
  const [pickerStep, setPickerStep] = useState<PickerStep | null>(null);
  const [destinationDrawerOpen, setDestinationDrawerOpen] = useState(false);
  const [scheduleDrawerOpen, setScheduleDrawerOpen] = useState(false);
  const [selectedSocialSetId, setSelectedSocialSetId] = useState(pub.social_set_id ?? "");
  const [selectionTouched, setSelectionTouched] = useState((pub.renditions?.length ?? 0) > 0);
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(() =>
    selectedAccountsFromPublication(pub),
  );
  const [renditionTextEdits, setRenditionTextEdits] = useState<Record<string, RenditionTextEdits>>(
    {},
  );
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [imageChoices, setImageChoices] = useState<Record<string, AccountImageChoice>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [readinessByAccount, setReadinessByAccount] = useState<
    Record<string, ResolvedDestinationCapability>
  >({});
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [readinessNonce, setReadinessNonce] = useState(0);
  const readinessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readinessAbort = useRef<AbortController | null>(null);
  const readinessSequence = useRef(0);
  const lastReadinessSignature = useRef<string | null>(null);
  const [celebrationTrigger, setCelebrationTrigger] = useState(celebrateOnOpen ? 1 : 0);
  const [attachments, setAttachments] = useState<Attachment[]>(() => [
    ...attachmentsFromPublication(pub),
    ...initialPendingAttachments.map((pending) => ({
      localId: pending.localId,
      uri: pending.uri,
      mimeType: pending.mimeType,
      filename: pending.filename,
      size: pending.size,
      status: "local" as const,
      altText: "",
    })),
  ]);
  const autoBuildStarted = useRef(false);
  const celebratedIdea = useRef(celebrateOnOpen);

  useEffect(() => {
    if (editorDirty.current) return;
    contentSnapshot.current = pub;
    setBody(bodyFromPublication(pub));
    setRevision(pub.revision ?? 0);
    setScheduledAt(pub.scheduled_at ? new Date(pub.scheduled_at) : null);
    setSelectedSocialSetId(pub.social_set_id ?? "");
    setSelectionTouched((pub.renditions?.length ?? 0) > 0);
    setSelectedAccounts(selectedAccountsFromPublication(pub));
    setRenditionTextEdits({});
    setCanonicalTextEdits({});
    setAnnotatedRenditionEdits({});
    setImageChoices({});
    setAttachments((current) => [
      ...attachmentsFromPublication(pub),
      ...current.filter((attachment) => !attachment.mediaId),
    ]);
  }, [pub]);

  const defaultSocialSet = socialSets.data?.find((set) => set.is_default) ?? socialSets.data?.[0];
  const defaultAccountIDs =
    defaultSocialSet?.accounts?.map((account) => account.social_account_id) ??
    accounts.data?.map((account) => account.id) ??
    [];
  const activeAccounts = selectionTouched ? selectedAccounts : new Set(defaultAccountIDs);
  const activeSocialSetId = selectionTouched
    ? selectedSocialSetId
    : (defaultSocialSet?.id ?? selectedSocialSetId);
  const originalActivity = publicationActivity(pub.status);
  const originalCalendarEntry =
    originalActivity === "scheduled" || originalActivity === "published";
  const selectableAccountIds =
    accounts.data === undefined
      ? [...activeAccounts]
      : reconcileDestinationSelection(activeAccounts, accounts.data, pub.renditions).selectable;
  const readyMediaIds = attachments
    .filter((attachment) => attachment.mediaId)
    .map((attachment) => attachment.mediaId as string);

  function selectedImageIDs(accountId: string, resolvedProfile?: string) {
    const profile =
      contentSnapshot.current.renditions?.find((r) => r.social_account_id === accountId)
        ?.output_profile ||
      resolvedProfile ||
      readinessByAccount[accountId]?.output_profile;
    return Object.fromEntries(
      Object.values(imageChoices)
        .filter(
          (choice) =>
            choice.accountId === accountId && choice.selected && choice.profile === profile,
        )
        .map((choice) => [choice.originalId, choice.prepared.id]),
    );
  }

  function computeReadinessInput(
    firstSegmentMediaIds: string[],
    accountIds = [...selectableAccountIds].sort(),
  ) {
    const segments = publicationReadinessSegments(
      contentSnapshot.current,
      body,
      firstSegmentMediaIds,
      canonicalTextEdits,
    );
    const snapshot = contentSnapshot.current;
    const accountSegments = Object.fromEntries(
      accountIds.map((accountId) => {
        const stored = snapshot.renditions?.find((item) => item.social_account_id === accountId);
        const strategy =
          stored?.segments?.length === 1 && (snapshot.segments?.length ?? 0) > 1
            ? "join"
            : (readinessByAccount[accountId]?.segment_strategy ?? "preserve");
        const input = mobileRenditionInput(
          snapshot,
          accountId,
          renditionTextEdits[accountId],
          attachments,
          annotatedRenditionEdits[accountId],
          strategy,
          selectedImageIDs(accountId),
        );
        return [
          accountId,
          renditionReadinessSegments(
            snapshot,
            input,
            segments,
            strategy,
            accounts.data?.find((account) => account.id === accountId),
          ),
        ];
      }),
    );
    const input = { accountIds, segments, accountSegments };
    return { ...input, signature: readinessRequestSignature(input) };
  }

  async function runReadinessResolve(
    signature: string,
    input: ReadinessRequestInput,
  ): Promise<void> {
    const workspaceId = getWorkspaceId();
    if (!workspaceId) return;
    const scope = captureWorkspaceQueryScope(workspaceId);
    const sequence = ++readinessSequence.current;
    readinessAbort.current?.abort();
    const controller = new AbortController();
    readinessAbort.current = controller;
    try {
      const resolved = await resolveDestinationCapabilities(api(), input, controller.signal);
      requireCurrentQueryActor(scope);
      if (sequence !== readinessSequence.current) return;
      if (!workspaceScopeIsCurrent(scope)) return;
      lastReadinessSignature.current = signature;
      setReadinessByAccount(resolved);
      setReadinessError(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (sequence !== readinessSequence.current) return;
      if (!workspaceScopeIsCurrent(scope)) return;
      setReadinessError(
        err instanceof Error ? err.message : "Could not check destination readiness",
      );
    }
  }

  function retryReadiness(): void {
    lastReadinessSignature.current = null;
    setReadinessNonce((current) => current + 1);
  }

  const readinessAccountsKey = selectableAccountIds.join(",");
  const readinessAttachmentsKey = attachments
    .map((attachment) => `${attachment.localId}:${attachment.mediaId ?? ""}`)
    .join(",");
  useEffect(() => {
    const input = computeReadinessInput(readyMediaIds);
    const { accountIds, signature } = input;
    if (readinessTimer.current) {
      clearTimeout(readinessTimer.current);
      readinessTimer.current = null;
    }
    if (accountIds.length === 0) {
      readinessAbort.current?.abort();
      lastReadinessSignature.current = signature;
      // Readiness only applies to selectable destinations; consumers read the
      // effective values below, so no results are shown while none are
      // selected.
      return;
    }
    if (signature === lastReadinessSignature.current) return;
    readinessTimer.current = setTimeout(() => {
      readinessTimer.current = null;
      void runReadinessResolve(signature, input);
    }, readinessDebounceMs());
    return () => {
      if (readinessTimer.current) {
        clearTimeout(readinessTimer.current);
        readinessTimer.current = null;
      }
      readinessAbort.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    body,
    readinessAccountsKey,
    readinessAttachmentsKey,
    readinessNonce,
    pub,
    imageChoices,
    renditionTextEdits,
    annotatedRenditionEdits,
    canonicalTextEdits,
  ]);

  // Readiness describes the destinations selected now. Clearing the last one
  // leaves earlier results in state, so consumers read these derived values and
  // never show a capability or error for a destination that is no longer
  // selectable.
  const hasSelectableDestinations = selectableAccountIds.length > 0;
  const effectiveReadinessByAccount: Record<string, ResolvedDestinationCapability> =
    hasSelectableDestinations ? readinessByAccount : {};
  const effectiveReadinessError = hasSelectableDestinations ? readinessError : null;
  const attentionCount = selectableAccountIds.filter((accountId) =>
    effectiveReadinessByAccount[accountId]
      ? destinationNeedsAttention(effectiveReadinessByAccount[accountId])
      : false,
  ).length;

  async function resolvePublishBlocker(
    scope: EditorMutationScope,
    firstSegmentMediaIds: string[],
  ): Promise<string | null> {
    const input = computeReadinessInput(firstSegmentMediaIds);
    const { accountIds } = input;
    if (accountIds.length === 0) return null;
    try {
      const resolved = await resolveDestinationCapabilities(api(), input);
      requireCurrentQueryActor(scope);
      if (!workspaceScopeIsCurrent(scope)) return null;
      return firstPublishBlocker(resolved, accountIds);
    } catch {
      return null;
    }
  }

  function markEditorDirty(): void {
    editorDirty.current = true;
  }

  function invalidate(
    scope: EditorMutationScope,
    {
      activities,
      calendar = false,
    }: {
      activities: readonly PublicationActivity[];
      calendar?: boolean;
    },
  ) {
    if (!queryActorScopeIsCurrent(scope)) return;
    void invalidatePublicationData(queryClient, {
      workspaceId: scope.workspaceId,
      publicationId: scope.publicationId,
      activities,
      calendar,
    });
  }

  async function httpError(
    response: Response | undefined,
    fallback: string,
    problem: unknown,
  ): Promise<Error> {
    if (response?.status === 409) {
      return new Error("This post changed elsewhere. Close and reopen it before trying again.");
    }
    return new Error(await errorMessage(response, fallback, problem));
  }

  async function resolveAttachments(
    scope: WorkspaceQueryScope,
    requestApi: Api,
  ): Promise<{ mediaId: string; mimeType: string; localId: string }[]> {
    const mediaIds: { mediaId: string; mimeType: string; localId: string }[] = [];
    for (const attachment of attachments) {
      if (attachment.mediaId) {
        mediaIds.push({
          mediaId: attachment.mediaId,
          mimeType: attachment.mimeType,
          localId: attachment.localId,
        });
        continue;
      }
      if (!attachment.uri) continue;
      if (workspaceScopeIsCurrent(scope)) {
        setAttachments((current) =>
          current.map((item) =>
            item.localId === attachment.localId ? { ...item, status: "uploading" } : item,
          ),
        );
      }
      try {
        const pendingAttachment: PendingAttachment = {
          localId: attachment.localId,
          uri: attachment.uri,
          mimeType: attachment.mimeType,
          filename: attachment.filename,
          size: attachment.size,
        };
        const mediaId = await uploadAttachment(pendingAttachment, {
          client: requestApi,
          workspaceId: scope.workspaceId,
        });
        requireCurrentQueryActor(scope);
        mediaIds.push({ mediaId, mimeType: attachment.mimeType, localId: attachment.localId });
        if (workspaceScopeIsCurrent(scope)) {
          setAttachments((current) =>
            current.map((item) =>
              item.localId === attachment.localId
                ? { ...item, mediaId, status: "ready" as const }
                : item,
            ),
          );
        }
      } catch (err) {
        if (workspaceScopeIsCurrent(scope)) {
          setAttachments((current) =>
            current.map((item) =>
              item.localId === attachment.localId ? { ...item, status: "error" as const } : item,
            ),
          );
        }
        throw err instanceof Error ? err : new Error("Could not upload attachment");
      }
    }
    return mediaIds;
  }

  async function persist(
    scope: EditorMutationScope,
    requestApi: Api,
    scheduleOverride?: Date,
  ): Promise<{ nextRevision: number; mediaIds: string[] }> {
    requireCurrentQueryActor(scope);
    const media = await resolveAttachments(scope, requestApi);
    requireCurrentQueryActor(scope);
    // Per-post attachment descriptions live on the Publication media metadata
    // for this destination, never on the shared library Media record. Only
    // values that differ from the snapshot baseline (including explicit empty
    // overrides) are sent.
    const baselineAlt = new Map(
      (contentSnapshot.current.segments?.[0]?.media ?? contentSnapshot.current.media ?? []).map(
        (item) => [item.id, item.alt_text ?? ""],
      ),
    );
    const altByLocalId = new Map(attachments.map((item) => [item.localId, item.altText]));
    const altOverrides = new Map<string, string>();
    for (const item of media) {
      const altText = altByLocalId.get(item.localId) ?? "";
      const previous = baselineAlt.get(item.mediaId);
      if (previous === undefined ? altText !== "" : altText !== previous) {
        altOverrides.set(item.mediaId, altText);
      }
    }
    const renditionMedia = media.map((item) => ({
      mediaId: item.mediaId,
      mimeType: item.mimeType,
      altText: altOverrides.get(item.mediaId),
    }));
    // Only ids the workspace can still publish to reach the upsert: the
    // server lists only active accounts, and rejects inactive ids with a
    // 400. Destinations whose account is gone stay in the
    // selection so they render as explicit, removable rows; leaving them
    // selected neither upserts nor deletes their authored rendition.
    const desired =
      accounts.data === undefined
        ? [...activeAccounts]
        : reconcileDestinationSelection(activeAccounts, accounts.data, pub.renditions).selectable;
    const removed = (pub.renditions ?? []).filter(
      (rendition) =>
        rendition.social_account_id && !activeAccounts.has(rendition.social_account_id),
    );

    const addedAccounts = desired.filter(
      (accountId) =>
        !(contentSnapshot.current.renditions ?? []).some(
          (rendition) => rendition.social_account_id === accountId,
        ),
    );
    const addedCapabilities = addedAccounts.length
      ? await resolveDestinationCapabilities(
          requestApi,
          computeReadinessInput(
            media.flatMap((item) => (item.mediaId ? [item.mediaId] : [])),
            addedAccounts,
          ),
        )
      : {};
    requireCurrentQueryActor(scope);

    const initialScheduled = pub.scheduled_at ? new Date(pub.scheduled_at).getTime() : 0;
    const effectiveScheduledAt = scheduleOverride ?? scheduledAt;
    const scheduledChanged = (effectiveScheduledAt?.getTime() ?? 0) !== initialScheduled;

    const {
      data: updated,
      error,
      response,
    } = await requestApi.PUT("/publications/{id}", {
      params: { path: { id: scope.publicationId } },
      body: {
        expected_revision: revision,
        ...publicationContentUpdate(
          contentSnapshot.current,
          body,
          media.map((item) => item.mediaId),
          altOverrides,
          canonicalTextEdits,
        ),
        ...(activeSocialSetId ? { social_set_id: activeSocialSetId } : {}),
        ...(scheduledChanged
          ? effectiveScheduledAt
            ? { scheduled_at: effectiveScheduledAt.toISOString() }
            : { clear_schedule: true }
          : {}),
      },
    });
    if (error) throw await httpError(response, "Could not save", error);
    requireCurrentQueryActor(scope);
    let nextRevision = updated?.revision ?? revision + 1;
    if (workspaceScopeIsCurrent(scope) && updated) {
      contentSnapshot.current = updated;
      setRevision(nextRevision);
    }

    if (desired.length > 0) {
      const upsert = await requestApi.PUT("/publications/{id}/renditions", {
        params: { path: { id: scope.publicationId } },
        body: {
          expected_revision: nextRevision,
          renditions: desired.map((accountId) =>
            mobileRenditionInput(
              contentSnapshot.current,
              accountId,
              renditionTextEdits[accountId],
              renditionMedia,
              annotatedRenditionEdits[accountId],
              addedCapabilities[accountId]?.segment_strategy,
              selectedImageIDs(accountId, addedCapabilities[accountId]?.output_profile),
            ),
          ),
        },
      });
      if (upsert.error)
        throw await httpError(upsert.response, "Could not update destinations", upsert.error);
      requireCurrentQueryActor(scope);
      nextRevision = upsert.data?.revision ?? nextRevision + 1;
    }

    for (const rendition of removed) {
      if (!rendition.social_account_id) continue;
      const removal = await requestApi.DELETE("/publications/{id}/renditions/{account_id}", {
        params: {
          path: {
            id: scope.publicationId,
            account_id: rendition.social_account_id,
          },
          query: { confirm: true, expected_revision: nextRevision },
        },
      });
      if (removal.error)
        throw await httpError(removal.response, "Could not remove destination", removal.error);
      requireCurrentQueryActor(scope);
      nextRevision += 1;
    }

    if (workspaceScopeIsCurrent(scope)) setRevision(nextRevision);
    return { nextRevision, mediaIds: media.map((item) => item.mediaId) };
  }

  function handleError(
    err: Error,
    scope: EditorMutationScope,
    refresh?: {
      activities: readonly PublicationActivity[];
      calendar?: boolean;
    },
  ) {
    if (workspaceScopeIsCurrent(scope)) {
      setActionError(err.message);
      void errorHaptic();
    }
    if (refresh) {
      invalidate(scope, refresh);
    } else if (err.message.includes("changed elsewhere")) {
      invalidate(scope, { activities: [] });
    }
  }

  const saveAndClose = useMutation({
    mutationFn: async (scope: EditorMutationScope) => {
      requireCurrentQuerySession(scope);
      const { nextRevision } = await persist(scope, api());
      return nextRevision;
    },
    onSuccess: (_, scope) => {
      invalidate(scope, {
        activities: [scope.originalActivity],
        calendar: scope.originalCalendarEntry,
      });
      if (workspaceScopeIsCurrent(scope)) router.back();
    },
    onError: (err, scope) =>
      handleError(err, scope, {
        activities: [scope.originalActivity],
        calendar: scope.originalCalendarEntry,
      }),
  });

  const scheduleMutation = useMutation({
    mutationFn: async (scope: EditorMutationScope) => {
      requireCurrentQuerySession(scope);
      if (!scheduledAt) throw new Error("Pick a time first");
      const requestApi = api();
      const { nextRevision, mediaIds } = await persist(scope, requestApi);
      const blocker = await resolvePublishBlocker(scope, mediaIds);
      if (blocker) throw new Error(blocker);
      nativeTelemetry.capture("publication schedule requested", {
        account_count: pub.renditions?.length ?? 0,
        is_thread: (pub.segments?.length ?? 0) > 1,
      });
      const { error, response } = await requestApi.POST("/publications/{id}/schedule", {
        params: { path: { id: scope.publicationId } },
        body: { expected_revision: nextRevision },
      });
      if (error) throw await httpError(response, "Could not schedule", error);
      requireCurrentQueryActor(scope);
    },
    onSuccess: (_, scope) => {
      if (workspaceScopeIsCurrent(scope)) {
        void successHaptic();
        setStatusMessage("Queued for publishing");
        setTimeout(() => {
          if (workspaceScopeIsCurrent(scope)) router.back();
        }, 700);
      }
      invalidate(scope, {
        activities: [scope.originalActivity, "scheduled"],
        calendar: true,
      });
    },
    onError: (err, scope) =>
      handleError(err, scope, {
        activities: [scope.originalActivity, "scheduled"],
        calendar: true,
      }),
  });

  const publishNow = useMutation({
    mutationFn: async (scope: EditorMutationScope) => {
      requireCurrentQuerySession(scope);
      const requestApi = api();
      const { nextRevision, mediaIds } = await persist(scope, requestApi);
      const blocker = await resolvePublishBlocker(scope, mediaIds);
      if (blocker) throw new Error(blocker);
      nativeTelemetry.capture("publication publish requested", {
        account_count: pub.renditions?.length ?? 0,
        is_thread: (pub.segments?.length ?? 0) > 1,
      });
      const { error, response } = await requestApi.POST("/publications/{id}/publish-now", {
        params: { path: { id: scope.publicationId } },
        body: { expected_revision: nextRevision },
      });
      if (error) throw await httpError(response, "Could not publish", error);
      requireCurrentQueryActor(scope);
    },
    onSuccess: (_, scope) => {
      if (workspaceScopeIsCurrent(scope)) {
        void successHaptic();
        router.back();
      }
      invalidate(scope, {
        activities: [scope.originalActivity, "scheduled"],
        calendar: true,
      });
    },
    onError: (err, scope) =>
      handleError(err, scope, {
        activities: [scope.originalActivity, "scheduled"],
        calendar: true,
      }),
  });

  const deleteDraft = useMutation({
    mutationFn: async (scope: EditorMutationScope) => {
      requireCurrentQuerySession(scope);
      const { error, response } = await api().DELETE("/publications/{id}", {
        params: {
          path: { id: scope.publicationId },
          query: { confirm: true, expected_revision: revision },
        },
      });
      if (error) throw await httpError(response, "Could not delete", error);
      requireCurrentQueryActor(scope);
    },
    onSuccess: (_, scope) => {
      invalidate(scope, {
        activities: [scope.originalActivity],
        calendar: scope.originalCalendarEntry,
      });
      if (workspaceScopeIsCurrent(scope)) router.back();
    },
    onError: (err, scope) =>
      handleError(err, scope, {
        activities: [scope.originalActivity],
        calendar: scope.originalCalendarEntry,
      }),
  });

  const nextSlot = useMutation({
    mutationFn: async (scope: EditorMutationScope) => {
      requireCurrentQuerySession(scope);
      const { data, error, response } = await api().GET("/posting-schedules/next-slot", {
        params: { query: { workspace_id: scope.workspaceId } },
      });
      if (error || !data) throw new Error(await errorMessage(response, "No slot found", error));
      requireCurrentQueryActor(scope);
      return new Date(data.slot_time);
    },
    onSuccess: (date, scope) => {
      if (!workspaceScopeIsCurrent(scope)) return;
      markEditorDirty();
      setScheduledAt(date);
      setPickerStep(null);
    },
    onError: (err, scope) => handleError(err, scope),
  });

  const queueNextSlot = useMutation({
    mutationFn: async (scope: EditorMutationScope) => {
      requireCurrentQuerySession(scope);
      if (activeAccounts.size === 0) throw new Error("Choose at least one destination");
      const requestApi = api();
      const { data, error, response } = await requestApi.GET("/posting-schedules/next-slot", {
        params: { query: { workspace_id: scope.workspaceId } },
      });
      if (error || !data) throw new Error(await errorMessage(response, "No slot found", error));
      requireCurrentQueryActor(scope);
      const slot = new Date(data.slot_time);
      if (workspaceScopeIsCurrent(scope)) {
        markEditorDirty();
        setScheduledAt(slot);
      }
      const persisted = await persist(scope, requestApi, slot);
      const blocker = await resolvePublishBlocker(scope, persisted.mediaIds);
      if (blocker) throw new Error(blocker);
      const nextRevision = persisted.nextRevision;
      const scheduled = await requestApi.POST("/publications/{id}/schedule", {
        params: { path: { id: scope.publicationId } },
        body: { expected_revision: nextRevision },
      });
      if (scheduled.error)
        throw await httpError(scheduled.response, "Could not queue post", scheduled.error);
      requireCurrentQueryActor(scope);
      return slot;
    },
    onSuccess: (_, scope) => {
      if (workspaceScopeIsCurrent(scope)) {
        void successHaptic();
        router.back();
      }
      invalidate(scope, {
        activities: [scope.originalActivity, "scheduled"],
        calendar: true,
      });
    },
    onError: (err, scope) =>
      handleError(err, scope, {
        activities: [scope.originalActivity, "scheduled"],
        calendar: true,
      }),
  });

  const generatePost = useMutation({
    mutationFn: async (scope: EditorMutationScope) => {
      requireCurrentQuerySession(scope);
      const idea = body.trim();
      if (!idea) throw new Error("Jot down an idea first");
      if (activeAccounts.size === 0) throw new Error("Choose at least one destination");
      const { data, error, response } = await api().POST("/post-builder/generate", {
        body: {
          workspace_id: scope.workspaceId,
          idea,
          social_account_ids: [...activeAccounts],
        },
      });
      if (error || !data)
        throw new Error(await errorMessage(response, "Could not generate this draft", error));
      requireCurrentQueryActor(scope);
      const key = contentSnapshot.current.segments?.[0]?.id ?? "first";
      const previous = canonicalTextEdits[key] ?? {
        body,
        mentions: readMentionMetadata(
          body,
          contentSnapshot.current.segments?.[0]?.settings?.mentions,
        )?.spans,
      };
      try {
        const metadata = remapMentionMetadata(
          previous.body,
          data.source_text,
          previous.mentions === undefined ? undefined : { version: 1, spans: previous.mentions },
        );
        const annotated: Record<string, Record<string, PostTextValue>> = {
          ...annotatedRenditionEdits,
        };
        const textEdits = { ...renditionTextEdits };
        for (const rendition of data.renditions ?? []) {
          const next = mobileRenditionGeneratedText(
            contentSnapshot.current,
            rendition.social_account_id,
            rendition.body,
            textEdits[rendition.social_account_id],
            annotated[rendition.social_account_id],
          );
          textEdits[rendition.social_account_id] = next.textEdits;
          annotated[rendition.social_account_id] = next.annotated;
        }
        return {
          generated: data,
          key,
          canonical: { body: data.source_text, mentions: metadata?.spans },
          annotated,
          textEdits,
        };
      } catch {
        throw new Error(
          "The generated text changes a selected mention. Edit its mention choices before generating again.",
        );
      }
    },
    onSuccess: ({ generated, key, canonical, annotated, textEdits }, scope) => {
      if (!workspaceScopeIsCurrent(scope)) return;
      markEditorDirty();
      setBody(generated.source_text);
      setCanonicalTextEdits((current) => ({ ...current, [key]: canonical }));
      setAnnotatedRenditionEdits(annotated);
      setRenditionTextEdits(textEdits);
      setStatusMessage("Generated draft ready. Review it before you queue it.");
      setActionError(null);
      void successHaptic();
      if (!celebratedIdea.current) {
        celebratedIdea.current = true;
        setCelebrationTrigger((current) => current + 1);
      }
    },
    onError: (err, scope) => handleError(err, scope),
  });

  useEffect(() => {
    if (!buildOnOpen || autoBuildStarted.current || activeAccounts.size === 0) return;
    autoBuildStarted.current = true;
    generatePost.mutate(captureEditorMutationScope(id, originalActivity, originalCalendarEntry));
  }, [activeAccounts.size, buildOnOpen, generatePost, id, originalActivity, originalCalendarEntry]);

  function toggleAccount(accountId: string) {
    markEditorDirty();
    void selectionHaptic();
    setSelectedAccounts(() => {
      const next = new Set(activeAccounts);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
    setSelectedSocialSetId("");
    setSelectionTouched(true);
  }

  function applySocialSet(setId: string, accountIds: string[]) {
    markEditorDirty();
    void selectionHaptic();
    setSelectedAccounts(new Set(accountIds));
    setSelectedSocialSetId(setId);
    setSelectionTouched(true);
  }

  type LocalAttachmentInput = Pick<Attachment, "uri" | "mimeType" | "filename" | "size"> & {
    localId?: string;
  };

  function appendAttachments(items: LocalAttachmentInput[], focus?: () => void) {
    const sizeErrors = items.map((item) => attachmentSizeError(item));
    const validItems = items.filter((_, index) => !sizeErrors[index]);
    const firstSizeError = sizeErrors.find((message) => message !== null);
    if (firstSizeError) {
      setActionError(firstSizeError);
      void errorHaptic();
    }

    const available = MAX_MOBILE_ATTACHMENT_COUNT - attachments.length;
    if (available <= 0) {
      setActionError(`You can attach up to ${MAX_MOBILE_ATTACHMENT_COUNT} files.`);
      void errorHaptic();
      focus?.();
      return;
    }

    const accepted = validItems.slice(0, available);
    if (accepted.length < validItems.length) {
      setActionError(`You can attach up to ${MAX_MOBILE_ATTACHMENT_COUNT} files.`);
      void errorHaptic();
    }
    if (accepted.length === 0) {
      focus?.();
      return;
    }

    markEditorDirty();
    void selectionHaptic();
    void recordNativeFirstComposition("media");
    setAttachments((current) => [
      ...current,
      ...accepted.map((item, index) => ({
        ...item,
        localId: item.localId ?? `local-${current.length + index}-${item.uri}`,
        status: "local" as const,
        altText: "",
      })),
    ]);
    if (validItems.length === items.length && accepted.length === validItems.length) {
      setActionError(null);
    }
    focus?.();
  }

  function attachmentFromAsset(
    asset: ImagePicker.ImagePickerAsset,
    index = 0,
  ): LocalAttachmentInput {
    return {
      localId: `local-${asset.assetId ?? asset.uri}-${attachments.length + index}`,
      uri: asset.uri,
      mimeType: asset.mimeType ?? "image/jpeg",
      filename: asset.fileName ?? `photo-${index + 1}.jpg`,
      size: asset.fileSize ?? null,
    };
  }

  function addAttachment(asset: ImagePicker.ImagePickerAsset, index = 0) {
    appendAttachments([attachmentFromAsset(asset, index)]);
  }

  async function pickFromLibrary() {
    const result = await pickMedia({
      source: "library",
      mediaTypes: ["images", "videos"],
      multiple: true,
      limit: MAX_MOBILE_ATTACHMENT_COUNT,
    });
    if (!result.canceled) {
      appendAttachments(result.assets.map((asset, index) => attachmentFromAsset(asset, index)));
    }
  }

  async function takePhoto() {
    try {
      const result = await pickMedia({ source: "camera", mediaTypes: ["images"] });
      if (!result.canceled && result.assets[0]) {
        addAttachment(result.assets[0]);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not open the camera. Try again.");
      void errorHaptic();
    }
  }

  function removeAttachment(localId: string) {
    markEditorDirty();
    setAttachments((current) => current.filter((item) => item.localId !== localId));
  }

  function setAttachmentAlt(localId: string, altText: string) {
    markEditorDirty();
    setAttachments((current) =>
      current.map((item) => (item.localId === localId ? { ...item, altText } : item)),
    );
  }

  function moveAttachment(index: number, delta: -1 | 1) {
    markEditorDirty();
    setAttachments((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const isScheduled = pub.status === "scheduled" || pub.status === "publishing";

  function renderAccountAction(accountId: string, selected: boolean) {
    if (!selected) return null;
    return (
      <Button
        title={expandedAccount === accountId ? "Hide" : "Edit"}
        intent="quiet"
        onPress={() => setExpandedAccount(expandedAccount === accountId ? null : accountId)}
        style={styles.customizeButton}
      />
    );
  }

  function renderAccountNote(accountId: string) {
    const capability = effectiveReadinessByAccount[accountId];
    if (!capability || !destinationNeedsAttention(capability)) return null;
    return (
      <BodyText accessibilityRole="alert" numberOfLines={2} style={{ color: colors.error }}>
        {readinessSummary(capability)}
      </BodyText>
    );
  }

  function renderAccountOverrides(accountId: string) {
    if (expandedAccount !== accountId) return null;
    const platform = accounts.data?.find((account) => account.id === accountId)?.platform ?? "";
    return (
      <View style={{ gap: spacing.small }}>
        {(() => {
          const rendition = contentSnapshot.current.renditions?.find(
            (item) => item.social_account_id === accountId,
          );
          const profile =
            rendition?.output_profile ||
            effectiveReadinessByAccount[accountId]?.output_profile ||
            "";
          const images = rendition
            ? renditionImages(rendition)
            : [
                ...new Map(
                  (contentSnapshot.current.segments ?? [])
                    .flatMap((source) => source.media ?? [])
                    .filter((media) => media.mime_type?.startsWith("image/"))
                    .map((media) => [media.id, media]),
                ).values(),
              ];
          return images.map((media) => (
            <AccountImageFit
              key={`${accountId}:${profile}:${media.id}`}
              accountId={accountId}
              media={media}
              profile={profile}
              settings={rendition?.settings ?? {}}
              choice={imageChoices[`${accountId}:${media.id}`]}
              onChange={(choice) => {
                if (choice.selected || imageChoices[`${accountId}:${media.id}`]?.selected)
                  markEditorDirty();
                setImageChoices((current) => ({
                  ...current,
                  [`${accountId}:${media.id}`]: choice,
                }));
              }}
            />
          ));
        })()}

        {mobileRenditionTextFields(contentSnapshot.current, accountId).map(
          (field, index, fields) => (
            <View key={field.key} style={{ gap: spacing.extraSmall }}>
              {fields.length > 1 ? <BodyText>Text {index + 1}</BodyText> : null}
              <PostEditor
                value={
                  annotatedRenditionEdits[accountId]?.[field.key] ??
                  mobileRenditionTextValue(
                    contentSnapshot.current,
                    accountId,
                    field.key,
                    renditionTextEdits[accountId]?.[field.key] ?? field.value,
                  )
                }
                accountId={accountId}
                platform={platform}
                instanceURL={
                  accounts.data?.find((account) => account.id === accountId)?.instance_url
                }
                workspaceId={pub.workspace_id}
                label={`Custom text ${index + 1} for ${platformLabel(platform)}`}
                placeholder="Account version"
                onChange={(value) => {
                  markEditorDirty();
                  setAnnotatedRenditionEdits((current) => ({
                    ...current,
                    [accountId]: { ...current[accountId], [field.key]: value },
                  }));
                  setRenditionTextEdits((current) => ({
                    ...current,
                    [accountId]: { ...current[accountId], [field.key]: value.body },
                  }));
                }}
              />
            </View>
          ),
        )}
      </View>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.modalHeader, { borderBottomColor: colors.outlineVariant }]}>
        <Button title="Cancel" intent="quiet" onPress={() => router.back()} />
        <StatusBadge status={pub.status} />
        <Button
          title="Done"
          intent="quiet"
          loading={saveAndClose.isPending}
          accessibilityHint="Save draft and close the editor"
          onPress={() =>
            saveAndClose.mutate(
              captureEditorMutationScope(id, originalActivity, originalCalendarEntry),
            )
          }
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {(pub.renditions ?? []).flatMap((rendition) =>
          (rendition.segments ?? []).flatMap((segment) => {
            const requirement = attachmentRequirement(segment.settings);
            return requirement &&
              !(segment.media ?? []).some((media) =>
                media.mime_type.startsWith(`${requirement.kind}/`),
              )
              ? [
                  <ContentSection key={segment.id}>
                    <BodyText style={{ color: colors.onSurface }}>
                      {requirement.kind === "video" ? "Demo video needed" : "Image needed"}
                    </BodyText>
                    <BodyText>{requirement.brief}</BodyText>
                    <BodyText>Add it using Photos before publishing.</BodyText>
                  </ContentSection>,
                ]
              : [];
          }),
        )}
        {statusMessage ? (
          <ContentSection accessibilityRole="alert">
            <BodyText
              style={[
                typography.labelLarge,
                { color: colors.status.published, textAlign: "center" },
              ]}
            >
              {statusMessage}
            </BodyText>
          </ContentSection>
        ) : null}
        {actionError ? (
          <BodyText accessibilityRole="alert" style={{ color: colors.error }}>
            {actionError}
          </BodyText>
        ) : null}
        {refreshError ? (
          <QueryNotice
            message="Could not refresh this draft. You can keep editing this copy."
            retry={onRefreshPublication}
          />
        ) : null}
        {refreshPaused ? (
          <QueryNotice message="You are offline. You can keep editing the current draft." offline />
        ) : null}

        <DitherPanel style={{ backgroundColor: "transparent", borderWidth: 0, padding: 0 }}>
          <PostEditor
            workspaceId={pub.workspace_id}
            value={
              canonicalTextEdits[pub.segments?.[0]?.id ?? "first"] ?? {
                body,
                mentions: readMentionMetadata(body, pub.segments?.[0]?.settings?.mentions)?.spans,
              }
            }
            onChange={(value) => {
              markEditorDirty();
              setBody(value.body);
              setCanonicalTextEdits((current) => ({
                ...current,
                [pub.segments?.[0]?.id ?? "first"]: value,
              }));
              if (value.body.trim()) void recordNativeFirstComposition("text");
            }}
            label="Post text"
            placeholder="What do you want to say?"
            onImages={(images, focus) => appendAttachments(images, focus)}
          />
          {(pub.segments ?? []).slice(1).map((segment, index) => (
            <View key={segment.id} style={{ gap: spacing.extraSmall }}>
              <BodyText>Text {index + 2}</BodyText>
              <PostEditor
                workspaceId={pub.workspace_id}
                label={`Post text ${index + 2}`}
                placeholder="Add to the thread"
                value={
                  canonicalTextEdits[segment.id] ?? {
                    body: segment.body,
                    mentions: readMentionMetadata(segment.body, segment.settings?.mentions)?.spans,
                  }
                }
                onChange={(value) => {
                  markEditorDirty();
                  setCanonicalTextEdits((current) => ({ ...current, [segment.id]: value }));
                }}
              />
            </View>
          ))}

          <View style={styles.attachRow}>
            <Button
              title="Photos"
              icon="gallery"
              display="icon"
              intent="ordinary"
              onPress={() => void pickFromLibrary()}
            />
            <Button
              title="Camera"
              icon="camera"
              display="icon"
              intent="ordinary"
              onPress={() => void takePhoto()}
            />
            <Button
              title="AI assist"
              icon="sparkles"
              intent="ordinary"
              onPress={() =>
                generatePost.mutate(
                  captureEditorMutationScope(id, originalActivity, originalCalendarEntry),
                )
              }
              disabled={generatePost.isPending || activeAccounts.size === 0 || !body.trim()}
              loading={generatePost.isPending}
              style={{ flex: 1, minWidth: 96 }}
            />
          </View>
        </DitherPanel>

        <View style={styles.attachmentList}>
          {attachments.map((attachment, index) => (
            <View
              key={attachment.localId}
              style={[
                styles.attachmentRow,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.outlineVariant,
                },
              ]}
            >
              <View style={styles.thumbWrap}>
                {attachment.uri && attachment.mimeType.startsWith("image/") ? (
                  <MediaImage
                    uri={attachment.uri}
                    size="md"
                    style={styles.thumb}
                    contentFit="cover"
                  />
                ) : (
                  <View
                    style={[
                      styles.thumb,
                      styles.thumbPlaceholder,
                      { backgroundColor: colors.surfaceContainerHigh },
                    ]}
                  >
                    <ProtectedIcon
                      role={attachment.mimeType.startsWith("video/") ? "video" : "image"}
                      size={24}
                      tintColor={colors.onSurfaceVariant}
                    />
                  </View>
                )}
                {attachment.status === "uploading" ? (
                  <View
                    accessible
                    accessibilityLabel={`Uploading ${attachment.filename}`}
                    accessibilityRole="progressbar"
                    style={[styles.thumbOverlay, { backgroundColor: editor.mediaScrim }]}
                  >
                    <ActivityIndicator size="small" color={editor.canvasSelectionText} />
                  </View>
                ) : attachment.status === "error" ? (
                  <View
                    accessible
                    accessibilityLabel={`Upload failed for ${attachment.filename}`}
                    accessibilityRole="alert"
                    style={[styles.thumbOverlay, { backgroundColor: editor.mediaScrim }]}
                  >
                    <ProtectedIcon
                      role="warning"
                      size={18}
                      tintColor={editor.canvasSelectionText}
                    />
                  </View>
                ) : null}
              </View>
              <View style={styles.attachmentDetails}>
                <BodyText numberOfLines={1} style={{ color: colors.onSurface }}>
                  {attachment.filename}
                </BodyText>
                <TextField
                  value={attachment.altText}
                  onChangeText={(text) => setAttachmentAlt(attachment.localId, text)}
                  accessibilityLabel={`Alt text for ${attachment.filename}`}
                  placeholder="Describe this media for people who cannot see it"
                  multiline
                  textAlignVertical="top"
                  style={styles.altField}
                />
                <View style={styles.attachmentActions}>
                  {index > 0 ? (
                    <IconButton
                      label="Move attachment earlier"
                      role="back"
                      onPress={() => moveAttachment(index, -1)}
                    />
                  ) : null}
                  {index < attachments.length - 1 ? (
                    <IconButton
                      label="Move attachment later"
                      role="next"
                      onPress={() => moveAttachment(index, 1)}
                    />
                  ) : null}
                  <IconButton
                    label={`Remove ${attachment.filename}`}
                    role="delete"
                    color={colors.error}
                    onPress={() => removeAttachment(attachment.localId)}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose Social Set and destinations"
          onPress={() => setDestinationDrawerOpen(true)}
        >
          {({ pressed }) => (
            <ContentSection
              style={[
                styles.settingCard,
                {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.outlineVariant,
                },
                pressed && { opacity: 0.65 },
              ]}
            >
              <View style={styles.settingIcon}>
                <ThemeIcon role="account" size={22} tintColor={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[typography.titleMedium, { color: colors.onSurface }]}>
                  Social Set
                </Text>
                <BodyText numberOfLines={1}>
                  {selectedSetLabel(
                    socialSets.data ?? [],
                    activeSocialSetId,
                    activeAccounts.size,
                    attentionCount,
                  )}
                </BodyText>
              </View>
              <ThemeIcon role="disclosure" size={20} tintColor={colors.onSurfaceVariant} />
            </ContentSection>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose a custom publishing time"
          onPress={() => setScheduleDrawerOpen(true)}
        >
          {({ pressed }) => (
            <ContentSection
              style={[
                styles.settingCard,
                {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.outlineVariant,
                },
                pressed && { opacity: 0.65 },
              ]}
            >
              <View style={styles.settingIcon}>
                <ThemeIcon role="calendar" size={22} tintColor={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[typography.titleMedium, { color: colors.onSurface }]}>
                  Publish time
                </Text>
                <BodyText>
                  {scheduledAt
                    ? formatDateTime(scheduledAt.toISOString())
                    : "Use the next open slot"}
                </BodyText>
              </View>
              <ThemeIcon role="disclosure" size={20} tintColor={colors.onSurfaceVariant} />
            </ContentSection>
          )}
        </Pressable>

        <View style={styles.footer}>
          {pub.status !== "published" && pub.status !== "publishing" ? (
            <Button
              title="Publish now"
              intent="ordinary"
              onPress={() =>
                publishNow.mutate(
                  captureEditorMutationScope(id, originalActivity, originalCalendarEntry),
                )
              }
              disabled={publishNow.isPending || activeAccounts.size === 0}
            />
          ) : null}
          <Button
            title="Delete draft"
            intent="destructive"
            onPress={() =>
              Alert.alert("Delete draft?", "This cannot be undone.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () =>
                    deleteDraft.mutate(
                      captureEditorMutationScope(id, originalActivity, originalCalendarEntry),
                    ),
                },
              ])
            }
            disabled={deleteDraft.isPending}
          />
        </View>
      </ScrollView>
      {!isScheduled ? (
        <View
          style={[
            styles.stickyFooter,
            {
              backgroundColor: colors.background,
              borderTopColor: colors.outlineVariant,
            },
          ]}
        >
          <Button
            title="Queue next slot"
            intent="focal"
            onPress={() =>
              queueNextSlot.mutate(
                captureEditorMutationScope(id, originalActivity, originalCalendarEntry),
              )
            }
            disabled={queueNextSlot.isPending || activeAccounts.size === 0 || !body.trim()}
            loading={queueNextSlot.isPending}
            style={{ flex: 1 }}
          />
          <IconButton
            label="Choose publishing time"
            role="calendar"
            onPress={() => setScheduleDrawerOpen(true)}
          />
        </View>
      ) : null}

      {destinationDrawerOpen ? (
        <BottomDrawer open title="Social Set" onDismiss={() => setDestinationDrawerOpen(false)}>
          <DestinationChooser
            accounts={accounts}
            socialSets={socialSets}
            selectedIds={[...activeAccounts]}
            activeSetId={activeSocialSetId}
            renditions={pub.renditions}
            notice={
              effectiveReadinessError ? (
                <QueryNotice
                  message="Could not check destination readiness. You can keep editing."
                  retry={retryReadiness}
                  offline={accounts.fetchStatus === "paused" || socialSets.fetchStatus === "paused"}
                />
              ) : null
            }
            onApplySet={applySocialSet}
            onToggle={toggleAccount}
            onConfirm={() => setDestinationDrawerOpen(false)}
            rowAction={renderAccountAction}
            rowNote={renderAccountNote}
            expandedContent={renderAccountOverrides}
          />
        </BottomDrawer>
      ) : null}

      {scheduleDrawerOpen ? (
        <BottomDrawer open title="Publish time" onDismiss={() => setScheduleDrawerOpen(false)}>
          <ContentSection style={styles.scheduleCard}>
            <Text style={[typography.titleMedium, { color: colors.onSurface }]}>
              {scheduledAt ? formatDateTime(scheduledAt.toISOString()) : "Not scheduled"}
            </Text>
            <View style={styles.scheduleActions}>
              <Button
                title={pickerStep ? "Hide picker" : "Pick date and time"}
                intent="ordinary"
                onPress={() =>
                  setPickerStep((current) =>
                    current ? null : firstPickerStep(Platform.OS === "android" ? "android" : "ios"),
                  )
                }
              />
              <Button
                title="Use next slot"
                intent="ordinary"
                onPress={() =>
                  nextSlot.mutate(
                    captureEditorMutationScope(id, originalActivity, originalCalendarEntry),
                  )
                }
                loading={nextSlot.isPending}
              />
              {scheduledAt ? (
                <Button
                  title="Clear"
                  intent="quiet"
                  onPress={() => {
                    markEditorDirty();
                    setScheduledAt(null);
                  }}
                />
              ) : null}
            </View>
            {pickerStep ? (
              <DateTimePicker
                value={scheduledAt ?? nextHour()}
                mode={pickerStep}
                onChange={(event, date) => {
                  if (event.type !== "set" || !date) {
                    setPickerStep(null);
                    return;
                  }
                  const result = applyPickerValue(scheduledAt ?? nextHour(), date, pickerStep);
                  markEditorDirty();
                  setScheduledAt(result.value);
                  setPickerStep(result.nextStep);
                }}
              />
            ) : null}
          </ContentSection>
          <Button
            title="Schedule and queue"
            intent="focal"
            onPress={() =>
              scheduleMutation.mutate(
                captureEditorMutationScope(id, originalActivity, originalCalendarEntry),
              )
            }
            disabled={!scheduledAt || scheduleMutation.isPending || activeAccounts.size === 0}
            loading={scheduleMutation.isPending}
          />
        </BottomDrawer>
      ) : null}
      <CelebrationBurst trigger={celebrationTrigger} />
    </Screen>
  );
}

function nextHour(): Date {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return date;
}

function selectedSetLabel(
  sets: { id: string; name?: string | null }[],
  selectedSetId: string,
  accountCount: number,
  attentionCount = 0,
): string {
  const base = destinationSummaryLabel(
    sets.find((set) => set.id === selectedSetId)?.name,
    accountCount,
  );
  if (attentionCount <= 0) return base;
  return `${base} · ${attentionCount} need${attentionCount === 1 ? "s" : ""} attention`;
}

function readinessSummary(capability: ResolvedDestinationCapability): string {
  const messages = destinationIssueMessages(capability);
  if (messages.length === 0) return "Needs attention";
  const first = messages[0];
  return messages.length > 1 ? `${first} (+${messages.length - 1} more)` : first;
}

function publicationActivity(status: string): PublicationActivity {
  if (status === "scheduled" || status === "publishing") return "scheduled";
  if (status === "published") return "published";
  if (status === "failed") return "failed";
  return "draft";
}

const styles = StyleSheet.create({
  coldState: {
    paddingHorizontal: 20,
    paddingTop: 72,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: {
    padding: 16,
    gap: 12,
    paddingBottom: 120,
  },
  writingField: {
    minHeight: 168,
    paddingHorizontal: 0,
    paddingTop: 4,
  },
  attachRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  attachmentList: {
    gap: 8,
  },
  attachmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 80,
    padding: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  attachmentDetails: {
    flex: 1,
    gap: 2,
  },
  attachmentActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    minHeight: 48,
  },
  altField: {
    marginTop: 4,
    minHeight: 40,
  },
  thumbWrap: {
    width: 64,
    height: 64,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
  },
  thumbPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  thumbOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  overrideField: {
    marginTop: 4,
    minHeight: 112,
    paddingTop: 12,
  },
  customizeButton: {
    minHeight: 48,
    paddingHorizontal: 8,
  },
  settingCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 68,
  },
  settingIcon: {
    alignItems: "center",
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  scheduleCard: {
    gap: 10,
  },
  scheduleActions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  footer: {
    gap: 10,
    marginTop: 8,
  },
  stickyFooter: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    flexDirection: "row",
    gap: 10,
    left: 0,
    paddingBottom: 10,
    paddingHorizontal: 20,
    paddingTop: 10,
    position: "absolute",
    right: 0,
  },
});
