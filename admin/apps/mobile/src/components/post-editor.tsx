import {
  rememberMentionClipboardTargets,
  knownMentionClipboardTarget,
} from "@/lib/mention-clipboard";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useDrawerInputSpace } from "@/components/bottom-drawer";
import { EnrichedTextInput, type EnrichedTextInputInstance } from "react-native-enriched-html";
import { nativePostHTML, nativePostValue, nativePostTextChange } from "@/lib/post-editor-value";
import type { PostTextValue, MentionCandidate } from "@openpost/platform-text/mentions";
import { useQuery } from "@tanstack/react-query";
import {
  mentionLookupQueryOptions,
  savedMentionsQueryOptions,
  OpenPostQueryError,
} from "@openpost/query-catalog";
import { nativeMentionLookupAPI, nativeSavedMentionAPI } from "@/lib/mention-lookup";
import { BodyText, Button } from "@/components/ui";
import { useNativeTheme } from "@/theme";
import type { PendingAttachment } from "@/lib/media";

export function PostEditor({
  value,
  onChange,
  accountId,
  platform,
  instanceURL,
  workspaceId = "",
  label,
  placeholder,
  onImages,
  disabled = false,
}: {
  workspaceId?: string;
  value: PostTextValue;
  onChange: (value: PostTextValue) => void;
  accountId?: string;
  platform?: string;
  instanceURL?: string;
  label: string;
  placeholder: string;
  onImages?: (images: PendingAttachment[], focus: () => void) => void;
  disabled?: boolean;
}) {
  const reserveInputSpace = useDrawerInputSpace();
  const theme = useNativeTheme();
  const { colors, typography, spacing } = theme.manifest;
  const input = useRef<EnrichedTextInputInstance>(null);
  const emitted = useRef(value);
  const confirmed = useRef(value);
  const [initial] = useState(() => nativePostHTML(value));
  const plain = useRef(value.body);
  const selection = useRef({ start: 0, end: 0 });
  const allowed = useRef(
    new Set((value.mentions ?? []).map((span) => JSON.stringify([span.target, span.text]))),
  );
  const [query, setQuery] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [debounced, setDebounced] = useState("");
  const libraryMode = !accountId && !!workspaceId;
  const supported =
    libraryMode || (!!accountId && ["bluesky", "mastodon", "linkedin"].includes(platform ?? ""));
  useEffect(() => {
    rememberMentionClipboardTargets(workspaceId, value.mentions ?? []);
  }, [value, workspaceId]);
  function emit(next: PostTextValue) {
    if (JSON.stringify(emitted.current) === JSON.stringify(next)) return;
    emitted.current = next;
    onChange(next);
  }
  useEffect(() => {
    const sameVisual =
      JSON.stringify({ body: value.body, mentions: value.mentions ?? [] }) ===
      JSON.stringify({ body: emitted.current.body, mentions: emitted.current.mentions ?? [] });
    emitted.current = value;
    confirmed.current = value;
    plain.current = value.body;
    value.mentions?.forEach((span) =>
      allowed.current.add(JSON.stringify([span.target, span.text])),
    );
    if (!sameVisual) input.current?.setValue(nativePostHTML(value));
  }, [value, workspaceId]);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query ?? ""), 180);
    return () => clearTimeout(timer);
  }, [query]);
  const showingSuggestions = supported && query !== null && (libraryMode || query.length >= 2);
  useEffect(() => {
    if (!showingSuggestions) reserveInputSpace(0);
    return () => reserveInputSpace(0);
  }, [showingSuggestions, reserveInputSpace]);
  const search = useQuery({
    ...mentionLookupQueryOptions(nativeMentionLookupAPI, workspaceId, accountId ?? "", debounced),
    enabled:
      !libraryMode &&
      supported &&
      query !== null &&
      query === debounced &&
      query.trim().length >= 2,
  });
  const library = useQuery({
    ...savedMentionsQueryOptions(nativeSavedMentionAPI, workspaceId),
    enabled: libraryMode && query !== null,
  });
  const active = query === debounced;
  const candidates: MentionCandidate[] = libraryMode
    ? (library.data ?? [])
        .filter((entry) =>
          [entry.name, ...entry.profiles.map((profile) => profile.text)].some((text) =>
            text.toLocaleLowerCase().includes((query ?? "").toLocaleLowerCase()),
          ),
        )
        .map((entry) => ({
          label: entry.name,
          detail: entry.profiles.map((profile) => profile.text).join(" · "),
          target: {
            provider: "workspace",
            kind: "profile",
            id: entry.id,
            profiles: entry.profiles,
          },
        }))
    : active
      ? (search.data?.candidates ?? [])
      : [];
  const loading = libraryMode
    ? library.isFetching
    : query !== null && query.trim().length >= 2 && (!active || search.isFetching);
  const lookupError =
    active && search.error
      ? search.error instanceof OpenPostQueryError && search.error.status === 403
        ? "The provider has not granted mention search access. Check the account and app permissions."
        : search.error instanceof OpenPostQueryError && search.error.status === 429
          ? "Mention search is rate limited. Try again later."
          : "Could not search mentions. Try again."
      : null;
  const error =
    editorError ??
    (libraryMode && library.error ? "Could not load saved mentions. Try again." : lookupError);
  return (
    <View style={{ gap: spacing.extraSmall }}>
      <EnrichedTextInput
        ref={input}
        defaultValue={initial}
        accessibilityLabel={label}
        accessible={true}
        editable={!disabled}
        placeholder={placeholder}
        placeholderTextColor={colors.onSurfaceVariant}
        cursorColor={colors.primary}
        selectionColor={colors.primaryContainer}
        mentionIndicators={["@"]}
        linkRegex={null}
        textShortcuts={[]}
        scrollEnabled={false}
        style={{
          minHeight: 88,
          color: colors.onSurface,
          fontSize: typography.bodyLarge.fontSize,
          fontFamily: typography.bodyLarge.fontFamily,
          paddingVertical: spacing.small,
        }}
        htmlStyle={{
          mention: {
            color: colors.primary,
            backgroundColor: colors.primaryContainer,
            textDecorationLine: "none",
          },
        }}
        onStartMention={() => {
          if (supported) setQuery("");
        }}
        onChangeMention={({ text }) => {
          if (supported) setQuery(text);
        }}
        onEndMention={() => setQuery(null)}
        onBlur={() => setQuery(null)}
        onChangeSelection={({ nativeEvent }) => {
          selection.current = {
            start: nativeEvent.start,
            end: nativeEvent.end,
          };
        }}
        onChangeText={({ nativeEvent }) => {
          plain.current = nativeEvent.value;
          const next = nativePostTextChange(emitted.current, nativeEvent.value);
          emit(next);
        }}
        onChangeHtml={({ nativeEvent }) => {
          try {
            const parsed = nativePostValue(nativeEvent.value, plain.current, {
              platform,
              authority: instanceURL,
            });
            if (
              parsed.mentions.some(
                (span) =>
                  !allowed.current.has(JSON.stringify([span.target, span.text])) &&
                  !knownMentionClipboardTarget(workspaceId, span),
              )
            )
              throw new Error("unknown_mention");
            const next = parsed;
            const authored =
              next.mentions.length > 0 || emitted.current.mentions !== undefined
                ? next
                : { body: next.body };
            confirmed.current = authored;
            emit(authored);
            setEditorError(null);
            if (
              /<(?!\/?(?:html|p|br|mention)(?:[\s>\/]))[A-Za-z]/i.test(nativeEvent.value) ||
              next.mentions.length !== parsed.mentions.length
            ) {
              input.current?.setValue(nativePostHTML(next));
              input.current?.setSelection(selection.current.start, selection.current.end);
            }
          } catch (error) {
            const before = confirmed.current;
            plain.current = before.body;
            emit(before);
            input.current?.setValue(nativePostHTML(before));
            setEditorError(
              error instanceof Error && error.message === "mention_limit"
                ? "A post can include at most 50 selected mentions."
                : "Choose mentions for this account, or paste plain text.",
            );
          }
        }}
        onPasteImages={({ nativeEvent }) => {
          if (!onImages) return;
          const images = nativeEvent.images.map((image, index) => ({
            localId: `paste-${Date.now()}-${index}`,
            uri: image.uri,
            mimeType: image.type || "image/png",
            filename: `pasted-image-${index}.png`,
            size: null,
          }));
          onImages(images, () => input.current?.focus());
        }}
      />
      {supported && platform === "linkedin" ? (
        <BodyText>Type @ followed by the exact company page vanity name.</BodyText>
      ) : null}
      {editorError && query === null ? (
        <BodyText accessibilityRole="alert" style={{ color: colors.error }}>
          {editorError}
        </BodyText>
      ) : null}
      {showingSuggestions ? (
        <View
          onLayout={(event) => reserveInputSpace(event.nativeEvent.layout.height)}
          accessibilityLabel="Mention suggestions"
          style={{ gap: spacing.extraSmall }}
        >
          {loading ? <BodyText accessibilityLiveRegion="polite">Searching…</BodyText> : null}
          {error ? (
            <>
              <BodyText accessibilityRole="alert" style={{ color: colors.error }}>
                {error}
              </BodyText>
              <Button
                title="Try again"
                intent="quiet"
                onPress={() => {
                  setEditorError(null);
                  if (libraryMode) void library.refetch();
                  else void search.refetch();
                }}
              />
            </>
          ) : null}
          {!loading && !error && !candidates.length ? (
            <BodyText>No matching accounts</BodyText>
          ) : null}
          <ScrollView
            style={{ maxHeight: 240 }}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            {candidates.map((candidate) => (
              <Pressable
                key={candidate.target.id}
                accessibilityRole="button"
                accessibilityLabel={`${candidate.label}, ${candidate.detail}`}
                onPress={() => {
                  if ((emitted.current.mentions?.length ?? 0) >= 50) {
                    setEditorError("A post can include at most 50 selected mentions.");
                    return;
                  }
                  allowed.current.add(JSON.stringify([candidate.target, candidate.label]));
                  rememberMentionClipboardTargets(workspaceId, [
                    {
                      start: 0,
                      end: new TextEncoder().encode(candidate.label).length,
                      text: candidate.label,
                      target: candidate.target,
                    },
                  ]);
                  input.current?.setMention("@", candidate.label, {
                    identity: encodeURIComponent(JSON.stringify(candidate.target)),
                  });
                  setQuery(null);
                }}
                style={({ pressed }) => ({
                  minHeight: 44,
                  paddingVertical: spacing.small,
                  opacity: pressed ? 0.65 : 1,
                })}
              >
                <BodyText style={{ color: colors.primary }}>{candidate.label}</BodyText>
                {candidate.detail ? <BodyText>{candidate.detail}</BodyText> : null}
              </Pressable>
            ))}
          </ScrollView>
          <Button title="Dismiss suggestions" intent="quiet" onPress={() => setQuery(null)} />
        </View>
      ) : null}
    </View>
  );
}
