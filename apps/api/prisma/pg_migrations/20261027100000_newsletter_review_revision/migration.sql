-- Expand only: old workers retain their tables, UUID receipt IDs and lease fields.
BEGIN;
LOCK TABLE sr_rss_feed, sr_newsletter_address, sr_platform_bind, sr_newsletter_receipt IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE sr_feed (LIKE sr_rss_feed INCLUDING ALL);
ALTER INDEX sr_feed_next_fetch_at_idx RENAME TO sr_feed_due;
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
DO $$ BEGIN
 IF EXISTS (SELECT user_id FROM sr_newsletter_address GROUP BY user_id HAVING count(*) > 1) THEN
  RAISE EXCEPTION 'Multiple historical Newsletter addresses for one user';
 END IF;
 IF EXISTS (SELECT 1 FROM sr_newsletter_address a JOIN sr_platform_bind b
  ON b.uuid = a.id OR (b.user_id = a.user_id AND b.platform = 'newsletter')
   OR (b.platform = 'newsletter' AND b.platform_id = 'feed+' || a.local_part || '@' || a.domain)
  WHERE b.uuid <> a.id OR b.user_id <> a.user_id OR b.platform <> 'newsletter'
   OR b.platform_id <> 'feed+' || a.local_part || '@' || a.domain
   OR b.user_name <> 'feed+' || a.local_part || '@' || a.domain) THEN
  RAISE EXCEPTION 'Conflicting Newsletter binding ownership';
 END IF;
 IF EXISTS (SELECT 1 FROM sr_newsletter_receipt r LEFT JOIN sr_newsletter_address a
  ON a.id = r.address_id AND a.user_id = r.user_id WHERE a.id IS NULL) THEN
  RAISE EXCEPTION 'Unmapped Newsletter receipt';
 END IF;
END $$;
CREATE UNIQUE INDEX sr_platform_bind_newsletter_address_key ON sr_platform_bind(platform, platform_id) WHERE platform = 'newsletter';
INSERT INTO sr_platform_bind (uuid, user_id, platform, platform_id, user_name, created_at, retired_at)
 SELECT id, user_id, 'newsletter', 'feed+' || local_part || '@' || domain,
 'feed+' || local_part || '@' || domain, created_at, retired_at FROM sr_newsletter_address
 ON CONFLICT (uuid) DO UPDATE SET retired_at = EXCLUDED.retired_at;

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
CREATE FUNCTION mirror_newsletter_address() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  UPDATE sr_newsletter_address SET retired_at = COALESCE(retired_at, CURRENT_TIMESTAMP) WHERE id = OLD.id;
  RETURN NULL;
 END IF;
 IF TG_OP = 'UPDATE' AND ((NEW.id, NEW.user_id, NEW.domain, NEW.local_part, NEW.created_at)
  IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.domain, OLD.local_part, OLD.created_at)
  OR (OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at)) THEN
  RAISE EXCEPTION 'Newsletter address identity and retirement are immutable';
 END IF;
 INSERT INTO sr_platform_bind (uuid, user_id, platform, platform_id, user_name, created_at, retired_at)
 VALUES (NEW.id, NEW.user_id, 'newsletter', 'feed+' || NEW.local_part || '@' || NEW.domain,
  'feed+' || NEW.local_part || '@' || NEW.domain, NEW.created_at, NEW.retired_at)
 ON CONFLICT (uuid) DO UPDATE SET retired_at = EXCLUDED.retired_at
 WHERE sr_platform_bind.user_id = EXCLUDED.user_id AND sr_platform_bind.platform = 'newsletter'
  AND sr_platform_bind.platform_id = EXCLUDED.platform_id AND sr_platform_bind.user_name = EXCLUDED.user_name;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conflicting Newsletter binding ownership'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sr_newsletter_address_mirror BEFORE INSERT OR UPDATE OR DELETE ON sr_newsletter_address FOR EACH ROW EXECUTE FUNCTION mirror_newsletter_address();

ALTER TABLE sr_newsletter_receipt ADD COLUMN receipt_id BIGINT GENERATED BY DEFAULT AS IDENTITY;
ALTER TABLE sr_newsletter_receipt ADD COLUMN binding_id INTEGER;
UPDATE sr_newsletter_receipt r SET binding_id = b.id FROM sr_platform_bind b WHERE b.uuid = r.address_id AND b.user_id = r.user_id AND b.platform = 'newsletter';
ALTER TABLE sr_newsletter_receipt DROP CONSTRAINT sr_newsletter_receipt_pkey;
ALTER TABLE sr_newsletter_receipt ADD PRIMARY KEY (receipt_id);
CREATE UNIQUE INDEX sr_newsletter_receipt_id_key ON sr_newsletter_receipt(id);
ALTER TABLE sr_newsletter_receipt ALTER COLUMN address_id DROP NOT NULL;
CREATE FUNCTION map_newsletter_receipt_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mapped INTEGER;
BEGIN
 IF NEW.address_id IS NOT NULL THEN
  SELECT b.id INTO mapped FROM sr_platform_bind b WHERE b.uuid = NEW.address_id AND b.user_id = NEW.user_id AND b.platform = 'newsletter';
  IF mapped IS NULL OR (NEW.binding_id IS NOT NULL AND NEW.binding_id <> mapped) THEN RAISE EXCEPTION 'Unmapped Newsletter receipt'; END IF;
  NEW.binding_id = mapped;
 END IF;
 IF NEW.binding_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sr_platform_bind WHERE id = NEW.binding_id AND user_id = NEW.user_id AND platform = 'newsletter') THEN RAISE EXCEPTION 'Conflicting Newsletter receipt owner'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sr_newsletter_receipt_binding BEFORE INSERT OR UPDATE ON sr_newsletter_receipt FOR EACH ROW EXECUTE FUNCTION map_newsletter_receipt_binding();
COMMIT;
