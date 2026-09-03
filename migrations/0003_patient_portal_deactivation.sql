ALTER TABLE patients ADD COLUMN portal_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE patients ADD COLUMN portal_deleted_at TEXT;
UPDATE patients SET portal_active = 1 WHERE portal_active IS NULL;
