-- Mail merge campaigns. A campaign's id is the group_id of every message it sends.
-- Times are epoch milliseconds.

CREATE TABLE IF NOT EXISTS campaigns (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	provider TEXT NOT NULL DEFAULT 'gmail',
	subject_template TEXT NOT NULL DEFAULT '',
	body_template TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'sending' | 'paused' | 'done' | 'cancelled'
	pause_reason TEXT,
	settings TEXT NOT NULL DEFAULT '{}',  -- JSON CampaignSettings (throttle, cap, tracking)
	total INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	runner_id TEXT,                       -- the browser tab currently sending
	lease_until INTEGER
);
CREATE INDEX IF NOT EXISTS idx_campaigns_created ON campaigns (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns (status);
CREATE INDEX IF NOT EXISTS idx_campaigns_updated ON campaigns (updated_at);

CREATE TABLE IF NOT EXISTS campaign_recipients (
	campaign_id TEXT NOT NULL,
	position INTEGER NOT NULL,
	email TEXT NOT NULL,                  -- lowercased
	name TEXT,
	fields TEXT NOT NULL DEFAULT '{}',    -- JSON template values
	state TEXT NOT NULL DEFAULT 'queued', -- 'queued' | 'sending' | 'sent' | 'failed' | 'skipped'
	message_id TEXT,                      -- tracked message id once claimed
	error TEXT,
	sent_at INTEGER,
	updated_at INTEGER NOT NULL,
	PRIMARY KEY (campaign_id, email)
);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_order ON campaign_recipients (campaign_id, position);
