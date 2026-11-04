import { useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Card, BodyText, Button, ContentTitle } from "./ui";
import { MediaImage } from "./media-image";
import { IdeateVisual } from "./ideate-visual";
import { type ExportVisual, saveIdeateVisual } from "@/lib/ideate/visual";
import type { components } from "@openpost/api-contract";
import type { PostOption } from "@/lib/ideate/api";
import { useNativeTheme } from "@/theme";
import { platformLabel } from "@/lib/format";

export function IdeateOption({
  option,
  workspaceId,
  busy,
  selecting,
  sources,
  onUse,
}: {
  option: PostOption;
  workspaceId: string;
  busy: boolean;
  selecting: boolean;
  sources: readonly components["schemas"]["ResolvedSource"][];
  onUse: (
    option: PostOption,
    render: (current: () => boolean) => Promise<{ account_id: string; media_id: string }[]>,
  ) => void;
}) {
  const { spacing, colors } = useNativeTheme().manifest;
  const [renderAttempt, setRenderAttempt] = useState(0);
  const [renderError, setRenderError] = useState("");
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [ready, setReady] = useState<Set<string>>(new Set());
  const exporters = useRef(new Map<string, ExportVisual>());
  const saved = useRef(new Map<string, string>());
  const destinations = useMemo(() => option.destinations ?? [], [option.destinations]);
  const primary = destinations.find((destination) => destination.media.document) ?? destinations[0];
  const recipes = useMemo(
    () => [
      ...new Map(
        destinations.flatMap((destination) =>
          destination.media.document
            ? [[JSON.stringify(destination.media.document), destination.media.document] as const]
            : [],
        ),
      ).entries(),
    ],
    [destinations],
  );
  const primaryText =
    primary?.segments?.map((segment) => segment.body).join("\n\n") ?? option.canonical_text;
  const variants = destinations.filter(
    (destination) =>
      destination.account_id !== primary?.account_id &&
      (destination.segments?.map((segment) => segment.body).join("\n\n") !== primaryText ||
        JSON.stringify(destination.media) !== JSON.stringify(primary?.media)),
  );
  const needed = destinations.filter(
    (destination) =>
      destination.media.treatment === "attach_video" ||
      destination.media.treatment === "attach_image",
  );
  async function render(current: () => boolean) {
    const media: { account_id: string; media_id: string }[] = [];
    for (const destination of destinations) {
      const document = destination.media.document;
      if (!document) continue;
      const key = JSON.stringify(document);
      let id = saved.current.get(key);
      if (!id) {
        const exporter = exporters.current.get(key);
        if (!exporter) throw new Error("A visual is not ready. Try its retry action first.");
        const visual = await exporter();
        id = await saveIdeateVisual(workspaceId, visual, destination.media.alt_text ?? "", current);
        saved.current.set(key, id);
      }
      media.push({ account_id: destination.account_id, media_id: id });
    }
    return media;
  }
  return (
    <Card style={{ gap: spacing.medium }}>
      <ContentTitle>{option.label}</ContentTitle>
      {primaryText ? (
        <BodyText selectable style={{ color: colors.onSurface }}>
          {primaryText}
        </BodyText>
      ) : null}
      {recipes.map(([key, document], index) => (
        <View
          key={`${key}:${renderAttempt}`}
          accessibilityElementsHidden={index > 0 && !versionsOpen}
          importantForAccessibility={index > 0 && !versionsOpen ? "no-hide-descendants" : "auto"}
          collapsable={false}
          pointerEvents={index === 0 || versionsOpen ? "auto" : "none"}
          style={
            index === 0 || versionsOpen
              ? undefined
              : { position: "absolute", left: -10000, width: 540, opacity: 0 }
          }
        >
          {index > 0 && versionsOpen ? (
            <View style={{ gap: spacing.small }}>
              <ContentTitle>
                {platformLabel(
                  destinations.find(
                    (destination) => JSON.stringify(destination.media.document) === key,
                  )?.platform ?? "",
                )}
              </ContentTitle>
              <BodyText>
                {destinations
                  .find((destination) => JSON.stringify(destination.media.document) === key)
                  ?.segments?.map((segment) => segment.body)
                  .join("\n\n") || "Visual only"}
              </BodyText>
            </View>
          ) : null}
          <IdeateVisual
            document={document}
            workspaceId={workspaceId}
            altText={primary?.media.alt_text}
            onError={setRenderError}
            onReady={(exporter) => {
              if (exporter) exporters.current.set(key, exporter);
              else exporters.current.delete(key);
              setReady((previous) => {
                const next = new Set(previous);
                if (exporter) next.add(key);
                else next.delete(key);
                return next;
              });
            }}
          />
        </View>
      ))}
      {primary?.media.treatment === "use_source" &&
      primary.media.source_ref?.startsWith("media:") ? (
        <View style={{ gap: spacing.small }}>
          {sources
            .find((source) => source.id === primary.media.source_ref)
            ?.mime_type?.startsWith("image/") ? (
            <MediaImage
              uri={`/media/${primary.media.source_ref.slice(6)}`}
              style={{ width: "100%", aspectRatio: 1 }}
              contentFit="contain"
              accessibilityLabel={primary.media.alt_text || "Attached source"}
            />
          ) : (
            <BodyText>
              {sources.find((source) => source.id === primary.media.source_ref)?.label ||
                "Attached media"}
              {"\n"}
              {primary.media.brief}
            </BodyText>
          )}
        </View>
      ) : null}
      {[
        ...new Set(
          needed.map(
            (destination) =>
              `${destination.media.treatment === "attach_video" ? "Demo video needed" : "Image needed"}\n${destination.media.brief}`,
          ),
        ),
      ].map((requirement) => (
        <BodyText key={requirement}>
          {requirement}
          {"\n"}Attach it to the draft before publishing.
        </BodyText>
      ))}
      {variants.length ? (
        <View style={{ gap: spacing.small }}>
          <Button
            title={versionsOpen ? "Hide versions" : "Account versions"}
            intent="quiet"
            accessibilityState={{ expanded: versionsOpen }}
            onPress={() => setVersionsOpen((value) => !value)}
          />
          {versionsOpen
            ? variants.map((destination) => (
                <View key={destination.account_id} style={{ gap: spacing.extraSmall }}>
                  <ContentTitle>{platformLabel(destination.platform)}</ContentTitle>
                  <BodyText selectable>
                    {destination.segments?.map((segment) => segment.body).join("\n\n") ||
                      "Visual only"}
                  </BodyText>
                  {destination.media.brief ? <BodyText>{destination.media.brief}</BodyText> : null}
                </View>
              ))
            : null}
        </View>
      ) : null}
      {renderError ? (
        <View style={{ gap: spacing.small }}>
          <BodyText accessibilityRole="alert">{renderError}</BodyText>
          <Button
            title="Retry visuals"
            intent="quiet"
            disabled={busy}
            onPress={() => {
              setReady(new Set());
              setRenderError("");
              setRenderAttempt((value) => value + 1);
            }}
          />
        </View>
      ) : null}
      <Button
        title="Use this post"
        loading={selecting}
        onPress={() => onUse(option, render)}
        disabled={busy || recipes.some(([key]) => !ready.has(key))}
      />
    </Card>
  );
}
