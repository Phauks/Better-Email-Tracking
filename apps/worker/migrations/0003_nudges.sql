-- Follow-up nudges and mailbox connectors. Times are epoch milliseconds.

CREATE TABLE IF NOT EXISTS nudge_sequences (
	id TEXT PRIMARY KEY,
	message_id TEXT NOT NULL,
	connector TEXT NOT NULL,              -- 'google'
	provider_thread_id TEXT NOT NULL,
	addressees TEXT NOT NULL DEFAULT '{}', -- JSON {to: Recipient[], cc: Recipient[]}
	state TEXT NOT NULL,                  -- NudgeState
	steps TEXT NOT NULL,                  -- JSON NudgeStep[]
	next_step INTEGER NOT NULL DEFAULT 0,
	next_at INTEGER,
	stop_on_open INTEGER NOT NULL DEFAULT 0,
	send_window TEXT,                     -- JSON SendWindow
	tracker_base TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	attempts INTEGER NOT NULL DEFAULT 0,
	last_error TEXT,
	lock_until INTEGER,                   -- lease held by a scheduler run
	lock_token TEXT,
	pending_send TEXT                     -- JSON {step, nudgeMessageId, at}: set before sending
);
CREATE INDEX IF NOT EXISTS idx_nudge_due ON nudge_sequences (state, next_at);
CREATE INDEX IF NOT EXISTS idx_nudge_message ON nudge_sequences (message_id);
CREATE INDEX IF NOT EXISTS idx_nudge_created ON nudge_sequences (created_at DESC);

CREATE TABLE IF NOT EXISTS nudge_history (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	sequence_id TEXT NOT NULL,
	at INTEGER NOT NULL,
	kind TEXT NOT NULL,                   -- NudgeHistoryKind
	step INTEGER,
	nudge_message_id TEXT,
	detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_nudge_history_seq ON nudge_history (sequence_id, id);
-- A step is recorded as sent at most once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nudge_history_sent
	ON nudge_history (sequence_id, step) WHERE kind = 'sent';

CREATE TABLE IF NOT EXISTS mail_connectors (
	kind TEXT PRIMARY KEY,                -- 'google'
	email TEXT NOT NULL,
	refresh_token_enc TEXT NOT NULL,      -- AES-GCM, key derived from TOKEN_ENC_KEY
	scopes TEXT NOT NULL DEFAULT '',
	connected_at INTEGER NOT NULL
);
