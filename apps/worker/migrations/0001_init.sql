-- Initial schema. Times are epoch milliseconds.

CREATE TABLE IF NOT EXISTS messages (
	id TEXT PRIMARY KEY,
	provider TEXT NOT NULL,
	subject TEXT NOT NULL DEFAULT '',
	recipients TEXT NOT NULL DEFAULT '[]', -- JSON array of {email, name?}
	mode TEXT NOT NULL DEFAULT 'shared',   -- 'shared' | 'individual'
	group_id TEXT,
	track_opens INTEGER NOT NULL DEFAULT 1,
	track_links INTEGER NOT NULL DEFAULT 1,
	created_at INTEGER NOT NULL,
	sent_at INTEGER,
	provider_thread_id TEXT,
	provider_message_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (provider_thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages (group_id);

CREATE TABLE IF NOT EXISTS links (
	message_id TEXT NOT NULL,
	idx INTEGER NOT NULL,
	url TEXT NOT NULL,
	PRIMARY KEY (message_id, idx)
);

CREATE TABLE IF NOT EXISTS events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	message_id TEXT NOT NULL,
	type TEXT NOT NULL,          -- 'open' | 'click'
	link_index INTEGER,
	at INTEGER NOT NULL,
	source TEXT NOT NULL,        -- EventSource
	location TEXT,
	device TEXT,
	ip_hash TEXT,
	ignored TEXT                 -- NULL | 'owner' | 'send_grace'
);
CREATE INDEX IF NOT EXISTS idx_events_message ON events (message_id, id);
CREATE INDEX IF NOT EXISTS idx_events_feed ON events (id) WHERE ignored IS NULL;
CREATE INDEX IF NOT EXISTS idx_events_at ON events (at);

CREATE TABLE IF NOT EXISTS owner_views (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	message_id TEXT NOT NULL,
	at INTEGER NOT NULL,
	ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_owner_views_message ON owner_views (message_id, at);
CREATE INDEX IF NOT EXISTS idx_owner_views_ip ON owner_views (ip_hash, at);
CREATE INDEX IF NOT EXISTS idx_owner_views_at ON owner_views (at);
