-- First Newsletter release: reuse platform bindings; preserve already shipped RSS writers.
BEGIN;
LOCK TABLE sr_rss_feed, sr_platform_bind IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE sr_rss_feed ADD COLUMN kind TEXT NOT NULL DEFAULT 'rss';
ALTER TABLE sr_rss_feed ADD CONSTRAINT sr_rss_feed_kind CHECK (kind IN ('rss','newsletter'));
CREATE TABLE sr_feed (LIKE sr_rss_feed INCLUDING ALL);
ALTER INDEX sr_feed_next_fetch_at_idx RENAME TO sr_feed_due;
ALTER INDEX sr_feed_feed_url_idx RENAME TO sr_feed_feed_url_key;
CREATE FUNCTION mirror_rss_feed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN DELETE FROM sr_feed WHERE id = OLD.id; RETURN OLD; END IF;
 IF TG_OP = 'UPDATE' AND OLD.id IS DISTINCT FROM NEW.id THEN DELETE FROM sr_feed WHERE id = OLD.id; END IF;
 INSERT INTO sr_feed (id, feed_url, title, site_url, etag, last_modified, last_checked_at, last_success_at, next_fetch_at, next_allowed_at, error, failure_count, lease_token, lease_until, created_at, history_checked_at, history_retry_at, history_seen, history_url, icon_url, kind) VALUES (NEW.id, NEW.feed_url, NEW.title, NEW.site_url, NEW.etag, NEW.last_modified, NEW.last_checked_at, NEW.last_success_at, NEW.next_fetch_at, NEW.next_allowed_at, NEW.error, NEW.failure_count, NEW.lease_token, NEW.lease_until, NEW.created_at, NEW.history_checked_at, NEW.history_retry_at, NEW.history_seen, NEW.history_url, NEW.icon_url, NEW.kind) ON CONFLICT (id) DO UPDATE SET feed_url = EXCLUDED.feed_url, title = EXCLUDED.title, site_url = EXCLUDED.site_url, etag = EXCLUDED.etag, last_modified = EXCLUDED.last_modified, last_checked_at = EXCLUDED.last_checked_at, last_success_at = EXCLUDED.last_success_at, next_fetch_at = EXCLUDED.next_fetch_at, next_allowed_at = EXCLUDED.next_allowed_at, error = EXCLUDED.error, failure_count = EXCLUDED.failure_count, lease_token = EXCLUDED.lease_token, lease_until = EXCLUDED.lease_until, created_at = EXCLUDED.created_at, history_checked_at = EXCLUDED.history_checked_at, history_retry_at = EXCLUDED.history_retry_at, history_seen = EXCLUDED.history_seen, history_url = EXCLUDED.history_url, icon_url = EXCLUDED.icon_url, kind = EXCLUDED.kind;
 RETURN NEW;
END $$;
CREATE TRIGGER sr_rss_feed_mirror AFTER INSERT OR UPDATE OR DELETE ON sr_rss_feed FOR EACH ROW EXECUTE FUNCTION mirror_rss_feed();
INSERT INTO sr_feed (id, feed_url, title, site_url, etag, last_modified, last_checked_at, last_success_at, next_fetch_at, next_allowed_at, error, failure_count, lease_token, lease_until, created_at, history_checked_at, history_retry_at, history_seen, history_url, icon_url, kind) SELECT id, feed_url, title, site_url, etag, last_modified, last_checked_at, last_success_at, next_fetch_at, next_allowed_at, error, failure_count, lease_token, lease_until, created_at, history_checked_at, history_retry_at, history_seen, history_url, icon_url, kind FROM sr_rss_feed;


ALTER TABLE sr_platform_bind ADD COLUMN retired_at TIMESTAMP(3);
CREATE UNIQUE INDEX sr_platform_bind_newsletter_address_key ON sr_platform_bind(platform,platform_id) WHERE platform='newsletter';
CREATE FUNCTION guard_newsletter_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.platform = 'newsletter' THEN
  IF TG_OP = 'DELETE' THEN
   UPDATE sr_platform_bind SET retired_at = COALESCE(retired_at, CURRENT_TIMESTAMP) WHERE id = OLD.id;
   RETURN NULL;
  END IF;
  IF (NEW.id, NEW.uuid, NEW.user_id, NEW.platform, NEW.platform_id, NEW.user_name, NEW.created_at)
   IS DISTINCT FROM (OLD.id, OLD.uuid, OLD.user_id, OLD.platform, OLD.platform_id, OLD.user_name, OLD.created_at)
   OR (OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at) THEN
   RAISE EXCEPTION 'Newsletter binding identity and retirement are immutable';
  END IF;
 ELSIF TG_OP = 'UPDATE' AND NEW.platform = 'newsletter' THEN
  RAISE EXCEPTION 'Cannot repurpose a binding as Newsletter';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sr_platform_bind_newsletter_guard BEFORE UPDATE OR DELETE ON sr_platform_bind FOR EACH ROW EXECUTE FUNCTION guard_newsletter_binding();

CREATE TABLE sr_newsletter_receipt (
 id BIGSERIAL PRIMARY KEY,
 user_id INTEGER NOT NULL,
 binding_id INTEGER NOT NULL,
 source_key TEXT NOT NULL,
 message_key TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','done','cancelled')),
 lease_token TEXT,
 lease_until TIMESTAMP(3),
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at TIMESTAMP(3)
);
CREATE UNIQUE INDEX sr_newsletter_receipt_user_id_source_key_message_key_key ON sr_newsletter_receipt(user_id,source_key,message_key);
CREATE INDEX sr_newsletter_receipt_user_id_created_at_idx ON sr_newsletter_receipt(user_id,created_at);
CREATE FUNCTION validate_newsletter_receipt_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM sr_platform_bind WHERE id=NEW.binding_id AND user_id=NEW.user_id AND platform='newsletter') THEN
  RAISE EXCEPTION 'Conflicting Newsletter receipt owner';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sr_newsletter_receipt_binding BEFORE INSERT OR UPDATE ON sr_newsletter_receipt
 FOR EACH ROW EXECUTE FUNCTION validate_newsletter_receipt_binding();
COMMIT;
