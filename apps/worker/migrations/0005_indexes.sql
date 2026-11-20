-- Deleting a tracked document removes its doc_view rows from the core events table
-- (documents store deleteDocument and the daily purge); without this they scan events.
CREATE INDEX IF NOT EXISTS idx_events_document ON events (document_id)
	WHERE document_id IS NOT NULL;
