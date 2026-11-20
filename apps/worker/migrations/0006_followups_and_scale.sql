-- Follow-ups for mail merge campaigns, server-side nudge filtering, and indexes for
-- keyset pagination and SQL aggregates. Times are epoch milliseconds.

-- Messages: 'email' (sent by the user) or 'nudge' (a follow-up the Worker sent).
-- Lists and campaign stats only show emails.
ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'email';
UPDATE messages SET kind = 'nudge'
	WHERE id IN (SELECT nudge_message_id FROM nudge_history WHERE nudge_message_id IS NOT NULL);
-- Message list: WHERE kind = 'email' ORDER BY created_at DESC, id DESC (keyset).
CREATE INDEX IF NOT EXISTS idx_messages_list ON messages (kind, created_at DESC, id DESC);
DROP INDEX IF EXISTS idx_messages_created;
-- Per-message counts filter on ignored/type/source; this covers them.
CREATE INDEX IF NOT EXISTS idx_events_counts ON events (message_id, ignored, type, source, at);

-- Campaigns: follow-up policy (JSON CampaignFollowUp, NULL = none).
ALTER TABLE campaigns ADD COLUMN follow_up TEXT;
CREATE INDEX IF NOT EXISTS idx_campaigns_list ON campaigns (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_status_list ON campaigns (status, created_at DESC, id DESC);
DROP INDEX IF EXISTS idx_campaigns_created;
DROP INDEX IF EXISTS idx_campaigns_status;
-- Recipients filtered by state in send order (the sender asks for the next queued one).
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_state ON campaign_recipients (campaign_id, state, position);

-- Nudge sequences: the original's group (a campaign id) for per-campaign stats and
-- bulk pause/cancel, and the merge fields of a mail merge copy for rendering.
ALTER TABLE nudge_sequences ADD COLUMN group_id TEXT;
ALTER TABLE nudge_sequences ADD COLUMN fields TEXT; -- JSON Record<string, string>
UPDATE nudge_sequences SET group_id = (
	SELECT group_id FROM messages WHERE messages.id = nudge_sequences.message_id
);
CREATE INDEX IF NOT EXISTS idx_nudge_group ON nudge_sequences (group_id, state) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nudge_list ON nudge_sequences (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_nudge_state_list ON nudge_sequences (state, created_at DESC, id DESC);
DROP INDEX IF EXISTS idx_nudge_created;

-- Documents: keyset list, and per-recipient / per-page aggregates.
CREATE INDEX IF NOT EXISTS idx_documents_list ON documents (created_at DESC, id DESC);
DROP INDEX IF EXISTS idx_documents_created;
CREATE INDEX IF NOT EXISTS idx_document_events_stats ON document_events (document_id, message_id, type);
