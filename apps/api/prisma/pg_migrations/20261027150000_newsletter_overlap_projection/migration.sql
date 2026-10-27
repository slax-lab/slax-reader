-- Preserve old recipient lookup and receipt completion while workers overlap.
BEGIN;
LOCK TABLE sr_platform_bind, sr_newsletter_address, sr_newsletter_receipt IN SHARE ROW EXCLUSIVE MODE;
CREATE OR REPLACE FUNCTION mirror_newsletter_address() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  UPDATE sr_newsletter_address SET retired_at = COALESCE(retired_at, CURRENT_TIMESTAMP) WHERE id = OLD.id;
  UPDATE sr_platform_bind SET retired_at = COALESCE(retired_at, CURRENT_TIMESTAMP) WHERE uuid = OLD.id AND platform = 'newsletter';
  RETURN NULL;
 END IF;
 IF TG_OP = 'UPDATE' AND ((NEW.id, NEW.user_id, NEW.domain, NEW.local_part, NEW.created_at)
  IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.domain, OLD.local_part, OLD.created_at)
  OR (OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at)) THEN
  RAISE EXCEPTION 'Newsletter address identity and retirement are immutable';
 END IF;
 IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
 INSERT INTO sr_platform_bind (uuid, user_id, platform, platform_id, user_name, created_at, retired_at)
 VALUES (NEW.id, NEW.user_id, 'newsletter', 'feed+' || NEW.local_part || '@' || NEW.domain,
  'feed+' || NEW.local_part || '@' || NEW.domain, NEW.created_at, NEW.retired_at)
 ON CONFLICT (uuid) DO UPDATE SET retired_at = EXCLUDED.retired_at
 WHERE sr_platform_bind.user_id = EXCLUDED.user_id AND sr_platform_bind.platform = 'newsletter'
  AND sr_platform_bind.platform_id = EXCLUDED.platform_id AND sr_platform_bind.user_name = EXCLUDED.user_name;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conflicting Newsletter binding ownership'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION guard_newsletter_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.platform = 'newsletter' THEN
  IF TG_OP = 'DELETE' THEN
   UPDATE sr_platform_bind SET retired_at = COALESCE(retired_at, CURRENT_TIMESTAMP) WHERE id = OLD.id;
   UPDATE sr_newsletter_address SET retired_at = COALESCE(retired_at, CURRENT_TIMESTAMP) WHERE id = OLD.uuid;
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
CREATE FUNCTION project_newsletter_binding_address() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Old address INSERTs invoke this before their own row exists; do not loop back.
 IF NEW.platform <> 'newsletter' OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
 IF NEW.platform_id <> NEW.user_name OR NEW.platform_id <> lower(NEW.platform_id)
  OR NEW.platform_id !~ '^feed\+[^@]+@[^@]+$' THEN
  RAISE EXCEPTION 'Invalid canonical Newsletter receiving address';
 END IF;
 INSERT INTO sr_newsletter_address(id, user_id, domain, local_part, created_at, retired_at)
 VALUES (NEW.uuid, NEW.user_id, split_part(NEW.platform_id, '@', 2),
  substring(split_part(NEW.platform_id, '@', 1) from 6), NEW.created_at, NEW.retired_at)
 ON CONFLICT (id) DO UPDATE SET retired_at = EXCLUDED.retired_at
 WHERE sr_newsletter_address.user_id = EXCLUDED.user_id
  AND sr_newsletter_address.domain = EXCLUDED.domain
  AND sr_newsletter_address.local_part = EXCLUDED.local_part
  AND sr_newsletter_address.created_at = EXCLUDED.created_at;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conflicting legacy Newsletter address ownership'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sr_platform_bind_newsletter_projection AFTER INSERT OR UPDATE ON sr_platform_bind
 FOR EACH ROW EXECUTE FUNCTION project_newsletter_binding_address();
-- Cover bindings issued in the interval between the two rollout migrations.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM sr_platform_bind WHERE platform='newsletter' AND
  (platform_id <> user_name OR platform_id <> lower(platform_id) OR platform_id !~ '^feed\+[^@]+@[^@]+$')) THEN
  RAISE EXCEPTION 'Invalid canonical Newsletter receiving address';
 END IF;
END $$;
INSERT INTO sr_newsletter_address(id,user_id,domain,local_part,created_at,retired_at)
 SELECT uuid,user_id,split_part(platform_id,'@',2),substring(split_part(platform_id,'@',1) from 6),created_at,retired_at
 FROM sr_platform_bind WHERE platform='newsletter'
 ON CONFLICT (id) DO UPDATE SET retired_at=EXCLUDED.retired_at;
CREATE OR REPLACE FUNCTION map_newsletter_receipt_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mapped INTEGER; legacy_address TEXT;
BEGIN
 IF NEW.address_id IS NOT NULL THEN
  SELECT b.id INTO mapped FROM sr_platform_bind b WHERE b.uuid=NEW.address_id AND b.user_id=NEW.user_id AND b.platform='newsletter';
  IF mapped IS NULL OR (NEW.binding_id IS NOT NULL AND NEW.binding_id <> mapped) THEN RAISE EXCEPTION 'Unmapped Newsletter receipt'; END IF;
  NEW.binding_id=mapped;
 END IF;
 IF NEW.binding_id IS NOT NULL THEN
  SELECT b.uuid INTO legacy_address FROM sr_platform_bind b WHERE b.id=NEW.binding_id AND b.user_id=NEW.user_id AND b.platform='newsletter';
  IF legacy_address IS NULL THEN RAISE EXCEPTION 'Conflicting Newsletter receipt owner'; END IF;
  NEW.address_id=legacy_address;
 END IF;
 RETURN NEW;
END $$;
UPDATE sr_newsletter_receipt r SET address_id=b.uuid FROM sr_platform_bind b
 WHERE r.binding_id=b.id AND r.user_id=b.user_id AND b.platform='newsletter' AND r.address_id IS NULL;
COMMIT;
