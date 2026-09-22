-- CreateTable
CREATE TABLE "slax_bookmark_raw" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "shard_idx" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL DEFAULT '',     -- 归一化后的内容，用于全文搜索
    "title" TEXT NOT NULL DEFAULT '',      -- 归一化后的标题，用于全文搜索
    "raw_content" TEXT NOT NULL DEFAULT '', -- 原始内容，用于展示和高亮
    "raw_title" TEXT NOT NULL DEFAULT ''  -- 原始标题，用于展示和高亮
);

-- CreateIndex
CREATE INDEX "slax_bookmark_raw_bookmark_id_idx" ON "slax_bookmark_raw"("bookmark_id");

-- 创建FTS5虚拟表
CREATE VIRTUAL TABLE slax_fts_bookmark USING fts5(
    content,                           
    title,                            
    content='slax_bookmark_raw',   
    content_rowid='id',
    tokenize='porter unicode61 remove_diacritics 2'
);

-- 创建触发器：插入数据时自动更新FTS表
CREATE TRIGGER after_insert_raw 
AFTER INSERT ON slax_bookmark_raw
BEGIN
    INSERT INTO slax_fts_bookmark(rowid, content, title)
    VALUES (new.id, new.content, new.title);
END;
 
-- 创建触发器：删除数据时自动更新FTS表
CREATE TRIGGER after_delete_raw 
AFTER DELETE ON slax_bookmark_raw
BEGIN
    INSERT INTO slax_fts_bookmark(slax_fts_bookmark, rowid, content, title)
    VALUES('delete', old.id, old.content, old.title);
END;

-- 创建触发器：更新数据时自动更新FTS表
CREATE TRIGGER after_update_raw 
AFTER UPDATE ON slax_bookmark_raw
BEGIN
    INSERT INTO slax_fts_bookmark(slax_fts_bookmark, rowid, content, title)
    VALUES('delete', old.id, old.content, old.title);
    INSERT INTO slax_fts_bookmark(rowid, content, title)
    VALUES (new.id, new.content, new.title);
END;