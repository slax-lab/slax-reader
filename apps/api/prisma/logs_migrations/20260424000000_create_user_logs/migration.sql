CREATE TABLE user_logs (
    id BIGSERIAL,
    user_id INTEGER NOT NULL,
    event_name VARCHAR(30) NOT NULL,
    event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    extra_data JSONB
) PARTITION BY RANGE (event_time);

CREATE INDEX idx_logs_platform ON user_logs (event_name, event_time, (extra_data->>'platform'));
CREATE INDEX idx_user_logs_brin_time ON user_logs USING BRIN (event_time);

DO $$
DECLARE
    v_date DATE := DATE_TRUNC('month', CURRENT_DATE)::DATE;
    v_end DATE := v_date + INTERVAL '5 years';
    v_partition_name TEXT;
BEGIN
    WHILE v_date < v_end LOOP
        v_partition_name := 'user_logs_' || TO_CHAR(v_date, 'YYYY_MM');
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF user_logs FOR VALUES FROM (%L) TO (%L)',
            v_partition_name,
            v_date,
            v_date + INTERVAL '1 month'
        );
        v_date := v_date + INTERVAL '1 month';
    END LOOP;
END $$;

CREATE TYPE event_kind AS ENUM ('heartbeat','register','bookmark_add','subscribe','archive','ai_chat', 'star');
ALTER TABLE user_logs ALTER COLUMN event_name TYPE event_kind USING event_name::event_kind;