-- A delete can arrive before discovery or history. Keep provider identity even
-- when no local message exists. Empty conversation scope means the provider's
-- message identity is account-wide, as with Mastodon stream deletes.
CREATE TABLE provider_message_tombstones (
  social_account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  remote_conversation_id TEXT NOT NULL DEFAULT '',
  remote_message_id TEXT NOT NULL CHECK (remote_message_id <> ''),
  deleted_at TIMESTAMP NOT NULL,
  PRIMARY KEY (social_account_id, remote_conversation_id, remote_message_id)
);
INSERT INTO provider_message_tombstones(social_account_id,remote_conversation_id,remote_message_id,deleted_at)
SELECT c.social_account_id,c.remote_conversation_id,m.remote_message_id,m.deleted_at
FROM direct_messages AS m JOIN conversations AS c ON c.id=m.conversation_id
WHERE m.deleted_at IS NOT NULL AND m.remote_message_id<>'';

-- Conversation deletion has no local-row prerequisite either. Retain its
-- observed cutoff after new activity so older history stays inaccessible.
CREATE TABLE provider_conversation_tombstones (
  social_account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  remote_conversation_id TEXT NOT NULL CHECK (remote_conversation_id <> ''),
  deleted_at TIMESTAMP NOT NULL,
  PRIMARY KEY (social_account_id, remote_conversation_id)
);
