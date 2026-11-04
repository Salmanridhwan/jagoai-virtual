import { View } from "react-native";
import type { components } from "@openpost/api-contract";
import { BodyText, ContentTitle } from "@/components/ui";

export function ReviewContext({ review }: { review: components["schemas"]["ReviewContext"] }) {
  const reply = review.owner_reply;
  const state =
    reply?.state === "PENDING"
      ? "Pending review"
      : reply?.state === "APPROVED"
        ? "Approved"
        : reply?.state === "REJECTED"
          ? "Rejected"
          : reply?.state || "Not specified";
  return (
    <View style={{ gap: 8 }}>
      <BodyText>
        {review.stars == null ? "Rating not specified" : `Rating: ${review.stars}/5`}
      </BodyText>
      {reply ? (
        <>
          <ContentTitle>Your reply</ContentTitle>
          <BodyText selectable>{reply.text}</BodyText>
          <BodyText>Google moderation: {state}</BodyText>
          {reply.policy_violation ? <BodyText>Policy: {reply.policy_violation}</BodyText> : null}
        </>
      ) : null}
      <BodyText>
        Google accepting a reply does not mean it has approved it for public display.
      </BodyText>
    </View>
  );
}
