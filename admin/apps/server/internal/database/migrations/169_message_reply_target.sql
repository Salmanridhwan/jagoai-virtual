-- A Mastodon direct message must retain its admitted thread anchor across new
-- inbound activity and every retry of the same fenced provider operation.
ALTER TABLE direct_messages ADD COLUMN reply_to_remote_id TEXT NOT NULL DEFAULT '';

-- Legacy rows with a provider attempt keep their original empty request field.
-- Changing it would change the durable payload fingerprint, even after failure.
UPDATE direct_messages
SET reply_to_remote_id=COALESCE((
  SELECT c.last_remote_message_id
  FROM conversations AS c JOIN social_accounts AS a ON a.id=c.social_account_id
  WHERE c.id=direct_messages.conversation_id AND a.platform='mastodon'
),'')
WHERE direction='outbound' AND remote_message_id='' AND send_status IN ('queued','failed')
AND NOT EXISTS (
  SELECT 1 FROM provider_write_attempts AS attempt
  WHERE attempt.operation_id='messaging:' || direct_messages.id
);
