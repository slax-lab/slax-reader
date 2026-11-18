-- Restore original publication times verified on the source pages of existing public snapshots.
-- Match the recorded URL and previous millisecond timestamp as well as the primary key.
UPDATE sr_bookmark AS b
SET published_at = correction.source_time
FROM (
  VALUES
    (282326, '513d40bd70e069e9367b28e38fe76fc9', TIMESTAMP '2026-09-21 06:08:26.637', TIMESTAMP '2026-08-27 13:00:08.000'),
    (286145, 'f13a122082301565d50b0b9bd1d6dc01', TIMESTAMP '2026-10-16 07:41:16.882', TIMESTAMP '2026-10-08 13:52:14.000'),
    (287427, '055257214d260afc0ed0d4f38e5a6111', TIMESTAMP '2026-10-30 12:38:35.108', TIMESTAMP '2026-10-27 14:02:28.000'),
    (287602, '105413def473c8f31098325e812dffc2', TIMESTAMP '2026-11-01 11:11:20.664', TIMESTAMP '2026-06-29 18:53:10.000'),
    (287629, '5b6780350e6530616359355c9bc5e246', TIMESTAMP '2026-11-01 21:16:19.071', TIMESTAMP '2026-09-19 12:57:24.000'),
    (289826, 'aa6707fb1f489488539b7f0ec95175f4', TIMESTAMP '2026-11-18 09:45:21.465', TIMESTAMP '2026-09-29 13:15:57.000'),
    (289828, 'bfd0c8051728ba8d04986b8921c451f1', TIMESTAMP '2026-11-18 09:47:46.033', TIMESTAMP '2026-11-09 16:01:20.000'),
    (289829, '2f7e9f158a6038e487fc074f5e94bf28', TIMESTAMP '2026-11-18 09:51:12.018', TIMESTAMP '2015-04-14 11:42:57.000'),
    (289830, 'b10b30ebbbd50f3a096186b4add7f590', TIMESTAMP '2026-11-18 09:52:43.716', TIMESTAMP '2017-10-05 15:11:25.000')
) AS correction(bookmark_id, url_md5, previous_time, source_time)
WHERE b.id = correction.bookmark_id
  AND md5(b.target_url) = correction.url_md5
  AND b.published_at = correction.previous_time;
