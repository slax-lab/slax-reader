-- 两个方向都埋，才看得见 churn
ALTER TYPE event_kind ADD VALUE 'unstar';
ALTER TYPE event_kind ADD VALUE 'trash';
ALTER TYPE event_kind ADD VALUE 'trash_revert';

-- 取消归档早已直埋 inbox
-- 枚举缺失，写入被 pg 拒后吞掉
ALTER TYPE event_kind ADD VALUE 'inbox';
