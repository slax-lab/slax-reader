import assert from 'node:assert/strict'

type Sql = (statement: string) => string
type RequestShare = (label: string, path: string, options: RequestInit) => Promise<{ status: number; body: { code: number; data: any } }>

/** Exercises actual share handlers and migrated PostgreSQL visibility triggers. */
export async function exerciseShareSettings(sql: Sql, request: RequestShare, headers: Record<string, string>, legacyId: number) {
  sql(`
    INSERT INTO sr_bookmark (id,title,target_url,host_url,status,created_at,updated_at,published_at)
    SELECT i,'Share toggle fixture ' || i,'https://example.invalid/share-' || i,'example.invalid','success',now(),now(),now()
    FROM generate_series(2,7) i;
    INSERT INTO sr_user_bookmark (user_id,bookmark_id,updated_at) SELECT 1,i,now() FROM generate_series(2,7) i;
    INSERT INTO sr_bookmark_comment (user_id,bookmark_id,type,source,content,comment,updated_at)
    SELECT 1,id,2,'[]','[]','Local share toggle fixture',now() FROM sr_user_bookmark WHERE user_id=1 AND bookmark_id=3;
    INSERT INTO sr_bookmark_share (user_id,bookmark_id,share_code,show_line,show_comment,show_userinfo,allow_comment,allow_line,is_enable,created_at)
    VALUES (1,4,'ExistingShareFixture',true,true,true,true,true,true,'2020-01-01'),
           (1,5,'DisabledShareFixture',false,false,false,false,false,false,'2020-01-01');
  `)
  const save = async (label: string, bookmarkUid: string, enabled: boolean) => {
    const result = await request(label, '/v1/share/update', {
      method: 'POST',
      headers,
      body: JSON.stringify({ bookmark_uid: bookmarkUid, allow_action: enabled, show_comment_line: enabled, show_userinfo: true })
    })
    assert.equal(result.status, 200)
    assert.equal(result.body.code, 200)
    assert.equal(result.body.data.allow_action, enabled)
    assert.equal(result.body.data.show_comment_line, enabled)
    return result.body.data
  }
  const identity = (id: number) => sql(`SELECT json_build_array(id,uuid,created_at,share_code) FROM sr_bookmark_share WHERE user_id=1 AND bookmark_id=${id}`)
  let updates = 0
  for (const id of [2, 3, 4, 5]) {
    const uid = sql(`SELECT uuid FROM sr_user_bookmark WHERE user_id=1 AND bookmark_id=${id}`)
    let before = identity(id)
    for (let round = 0; round < 3; round++) {
      for (const enabled of [false, true]) {
        await save(`share-${id}-${round}-${enabled ? 'on' : 'off'}`, uid, enabled)
        updates++
        const stored = JSON.parse(
          sql(
            `SELECT json_build_object('count',count(*),'enabled',bool_and(allow_comment AND allow_line),'visible',bool_and(show_comment AND show_line),'active',bool_and(is_enable)) FROM sr_bookmark_share WHERE user_id=1 AND bookmark_id=${id}`
          )
        )
        assert.deepEqual(stored, { count: 1, enabled, visible: enabled, active: true })
        if (before) assert.equal(identity(id), before)
        else before = identity(id)
        if (id === 3) {
          const stats = JSON.parse(
            sql(`SELECT json_build_object('count',comment_count,'has_comment',first_comment IS NOT NULL) FROM sr_user_bookmark_stats WHERE bookmark_uuid='${uid}'`)
          )
          assert.deepEqual(stats, { count: enabled ? 1 : 0, has_comment: enabled })
        }
      }
    }
  }
  const uid = sql('SELECT uuid FROM sr_user_bookmark WHERE user_id=1 AND bookmark_id=7')
  await Promise.all(Array.from({ length: 8 }, (_, i) => save(`share-concurrent-${i}`, uid, true)))
  assert.equal(sql('SELECT count(*) FROM sr_bookmark_share WHERE user_id=1 AND bookmark_id=7'), '1')
  const legacy = await request('share-legacy-id', '/v1/share/update', {
    method: 'POST',
    headers,
    body: JSON.stringify({ bookmark_id: legacyId, allow_action: true, show_comment_line: true, show_userinfo: true })
  })
  assert.equal(legacy.body.code, 200)
  assert.ok(legacy.body.data.share_code)
  const generatedCode = legacy.body.data.share_code
  const legacyUid = sql('SELECT uuid FROM sr_user_bookmark WHERE user_id=1 AND bookmark_id=6')
  assert.equal((await save('share-legacy-via-uid', legacyUid, false)).share_code, generatedCode)
  return { sequentialUpdates: updates, concurrentFirstSaves: 8, legacyCompatibility: true, identityPreserved: true, commentStatsHiddenAndRestored: true }
}
