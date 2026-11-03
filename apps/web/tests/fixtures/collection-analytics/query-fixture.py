import sqlite3
c=sqlite3.connect(':memory:')
c.execute('create table events(user_id integer,event_name text,properties text,occurred_at integer,device_id text)')
import json
def row(device,name,t,user=0,**p):
    return (user,name,json.dumps({'collection_id':'Collection123',**p},sort_keys=True),t,device)
rows=[row('a','collection_opened',0,surface='public_page'),row('a','collection_opened',10,surface='public_page'),row('a','collection_subscribed',172800,7),row('late','collection_opened',0,surface='public_page'),row('late','collection_subscribed',172801,8),row('immature','collection_opened',259200,surface='public_page'),row('immature','collection_subscribed',259210,9),row('direct','collection_opened',0,10,surface='public_page'),row('direct','collection_subscribed',10,10),row('inbox','collection_opened',0,surface='inbox'),row('legacy','collection_opened',0),row('','collection_opened',0,surface='public_page')]
for device,success_name,finish in [('a','user_created',1800),('returning','user_logged_in',1800),('slow','user_logged_in',1801)]:
    provenance={'source_screen':'collection','presentation':'modal','trigger_element_id':'collection_subscribe_button'}
    rows += [row(device,'screen_viewed',0,screen_name='signup',**provenance),row(device,'element_clicked',10,screen_name='signup',element_id='login_google_button',**provenance),row(device,success_name,finish,7,method='google',**provenance)]
rows += [rows[0],rows[2],rows[-1]]
c.executemany('insert into events values (?,?,?,?,?)',rows)
c.execute('create view dedup as select distinct * from events')
c.execute("create view eligible as select *,json_extract(properties,'$.collection_id') as collection_id from dedup where device_id<>''")
c.execute("create view anchors as select device_id,collection_id,min(occurred_at) as entry from eligible where event_name='collection_opened' and user_id=0 and json_extract(properties,'$.surface')='public_page' and occurred_at>=0 and occurred_at<288000 group by device_id,collection_id")
# At 96 hours, only entries with all 48 follow-up hours belong in the primary denominator.
cohort=c.execute("select count(*),sum(exists(select 1 from eligible s where s.event_name='collection_subscribed' and s.device_id=a.device_id and s.collection_id=a.collection_id and s.occurred_at>=a.entry and s.occurred_at<=a.entry+172800)) from anchors a where a.entry+172800<=345600").fetchone()
assert cohort==(2,1),cohort
assert c.execute('select count(*) from anchors where entry+172800>345600').fetchone()[0]==1
login=c.execute("""select count(distinct m.device_id) from eligible m join eligible k on k.device_id=m.device_id and k.collection_id=m.collection_id join eligible s on s.device_id=m.device_id and s.collection_id=m.collection_id where m.event_name='screen_viewed' and m.user_id=0 and json_extract(m.properties,'$.source_screen')='collection' and k.event_name='element_clicked' and json_extract(k.properties,'$.element_id')='login_google_button' and k.occurred_at between m.occurred_at and m.occurred_at+1800 and s.event_name in ('user_created','user_logged_in') and json_extract(s.properties,'$.method')='google' and json_extract(s.properties,'$.source_screen')='collection' and s.occurred_at between k.occurred_at and m.occurred_at+1800""").fetchone()[0]
assert login==2,login
assert c.execute('select (select count(*) from events)-(select count(*) from dedup)').fetchone()[0]==3
print('PASS: 48-hour inclusive cutoff, 30-minute inclusive cutoff, new/returning login, 3 redelivery duplicates, repeated visits, immature cohorts, authenticated/Inbox/legacy/missing-device exclusion.')


def verify_first_click_conversion():
    """Hand-authored outcomes for the Q2 auxiliary click cohort, not production SQL."""
    db = sqlite3.connect(':memory:')
    db.execute('create table events(user_id integer,event_name text,properties text,occurred_at integer,device_id text)')
    samples = []

    def click(device, t=1000, user=0, collection='Collection123'):
        return row(device, 'element_clicked', t, user, collection_id=collection,
                   screen_name='collection', element_id='collection_subscribe_button')

    def entry(device, t=0, **properties):
        return row(device, 'collection_opened', t, **{'surface': 'public_page', **properties})

    def success(device, t, user=7, collection='Collection123'):
        return row(device, 'collection_subscribed', t, user, collection_id=collection)

    # A later authenticated click cannot reclassify an anonymous first click.
    samples += [entry('anonymous_boundary'), click('anonymous_boundary'),
                click('anonymous_boundary', 1001, 7), entry('anonymous_boundary', 2000),
                success('anonymous_boundary', 173800)]
    samples += [entry('direct'), click('direct', user=10), success('direct', 1001, 10)]
    # This success is inside the last click's window but outside the first one's.
    samples += [entry('late'), click('late'), click('late', 1001, 7), success('late', 173801)]
    samples += [entry('before_click'), click('before_click'), success('before_click', 999)]
    samples += [entry('other_collection'), click('other_collection'),
                success('other_collection', 1001, collection='Other123')]
    samples += [entry('other_device'), click('other_device'), success('different_device', 1001)]
    samples += [entry('anonymous_success'), click('anonymous_success'), success('anonymous_success', 1001, 0)]
    # At T=96h, a click at 48h is mature; its success can be beyond report end.
    samples += [entry('maturity_boundary'), click('maturity_boundary', 172800),
                success('maturity_boundary', 345600)]
    samples += [entry('simultaneous'), click('simultaneous', 0), success('simultaneous', 0)]
    # An already-converted but immature click must not enter either primary count.
    samples += [entry('immature'), click('immature', 259200), success('immature', 259201)]
    # These observations remain diagnostic gaps or period exclusions, not anchors.
    samples += [entry(''), click(''), success('', 1001)]
    samples += [click('missing_open'), success('missing_open', 1001)]
    samples += [entry('inbox_only', surface='inbox'), click('inbox_only')]
    samples += [row('legacy', 'collection_opened', 0), click('legacy')]
    samples += [entry('unknown_identity'), click('unknown_identity', user=None)]
    samples += [entry('future_open', 1001), click('future_open')]
    samples += [entry('old_open', -1), click('old_open')]
    samples += [entry('period_end'), click('period_end', 300000)]
    samples += [entry('before_period', -2), click('before_period', -1)]
    samples += [entry('invalid_code', collection_id='!'), click('invalid_code', collection='!')]
    samples += [entry('wrong_control'), row('wrong_control', 'element_clicked', 1000,
                screen_name='signup', element_id='login_google_button')]

    db.executemany('insert into events values (?,?,?,?,?)', samples)
    db.executescript('''
        create view dedup as select distinct * from events;
        create view parsed as
            select *, json_extract(properties, '$.collection_id') as collection_id
            from dedup;
        create view eligible as
            select * from parsed
            where device_id <> '' and collection_id is not null
              and length(collection_id) between 1 and 64
              and collection_id not glob '*[^a-zA-Z0-9]*';
        create view ranked_clicks as
            select k.*, row_number() over (
                partition by k.device_id, k.collection_id order by k.occurred_at
            ) as position
            from eligible k
            where k.event_name = 'element_clicked' and k.user_id >= 0
              and json_extract(k.properties, '$.screen_name') = 'collection'
              and json_extract(k.properties, '$.element_id') = 'collection_subscribe_button'
              and k.occurred_at >= 0 and k.occurred_at < 300000
              and exists (
                select 1 from eligible o
                where o.event_name = 'collection_opened'
                  and json_extract(o.properties, '$.surface') = 'public_page'
                  and o.device_id = k.device_id and o.collection_id = k.collection_id
                  and o.occurred_at >= 0 and o.occurred_at < 300000
                  and o.occurred_at <= k.occurred_at
              );
        create view click_anchors as select * from ranked_clicks where position = 1;
        create view mature as
            select k.device_id, k.collection_id, k.occurred_at as anchor, k.user_id,
                   exists (
                     select 1 from eligible s
                     where s.event_name = 'collection_subscribed' and s.user_id > 0
                       and s.device_id = k.device_id and s.collection_id = k.collection_id
                       and s.occurred_at between k.occurred_at and k.occurred_at + 172800
                   ) as converted
            from click_anchors k where k.occurred_at + 172800 <= 345600;
    ''')

    # Independent expected values: (first click time, click-time identity, outcome).
    expected = {
        'anonymous_boundary': (1000, 0, 1), 'direct': (1000, 10, 1),
        'late': (1000, 0, 0), 'before_click': (1000, 0, 0),
        'other_collection': (1000, 0, 0), 'other_device': (1000, 0, 0),
        'anonymous_success': (1000, 0, 0), 'maturity_boundary': (172800, 0, 1),
        'simultaneous': (0, 0, 1),
    }
    observed = {device: (anchor, user, converted) for device, anchor, user, converted
                in db.execute('select device_id, anchor, user_id, converted from mature')}
    assert observed == expected, observed
    assert db.execute('select count(*) from click_anchors').fetchone()[0] == 10
    assert db.execute('select count(*) from mature where device_id = ?', ('immature',)).fetchone()[0] == 0
    # Click and visit windows are independent: this success is too late for entry=0.
    assert db.execute("select count(*) from eligible where device_id='anonymous_boundary' and event_name='collection_subscribed' and occurred_at<=172800").fetchone()[0] == 0
    counts = db.execute('select user_id=0, count(*), sum(converted) from mature group by user_id=0 order by user_id=0').fetchall()
    assert counts == [(0, 1, 1), (1, 8, 3)], counts
    assert db.execute("select sum(converted)*1.0/nullif(count(*),0) from mature where collection_id='Empty123'").fetchone()[0] is None
    # Redelivery, including duplicate successes, must not change either cohort.
    db.executemany('insert into events values (?,?,?,?,?)', samples)
    replayed = {device: (anchor, user, converted) for device, anchor, user, converted
                in db.execute('select device_id, anchor, user_id, converted from mature')}
    assert replayed == expected
    assert db.execute('select (select count(*) from events), (select count(*) from dedup)').fetchone() == (len(samples) * 2, len(samples))
    db.close()
    print('PASS: first-click cohort, click-time identity, 48h endpoints/maturity, independent visit window, matching device/collection, period and quality exclusions, zero denominator, duplicate replay.')


verify_first_click_conversion()
