# i18n key 覆盖报告（第四期 Sprint B.4）

> 生成日期：2026-05-26扫描范围：apps/slax-reader-dweb/layers/\*\* 扫描方式：grep `t('xxx.yyy')` / `$t('xxx.yyy')` 形式（仅含 `.` 的 i18n key 字面量）

## 结果

- **使用的 key 总数**：223
- **en.json 总 key 数**：489
- **zh.json 总 key 数**：489
- **en 缺失**：0
- **zh 缺失**：0
- **en 与 zh 不对齐**：0

## Sprint B.4 修复

- 新增 `common.error.network`（en + zh）：消除 BookmarkList/TagsHeader.vue:110/190 的 `[intlify] Not found` 警告
- 全扫脚本（一次性）：参见 commit message 内联 python 片段；后续期数若新增 key 应同步两侧 locale

## 已知未使用 key（en/zh 多余，需要后续清理）

通过 `en_keys - used` 计算：266 项（多为 settings / 嵌入 modal / docs.title 等 vue setup 用 query 取的动态 key），暂不在第四期清理范围。
