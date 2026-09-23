# Tasks

## 1. 共享规则改为分支不变量

- [x] 1.1 在 `.rulesync/rules/overview.md` 删除 `Parallel Work — Worktree Convention` 章节，替换为 `Branching and Promotion`：保留推广流程原文，条目只留一任务一分支一 PR、长寿分支零提交、session 启动先切任务分支、delta-spec 不并行。
- [x] 1.2 在同一文件末尾新增 `Personal Local Instructions` 引导节：存在 `AGENTS.local.md` / `CLAUDE.local.md` 时读取并遵循，冲突以本地文件为准。
- [x] 1.3 运行 `pnpm agent:sync` 重新生成 `AGENTS.md` / `CLAUDE.md`，核对 diff 与源改动一致且无其他生成物漂移。

## 2. 本地提交守卫

- [x] 2.1 在 `lefthook.yml` 新增 `long-lived-branch` pre-commit 守卫，拒绝在 `dev`/`beta`/`main` 上的非 merge 提交，fail_text 指引切任务分支；放行 merge commit（`MERGE_HEAD` 存在时）以保留 sync-back 冲突解决流程。
- [x] 2.2 双向实测守卫：任务分支上放行、`dev` 上拦截、merge 提交放行；同步更新 lefthook.yml 头部职责注释。

## 3. 忽略规则与个人覆盖文件

- [x] 3.1 `.gitignore`：`.worktrees/` 改注为 legacy 位置（磁盘上仍有残留目录），`.local/` 注释补充 task worktrees 位于 `.local/worktrees/`。
- [x] 3.2 在操作员主 checkout 根目录手写 `AGENTS.local.md`（gitignored 不入库）：一律 worktree 的覆盖指令、`.local/worktrees/` 路径、创建时自我复制的 `cp` 片段、不编辑其他 worktree、合并后清理。

## 4. 验证与交付

- [x] 4.1 `openspec validate --all --strict` 通过；lefthook 全绿。
- [x] 4.2 按 REVIEW.md 完成 pre-push review，提交、推送，PR 目标 `dev`，PR body 携带 `OpenSpec: local-worktree-convention`。
- [ ] 4.3 PR 合并后归档本 change（`openspec archive`），并清理任务 worktree 与分支。
