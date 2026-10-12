-- 星标合集观测：访问 / 分享 / 订阅 / 退订
-- 枚举缺失时 pg 拒写，而 LogsService.track 的 try/catch 会吞掉异常 —— 静默丢数据。
-- 所以本迁移必须先于代码上线。
ALTER TYPE event_kind ADD VALUE 'collection_visit';
ALTER TYPE event_kind ADD VALUE 'collection_share';
ALTER TYPE event_kind ADD VALUE 'collection_subscribe';
ALTER TYPE event_kind ADD VALUE 'collection_unsubscribe';
