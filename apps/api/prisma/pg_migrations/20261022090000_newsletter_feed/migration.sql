-- First Newsletter release: independent messages using existing platform bindings.
BEGIN;
CREATE UNIQUE INDEX sr_platform_bind_newsletter_address_key ON sr_platform_bind(platform,platform_id) WHERE platform='newsletter';

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
