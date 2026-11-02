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
