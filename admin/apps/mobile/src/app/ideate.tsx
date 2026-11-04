import { recordNativeFirstComposition } from "@/lib/telemetry/composition";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, ScrollView, Switch, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  publicationBuildQueryOptions,
  publicationBuildKeys,
  voiceProfilesQueryOptions,
} from "@openpost/query-catalog";
import { BodyText, Button, Card, ContentTitle, Screen, TextField } from "@/components/ui";
import { DelayedQueryPlaceholder, InitialQueryError } from "@/components/query-state";
import { BottomDrawer } from "@/components/bottom-drawer";
import { DestinationChooser } from "@/components/destination-chooser";
import { IdeateOption } from "@/components/ideate-option";
import {
  createIdeateAPI,
  buildIsRunning,
  type BuildRequest,
  type PostOption,
} from "@/lib/ideate/api";
import { ideateStorageKey, readIdeateBuild, rememberIdeateBuild } from "@/lib/ideate/storage";
import {
  useAccounts,
  useSocialSets,
  useWorkspaceId,
  useWorkspaceCapabilities,
  prefetchPublicationEditor,
} from "@/lib/queries";
import { captureApiRequestIdentity, apiRequestIdentityIsCurrent } from "@/lib/api/client";
import {
  applySocialSetSelection,
  destinationSummaryLabel,
  reconcileDestinationSelection,
} from "@/lib/destination-selection";
import { invalidatePublicationData } from "@/lib/query-cache";
import {
  MAX_MOBILE_ATTACHMENT_COUNT,
  ORIGINAL_IMAGE_QUALITY,
  uploadAttachment,
  type PendingAttachment,
} from "@/lib/media";
import { takePendingAttachments } from "@/lib/share";
import { useNativeTheme } from "@/theme";

export default function IdeateScreen() {
  const workspaceId = useWorkspaceId();
  const workspace = useWorkspaceCapabilities();
  if (!workspace?.can_edit)
    return (
      <Screen>
        <BodyText>This Workspace is read-only for your role.</BodyText>
      </Screen>
    );
  return workspaceId ? (
    <IdeateWorkspace key={workspaceId} workspaceId={workspaceId} />
  ) : (
    <Screen>
      <BodyText>Select a Workspace first.</BodyText>
    </Screen>
  );
}

function IdeateWorkspace({ workspaceId }: { workspaceId: string }) {
  const params = useLocalSearchParams<{
    idea?: string;
    build?: string;
    attachments?: string;
  }>();
  const { colors, spacing } = useNativeTheme().manifest;
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const sets = useSocialSets();
  const service = useMemo(() => createIdeateAPI(), []);
  const voices = useQuery(voiceProfilesQueryOptions(service, workspaceId));
  const storageKey = useMemo(() => ideateStorageKey(workspaceId), [workspaceId]);
  const [buildId, setBuildId] = useState(params.build ?? "");
  const [restoring, setRestoring] = useState(
    !(params.build || params.idea || params.attachments === "1"),
  );
  const [idea, setIdea] = useState(params.idea ?? "");
  const [notes, setNotes] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [destinationsOpen, setDestinationsOpen] = useState(false);
  const [socialSetId, setSocialSetId] = useState("");
  const [selected, setSelected] = useState<string[] | null>(null);
  const [assets, setAssets] = useState<{ id: string; name: string; mayPublish: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [selectingId, setSelectingId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [editingBuildId, setEditingBuildId] = useState<string | null>(null);
  const hydrated = useRef("");
  const controller = useRef<AbortController | null>(null);
  const mutation = useRef(false);
  const creation = useRef({ fingerprint: "", key: "" });
  const [initialAttachments] = useState(() =>
    params.attachments === "1" ? takePendingAttachments() : [],
  );
  const mounted = useRef(true);
  const buildQuery = useQuery({
    ...publicationBuildQueryOptions(service, workspaceId, buildId),
    refetchInterval: (query) => (buildIsRunning(query.state.data) ? 1200 : false),
  });
  const build = buildQuery.data;
  const editingIdea =
    !(build?.state === "ready" || build?.state === "committed") || editingBuildId === build.id;
  const { refetch: refetchBuild } = buildQuery;
  const running = buildIsRunning(build);
  const defaultSet = sets.data?.find((set) => set.is_default) ?? sets.data?.[0];
  const effectiveSet = socialSetId ? sets.data?.find((set) => set.id === socialSetId) : defaultSet;
  // The full selection in the order the user chose, including set members
  // whose account is gone. The drawer renders those as explicit, removable
  // rows; only publishable ids reach the build request.
  const fullSelection: string[] =
    selected ??
    (effectiveSet
      ? applySocialSetSelection(effectiveSet.accounts ?? [])
      : (accounts.data?.map((account) => account.id) ?? []));
  const accountIds =
    accounts.data === undefined
      ? fullSelection
      : reconcileDestinationSelection(fullSelection, accounts.data).selectable;
  const summarySetName =
    selected === null
      ? effectiveSet?.name
      : (sets.data?.find((set) => set.id === socialSetId)?.name ?? null);
  const disabled = busy || uploading || running || restoring;
  const options = build?.state === "ready" ? (build.result?.options ?? []) : [];

  useEffect(() => {
    let active = true;
    if (params.idea || params.build || params.attachments === "1") return;
    void readIdeateBuild(storageKey)
      .then((id) => {
        if (active && id) setBuildId(id);
      })
      .catch(() => {
        if (active) setError("Could not restore your last build.");
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [params.idea, params.build, params.attachments, storageKey]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && buildId) void refetchBuild();
    });
    return () => subscription.remove();
  }, [buildId, refetchBuild]);
  useEffect(() => {
    if (!build || hydrated.current === build.id) return;
    hydrated.current = build.id;
    setIdea(build.input.idea);
    setNotes(build.input.sources?.find((source) => source.id === "context:notes")?.text ?? "");
    setSelected((build.input.destinations ?? []).map((destination) => destination.account_id));
    setSocialSetId(build.social_set_id ?? "");
    setVoiceId(build.voice_profile_id ?? "");
    setAssets(
      (build.assets ?? []).map((asset) => ({
        id: asset.media_id,
        name: "Attached context",
        mayPublish: asset.may_publish,
      })),
    );
  }, [build]);

  async function action(run: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
    if (mutation.current) return;
    mutation.current = true;
    const identity = captureApiRequestIdentity();
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    const current = () => !abort.signal.aborted && apiRequestIdentityIsCurrent(identity);
    setBusy(true);
    setError("");
    try {
      await run(abort.signal, current);
    } catch (cause) {
      if (current())
        setError(
          cause instanceof Error ? cause.message : "This action could not finish. Try again.",
        );
    } finally {
      mutation.current = false;
      if (current()) {
        setBusy(false);
        setSelectingId("");
      }
    }
  }
  async function attach(files?: PendingAttachment[]) {
    if (disabled && !files) return;
    const identity = captureApiRequestIdentity();
    const current = () => mounted.current && apiRequestIdentityIsCurrent(identity);
    setUploading(true);
    setError("");
    try {
      if (!files) {
        const selection = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images", "videos"],
          allowsMultipleSelection: true,
          selectionLimit: Math.max(1, MAX_MOBILE_ATTACHMENT_COUNT - assets.length),
          quality: ORIGINAL_IMAGE_QUALITY,
        });
        files = selection.canceled
          ? []
          : selection.assets.map((asset, i) => ({
              localId: `${Date.now()}-${i}`,
              uri: asset.uri,
              mimeType: asset.mimeType ?? (asset.type === "video" ? "video/mp4" : "image/jpeg"),
              filename: asset.fileName ?? `attachment-${i}`,
              size: asset.fileSize ?? null,
            }));
      }
      for (const file of files.slice(0, MAX_MOBILE_ATTACHMENT_COUNT - assets.length)) {
        if (!current()) return;
        const id = await uploadAttachment(file, { workspaceId });
        if (!current()) return;
        setAssets((previous) => [...previous, { id, name: file.filename, mayPublish: false }]);
      }
    } catch (cause) {
      if (current())
        setError(cause instanceof Error ? cause.message : "Could not attach this file.");
    } finally {
      if (current()) setUploading(false);
    }
  }
  const importAttachments = useEffectEvent(attach);
  useEffect(() => {
    if (initialAttachments.length) {
      // The attachment handoff is an external picker result, imported once on entry.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void importAttachments(initialAttachments);
    }
  }, [initialAttachments]);
  async function accept(next: Awaited<ReturnType<typeof service.create>>) {
    queryClient.setQueryData(publicationBuildKeys.detail(workspaceId, next.id), next);
    hydrated.current = next.id;
    setEditingBuildId(null);
    setBuildId(next.id);
    await rememberIdeateBuild(storageKey, next.id);
  }
  function generate() {
    if (disabled || !idea.trim() || !accountIds.length || accounts.isError || sets.isError) return;
    void action(async (signal, current) => {
      const request: BuildRequest = {
        workspace_id: workspaceId,
        idea: idea.trim(),
        option_count: 4,
        account_ids: accountIds,
        social_set_id: (selected === null ? effectiveSet?.id : socialSetId) || undefined,
        voice_profile_id: voiceId || undefined,
        context_notes: notes.trim() || undefined,
        destination_policy: "require_all",
        assets: assets.map((asset) => ({
          media_id: asset.id,
          role: "context",
          may_publish: asset.mayPublish,
        })),
      };
      const fingerprint = JSON.stringify(request);
      if (
        fingerprint !== creation.current.fingerprint ||
        build?.state === "ready" ||
        build?.state === "committed" ||
        build?.state === "cancelled"
      )
        creation.current = {
          fingerprint,
          key: `mobile-ideate-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        };
      const next = await service.create(request, creation.current.key, signal);
      if (current()) await accept(next);
    });
  }
  function openDraft(id: string) {
    router.push({ pathname: "/publications/[id]", params: { id } });
  }
  function choose(
    option: PostOption,
    render: (current: () => boolean) => Promise<{ account_id: string; media_id: string }[]>,
  ) {
    if (!build || disabled || mutation.current) return;
    setSelectingId(option.id);
    void action(async (signal, current) => {
      const media = await render(current);
      if (!current()) return;
      const result = await service.commit(build.id, build.revision, option, media, signal);
      if (!current()) return;
      void recordNativeFirstComposition("content_mode");
      await accept(await service.get(workspaceId, build.id, signal));
      if (!current()) return;
      await invalidatePublicationData(queryClient, {
        workspaceId,
        publicationId: result.publication_id,
        activities: ["draft"],
      });
      await prefetchPublicationEditor(queryClient, workspaceId, result.publication_id);
      if (current()) openDraft(result.publication_id);
    });
  }
  const progress =
    build?.phase === "sources"
      ? "Reading your context…"
      : build?.phase === "directing"
        ? "Choosing four treatments…"
        : build?.phase === "reviewing"
          ? "Reviewing the posts…"
          : "Writing four posts…";
  return (
    <Screen safeTop={false}>
      <Stack.Screen
        options={{
          title: "Ideate",
          headerShown: true,
          headerBackTitle: "Back",
        }}
      />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.large,
          gap: spacing.large,
          paddingBottom: spacing.extraLarge,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <BodyText accessibilityRole="alert" style={{ color: colors.error }}>
            {error}
          </BodyText>
        ) : null}
        {accounts.isPending || sets.isPending || restoring || (buildId && buildQuery.isPending) ? (
          <DelayedQueryPlaceholder pending shape="editor" />
        ) : null}
        {accounts.isError || sets.isError ? (
          <InitialQueryError
            title="Could not load destinations"
            message="Check your connection and try again."
            retry={() => {
              void accounts.refetch();
              void sets.refetch();
            }}
          />
        ) : null}
        {buildQuery.isError ? (
          <InitialQueryError
            title="Could not load these posts"
            message={
              buildQuery.error instanceof Error
                ? buildQuery.error.message
                : "Check your connection and try again."
            }
            retry={() => void buildQuery.refetch()}
          />
        ) : null}
        {editingIdea ? (
          <View style={{ gap: spacing.medium }}>
            <ContentTitle>What do you want to post about?</ContentTitle>
            <TextField
              value={idea}
              onChangeText={setIdea}
              editable={!disabled}
              multiline
              textAlignVertical="top"
              placeholder="An idea, a point, or something you just shipped…"
              accessibilityLabel="Your idea"
              style={{ minHeight: 136 }}
              maxLength={12000}
            />
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: spacing.small,
              }}
            >
              <Button
                title={uploading ? "Attaching…" : "Attach"}
                icon="gallery"
                intent="ordinary"
                onPress={() => void attach()}
                disabled={disabled || assets.length >= MAX_MOBILE_ATTACHMENT_COUNT}
              />
              <Button
                title={destinationSummaryLabel(summarySetName, fullSelection.length)}
                intent="ordinary"
                onPress={() => setDestinationsOpen(true)}
                disabled={disabled}
              />
            </View>
            {!accountIds.length && accounts.data ? (
              <BodyText>Select at least one account.</BodyText>
            ) : null}
            {assets.map((asset) => (
              <View key={asset.id} style={{ gap: spacing.small }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.small,
                  }}
                >
                  <BodyText style={{ flex: 1 }}>{asset.name}</BodyText>
                  <Button
                    title={`Remove ${asset.name}`}
                    intent="quiet"
                    onPress={() =>
                      setAssets((previous) => previous.filter((item) => item.id !== asset.id))
                    }
                    disabled={disabled}
                  />
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.small,
                  }}
                >
                  <BodyText style={{ flex: 1 }}>May appear in a post</BodyText>
                  <Switch
                    accessibilityLabel={`Allow ${asset.name} in a post`}
                    disabled={disabled}
                    value={asset.mayPublish}
                    onValueChange={(mayPublish) =>
                      setAssets((previous) =>
                        previous.map((item) =>
                          item.id === asset.id ? { ...item, mayPublish } : item,
                        ),
                      )
                    }
                  />
                </View>
              </View>
            ))}
            <Button
              title="Voice and context"
              intent="quiet"
              accessibilityState={{ expanded: contextOpen }}
              onPress={() => setContextOpen((value) => !value)}
              disabled={disabled}
            />
            {contextOpen ? (
              <View style={{ gap: spacing.small }}>
                <Button
                  title={`Voice: ${voices.data?.find((voice) => voice.id === voiceId)?.name ?? "Account defaults"}`}
                  intent="ordinary"
                  onPress={() => setVoiceOpen(true)}
                  disabled={disabled}
                />
                {voices.isError ? (
                  <BodyText>Voice choices could not load. Account defaults still apply.</BodyText>
                ) : null}
                <TextField
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  editable={!disabled}
                  accessibilityLabel="Extra context"
                  placeholder="Extra context or direction, optional"
                />
              </View>
            ) : null}
            <Button
              title="Give me four posts"
              icon="sparkles"
              intent="focal"
              onPress={generate}
              disabled={
                disabled || !idea.trim() || !accountIds.length || accounts.isError || sets.isError
              }
              loading={busy}
            />
          </View>
        ) : (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.small,
            }}
          >
            <BodyText numberOfLines={2} style={{ flex: 1 }}>
              {idea}
            </BodyText>
            <Button
              title="Edit idea"
              intent="quiet"
              style={{ width: 112 }}
              onPress={() => setEditingBuildId(build?.id ?? null)}
              disabled={disabled}
            />
          </View>
        )}
        {running ? (
          <Card style={{ gap: spacing.small }} accessibilityLiveRegion="polite">
            <ActivityIndicator color={colors.primary} />
            <BodyText>{progress}</BodyText>
            <Button
              title="Cancel generation"
              intent="quiet"
              disabled={busy}
              onPress={() =>
                void action(async (signal, current) => {
                  const next = await service.cancel(buildId, signal);
                  if (current()) await accept(next);
                })
              }
            />
          </Card>
        ) : null}
        {build?.state === "failed" ? (
          <Card style={{ gap: spacing.small }}>
            <BodyText accessibilityRole="alert">
              {build.error_message || "These posts could not be generated."}
            </BodyText>
            <Button
              title="Retry generation"
              onPress={() =>
                void action(async (signal, current) => {
                  const next = await service.retry(buildId, signal);
                  if (current()) await accept(next);
                })
              }
              disabled={busy}
            />
          </Card>
        ) : null}
        {build?.state === "committed" && build.publication_id ? (
          <Button title="Open draft" onPress={() => openDraft(build.publication_id!)} />
        ) : null}
        {options.length ? (
          <View style={{ gap: spacing.large }}>
            <BodyText>Choose a post. You can edit it before publishing.</BodyText>
            {options.map((option) => (
              <IdeateOption
                key={option.id}
                workspaceId={workspaceId}
                option={option}
                selecting={selectingId === option.id}
                sources={build?.result?.sources ?? []}
                busy={disabled}
                onUse={choose}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
      <BottomDrawer
        open={destinationsOpen}
        title="Social Set"
        onDismiss={() => setDestinationsOpen(false)}
      >
        <DestinationChooser
          accounts={accounts}
          socialSets={sets}
          selectedIds={fullSelection}
          activeSetId={selected === null ? (effectiveSet?.id ?? "") : socialSetId}
          onApplySet={(setId, accountIds) => {
            setSocialSetId(setId);
            setSelected([...new Set(accountIds)]);
          }}
          onToggle={(accountId) => {
            setSocialSetId("");
            setSelected(
              fullSelection.includes(accountId)
                ? fullSelection.filter((id) => id !== accountId)
                : [...fullSelection, accountId],
            );
          }}
          onConfirm={() => setDestinationsOpen(false)}
        />
      </BottomDrawer>
      <BottomDrawer open={voiceOpen} title="Voice" onDismiss={() => setVoiceOpen(false)}>
        <View style={{ gap: spacing.small }}>
          <Button
            title="Account defaults"
            intent="ordinary"
            onPress={() => {
              setVoiceId("");
              setVoiceOpen(false);
            }}
          />
          {(voices.data ?? []).map((voice) => (
            <Button
              key={voice.id}
              title={voice.name}
              intent="ordinary"
              onPress={() => {
                setVoiceId(voice.id);
                setVoiceOpen(false);
              }}
            />
          ))}
        </View>
      </BottomDrawer>
    </Screen>
  );
}
