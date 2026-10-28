-- First Newsletter release: independent messages and permanent platform bindings.
BEGIN;
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

CREATE TABLE sr_newsletter_feed (
 id BIGSERIAL PRIMARY KEY,
 user_id INTEGER NOT NULL,
 source_key TEXT NOT NULL CHECK (source_key ~ '^[a-f0-9]{64}$'),
 sender TEXT NOT NULL CHECK (length(sender) BETWEEN 3 AND 254),
 sender_name TEXT NOT NULL DEFAULT '',
 message_key TEXT NOT NULL CHECK (message_key ~ '^[a-f0-9]{64}$'),
 state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','ready','cancelled')),
 title TEXT NOT NULL DEFAULT '',
 summary TEXT NOT NULL DEFAULT '',
 content_key TEXT,
 content_truncated BOOLEAN NOT NULL DEFAULT false,
 published_at TIMESTAMP(3),
 received_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ((state='ready' AND content_key IS NOT NULL AND length(content_key)>0) OR (state<>'ready' AND content_key IS NULL))
);
CREATE UNIQUE INDEX sr_newsletter_feed_user_id_source_key_message_key_key ON sr_newsletter_feed(user_id,source_key,message_key);
CREATE INDEX sr_newsletter_feed_user_id_received_at_id_idx ON sr_newsletter_feed(user_id,received_at DESC,id DESC);
CREATE INDEX sr_newsletter_feed_user_id_source_key_received_at_id_idx ON sr_newsletter_feed(user_id,source_key,received_at DESC,id DESC);
CREATE INDEX sr_newsletter_feed_content_key_idx ON sr_newsletter_feed(content_key);
COMMIT;
