-- Tracked documents. File bytes live in R2 (binding DOCS); times are epoch milliseconds.

CREATE TABLE IF NOT EXISTS documents (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	mime TEXT NOT NULL,
	size INTEGER NOT NULL,
	r2_key TEXT NOT NULL,
	pages INTEGER,               -- reported by the PDF viewer on first render
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_created ON documents (created_at DESC);

-- Which tracked messages link to which documents (for "sent to, not viewed yet").
CREATE TABLE IF NOT EXISTS document_messages (
	document_id TEXT NOT NULL,
	message_id TEXT NOT NULL,
	PRIMARY KEY (document_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_document_messages_message ON document_messages (message_id);

CREATE TABLE IF NOT EXISTS document_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	document_id TEXT NOT NULL,
	message_id TEXT,             -- NULL for the unattributed /d/<docId> link
	view_id INTEGER,             -- the 'view' row a page/download event belongs to
	type TEXT NOT NULL,          -- 'view' | 'page' | 'download'
	page INTEGER,
	dwell_ms INTEGER,
	at INTEGER NOT NULL,
	source TEXT NOT NULL,        -- EventSource
	location TEXT,
	device TEXT,
	ip_hash TEXT,
	ignored TEXT                 -- NULL | 'owner' | 'send_grace'
);
CREATE INDEX IF NOT EXISTS idx_document_events_doc ON document_events (document_id, id);
CREATE INDEX IF NOT EXISTS idx_document_events_at ON document_events (at);

-- Document views also land in the core events table (type 'doc_view') so they reach
-- /api/feed and the message timeline. They never count as opens or clicks.
ALTER TABLE events ADD COLUMN document_id TEXT;
ALTER TABLE events ADD COLUMN document_name TEXT;
