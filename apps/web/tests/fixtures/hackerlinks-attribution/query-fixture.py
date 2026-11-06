import json
import sqlite3

UTC_START = 10_000
UTC_END = 20_000


def event(user_id, occurred_at, received_at, device_id, **properties):
    return (user_id, 'user_created', json.dumps(properties, sort_keys=True), occurred_at, received_at, device_id)


def valid(user_id, occurred_at, device_id, medium='header', method='google'):
    return event(user_id, occurred_at, occurred_at, device_id, source='hackerlinks', campaign='mvp', medium=medium, method=method)


def rows():
    header = valid(101, 10_000, 'browser-a')
    return [
        header,
        header,
        valid(102, 11_000, 'browser-b', medium='resource_detail', method='apple'),
        (102, 'user_logged_in', json.dumps({'source': 'hackerlinks', 'campaign': 'mvp', 'medium': 'resource_detail'}), 12_000, 12_000, 'browser-b'),
        event(108, 12_000, 12_000, 'ordinary'),
        event(109, 12_001, 12_001, 'partial', source='hackerlinks'),
        event(110, 12_002, 12_002, 'unsupported', source='hackerlinks', campaign='mvp', medium='other'),
        event(0, 12_003, 12_003, 'anonymous', source='hackerlinks', campaign='mvp', medium='header'),
        valid(111, 20_000, 'period-end'),
        event(114, 9_700, 9_700, 'boundary-copy', source='hackerlinks', campaign='mvp', medium='header', method='google'),
        event(114, 9_700, 10_001, 'boundary-copy', source='hackerlinks', campaign='mvp', medium='header', method='google'),
        event(112, 9_700, 10_000, 'threshold-300', source='hackerlinks', campaign='mvp', medium='header'),
        event(105, 9_599, 10_000, 'threshold-401', source='hackerlinks', campaign='mvp', medium='header', method='google'),
        event(106, 9_699, 10_000, 'threshold-301', source='hackerlinks', campaign='mvp', medium='header', method='google'),
        valid(107, 13_000, ''),
        event(113, None, None, 'undated', source='hackerlinks', campaign='mvp', medium='header'),
    ]


SCHEMA = '''
CREATE TABLE events(user_id INTEGER, event_name TEXT, properties TEXT, occurred_at INTEGER, received_at INTEGER, device_id TEXT);
CREATE VIEW scoped AS
SELECT *, CASE
  WHEN occurred_at IS NULL AND received_at IS NULL THEN NULL
  WHEN occurred_at IS NULL THEN received_at
  WHEN received_at IS NULL THEN occurred_at
  WHEN abs(received_at - occurred_at) > 300 THEN received_at
  ELSE occurred_at
END AS effective_at
FROM events WHERE event_name = 'user_created';
CREATE VIEW raw_in_interval AS
SELECT * FROM scoped WHERE effective_at >= 10000 AND effective_at < 20000;
CREATE VIEW ranked AS
SELECT *, row_number() OVER (
  PARTITION BY user_id, event_name, properties, occurred_at, device_id
  ORDER BY effective_at ASC
) AS rn FROM scoped;
CREATE VIEW deduplicated AS
SELECT user_id, event_name, properties, occurred_at, device_id, effective_at FROM ranked WHERE rn = 1;
CREATE VIEW deduplicated_in_interval AS
SELECT * FROM deduplicated WHERE effective_at >= 10000 AND effective_at < 20000;
CREATE VIEW parsed AS
SELECT
  user_id,
  device_id,
  json_extract(properties, '$.source') AS acq_source,
  json_extract(properties, '$.campaign') AS acq_campaign,
  json_extract(properties, '$.medium') AS acq_medium,
  json_extract(properties, '$.method') AS method
FROM deduplicated_in_interval;
CREATE VIEW flagged AS
SELECT *,
  (acq_source IS NOT NULL OR acq_campaign IS NOT NULL OR acq_medium IS NOT NULL) AS has_any,
  (acq_source IS NOT NULL AND acq_campaign IS NOT NULL AND acq_medium IS NOT NULL) AS has_all,
  (acq_source = 'hackerlinks' AND acq_campaign = 'mvp' AND acq_medium IN ('header', 'resource_detail')) AS complete_valid
FROM parsed;
'''

REPORT = '''
SELECT
  (SELECT count(*) FROM raw_in_interval) AS raw_user_created_rows,
  (SELECT count(*) FROM raw_in_interval) - (SELECT count(*) FROM deduplicated_in_interval) AS duplicates_removed,
  (SELECT count(*) FROM deduplicated_in_interval) AS deduplicated_user_created_events,
  (SELECT count(*) FROM flagged WHERE complete_valid AND user_id > 0) AS attributed_registration_events,
  (SELECT count(DISTINCT user_id) FROM flagged WHERE complete_valid AND user_id > 0) AS attributed_registrations,
  (SELECT count(*) FROM flagged WHERE has_any AND NOT has_all) AS partial_attribution_events,
  (SELECT count(*) FROM flagged WHERE has_all AND NOT complete_valid) AS unsupported_attribution_events,
  (SELECT count(*) FROM flagged WHERE complete_valid AND (user_id IS NULL OR user_id <= 0)) AS non_positive_user_with_triplet,
  (SELECT count(*) FROM flagged WHERE (has_any AND NOT has_all) OR (has_all AND NOT complete_valid) OR (complete_valid AND (user_id IS NULL OR user_id <= 0))) AS attribution_anomaly_events,
  (SELECT count(*) FROM flagged WHERE NOT has_any) AS ordinary_registration_events,
  (SELECT count(*) FROM scoped WHERE effective_at IS NULL) AS undated_user_created_events,
  (SELECT count(DISTINCT user_id) FROM flagged WHERE complete_valid AND user_id > 0 AND (device_id IS NULL OR device_id = '')) AS attributed_registrations_without_device_id
'''

EXPECTED = {
    'raw_user_created_rows': 11,
    'duplicates_removed': 2,
    'deduplicated_user_created_events': 9,
    'attributed_registration_events': 5,
    'attributed_registrations': 5,
    'partial_attribution_events': 1,
    'unsupported_attribution_events': 1,
    'non_positive_user_with_triplet': 1,
    'attribution_anomaly_events': 3,
    'ordinary_registration_events': 1,
    'undated_user_created_events': 1,
    'attributed_registrations_without_device_id': 1,
}


def report(db):
    cursor = db.execute(REPORT)
    result = dict(zip([column[0] for column in cursor.description], cursor.fetchone()))
    groups = db.execute('SELECT acq_medium, acq_campaign, method, count(DISTINCT user_id) FROM flagged WHERE complete_valid AND user_id > 0 GROUP BY acq_medium, acq_campaign, method ORDER BY acq_medium, acq_campaign, method').fetchall()
    return result, groups


def fixture(replay=False):
    db = sqlite3.connect(':memory:')
    samples = rows()
    db.executescript(SCHEMA)
    db.executemany('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?)', samples * (2 if replay else 1))
    return db, samples


db, samples = fixture()
first, groups = report(db)
assert first == EXPECTED, first
assert groups == [('header', 'mvp', 'google', 4), ('resource_detail', 'mvp', 'apple', 1)], groups
assert first['raw_user_created_rows'] - first['duplicates_removed'] == first['deduplicated_user_created_events']
assert first['deduplicated_user_created_events'] == sum(first[key] for key in ['attributed_registration_events', 'partial_attribution_events', 'unsupported_attribution_events', 'non_positive_user_with_triplet', 'ordinary_registration_events'])
assert sum(group[3] for group in groups) == first['attributed_registrations']
second, second_groups = report(db)
assert (second, second_groups) == (first, groups)
db.close()

replayed, samples = fixture(replay=True)
replayed_report, replayed_groups = report(replayed)
assert replayed_report == {**EXPECTED, 'raw_user_created_rows': 22, 'duplicates_removed': 13, 'undated_user_created_events': 2}, replayed_report
assert replayed_groups == groups
replayed.close()

print('PASS: complete triplet, effective_at threshold/UTC boundaries, natural-key deduplication, distinct users, quality buckets, group reconciliation, replay invariance, and repeatability.')
