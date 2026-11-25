-- Payment telemetry records the subscription action as the event name.
-- Without these values PostgreSQL rejects the insert and LogsService.track
-- swallows the failure, silently dropping the row.
ALTER TYPE event_kind ADD VALUE 'auto_renew_off';
ALTER TYPE event_kind ADD VALUE 'cancel';
ALTER TYPE event_kind ADD VALUE 'refund';
