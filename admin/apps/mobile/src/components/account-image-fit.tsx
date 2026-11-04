import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { components } from "@openpost/api-contract";
import {
  api,
  apiRequestIdentityIsCurrent,
  captureApiRequestIdentity,
  errorMessage,
} from "@/lib/api/client";
import { MediaImage } from "./media-image";
import { BodyText, Button } from "./ui";
import { QueryNotice } from "./query-state";

type Image = components["schemas"]["MediaSummary"];
export type AccountImageChoice = {
  accountId: string;
  originalId: string;
  profile: string;
  prepared: components["schemas"]["MediaUploadResult"];
  selected: boolean;
};

export function AccountImageFit({
  accountId,
  media,
  profile,
  settings,
  choice,
  onChange,
}: {
  accountId: string;
  media: Image;
  profile: string;
  settings?: Record<string, unknown> | null;
  choice?: AccountImageChoice;
  onChange: (choice: AccountImageChoice) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      const request = controller.current;
      controller.current = null;
      request?.abort();
    },
    [],
  );
  const current = choice?.profile === profile ? choice : undefined;
  async function prepare() {
    if (busy || !profile || current) return;
    const identity = captureApiRequestIdentity();
    const request = new AbortController();
    controller.current = request;
    const deadline = setTimeout(() => request.abort(), 25_000);
    setBusy(true);
    setError("");
    try {
      const { data, error, response } = await api().POST("/media/{id}/prepare-image", {
        signal: request.signal,
        params: { path: { id: media.id } },
        body: {
          account_id: accountId,
          output_profile: profile,
          settings: settings ?? {},
          alt_text: media.alt_text ?? "",
        },
      });
      if (request.signal.aborted || !apiRequestIdentityIsCurrent(identity)) return;
      if (error || !data)
        throw new Error(await errorMessage(response, "Could not fit this image", error));
      onChange({ accountId, originalId: media.id, profile, prepared: data.media, selected: false });
    } catch (cause) {
      if (!apiRequestIdentityIsCurrent(identity)) return;
      if (!request.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Could not fit this image");
      else if (controller.current === request)
        setError("Image fitting timed out. Your current image is unchanged.");
    } finally {
      clearTimeout(deadline);
      if (controller.current === request) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  const shown = current?.selected ? current.prepared : media;
  return (
    <View style={{ gap: 8 }}>
      <MediaImage
        uri={shown.url}
        contentFit="contain"
        accessibilityLabel={media.alt_text || "Post image"}
        style={{
          width: "100%",
          aspectRatio: shown.width && shown.height ? shown.width / shown.height : 1,
        }}
      />
      <BodyText>
        {current?.selected
          ? "Fitted copy selected for this account. The original stays in Media."
          : "Fit a separate copy to this account’s image limits."}
      </BodyText>
      {!current ? (
        <Button
          title={busy ? "Fitting image…" : "Fit image for this account"}
          intent="ordinary"
          loading={busy}
          disabled={busy || !profile}
          onPress={() => void prepare()}
        />
      ) : null}
      {!profile ? <BodyText>Choose a supported image format before fitting.</BodyText> : null}
      {current ? (
        <View style={{ gap: 8 }}>
          {!current.selected ? (
            <MediaImage
              uri={current.prepared.url}
              contentFit="contain"
              accessibilityLabel="Prepared image preview"
              style={{
                width: "100%",
                aspectRatio:
                  current.prepared.width && current.prepared.height
                    ? current.prepared.width / current.prepared.height
                    : 1,
              }}
            />
          ) : null}
          <BodyText>
            {current.prepared.width} × {current.prepared.height}
          </BodyText>
          <Button
            title={
              current.selected ? "Use current image instead" : "Use fitted copy for this account"
            }
            intent="ordinary"
            onPress={() => onChange({ ...current, selected: !current.selected })}
          />
        </View>
      ) : null}
      {error ? <QueryNotice message={error} retry={() => void prepare()} /> : null}
    </View>
  );
}
