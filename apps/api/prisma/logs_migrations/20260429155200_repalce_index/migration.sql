ALTER TABLE user_logs
  ADD COLUMN platform TEXT GENERATED ALWAYS AS (extra_data->>'platform') STORED;

CREATE INDEX idx_logs_dau ON user_logs
  (event_name, event_time)
  INCLUDE (user_id, platform);

DROP INDEX IF EXISTS idx_logs_platform;