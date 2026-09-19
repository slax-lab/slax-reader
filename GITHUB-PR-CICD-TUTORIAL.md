# 教程：GitHub PR 与 CI/CD 工作流（含概念术语讲解）

> 本地学习用，不提交。读完可删。
>
> 与 `AGENTIC-PR-REVIEW-TUTORIAL.md` 的关系：那一份是"本仓库 AI 评审流水线"的案例解剖，假设你已经懂 PR 和 Checks；这一份是**地基**——把 PR 全流程和 CI/CD（GitHub Actions）的概念、术语、机制讲清楚，例子尽量用本仓库的真实文件。
>
> 前置假设：你懂 Git 本身（commit / branch / merge / rebase），不懂也没关系，第 1 章会先划清 Git 和 GitHub 的边界。

---

## 第 0 章 一张总图

```
本地                          GitHub（远端）
────                          ──────────────
写代码
  │
git push ──────────────► 分支更新
                            │
                       开 Pull Request（PR）
                            │
              ┌─────────────┼─────────────────┐
              │             │                 │
         CI 自动跑      人 / bot 评审      门禁（ruleset）汇总
         （Checks）    （Review）        必需检查绿 + 批准数够
              │             │                 │
              └─────────────┴─────────────────┘
                            │
                          合并（merge）
                            │
                       CD 自动部署（可选）
```

三个核心认知，先记住再往下读：

1. **PR 是 GitHub 的概念，不是 Git 的概念。** Git 只有分支和合并；"请求别人把我的分支合进去、合之前先讨论和检查"这一整套是 GitHub 在 Git 之上加的产品层。
2. **CI 是挂在 PR 上的自动检查，CD 是挂在合并（或发布）上的自动部署。** 两者用同一套引擎（GitHub Actions），只是触发时机和目的不同。
3. **合并能不能点，由 ruleset（分支保护规则）裁决。** 它看两样东西：必需的状态检查（required status checks）是否全绿、必需的评审批准（required approvals）是否凑齐。人对 PR 的评论、机器人的评论，默认都不挡合并。

---

## 第 1 章 Git ≠ GitHub

| 层 | 是什么 | 提供的能力 |
|---|---|---|
| **Git** | 本地版本控制工具（命令行） | commit、branch、merge、rebase、tag、remote 操作（push/fetch/pull） |
| **GitHub** | Git 仓库的托管服务 + 协作平台 | Pull Request、Issue、Code Review、Actions（CI/CD）、权限与团队、Wiki、Release、Packages |

几个最容易混的 Git 侧名词：

- **clone**：把远端仓库完整复制到本地，含全部历史。
- **remote / origin**：本地仓库记住的远端地址。`origin` 是默认 remote 的名字，不是特殊关键字。
- **push**：把本地 commit 推到远端分支。**fetch**：只把远端的新 commit 拉下来存着，不动你的工作区。**pull** = fetch + merge（或 rebase），会动工作区。
- **fork**：把别人的仓库复制一份到你自己的账号下。你没有原仓库的推送权限时，就在 fork 里改，再跨仓库开 PR。本仓库你是 owner，日常用分支即可，不需要 fork。
- **upstream**：fork 场景下对原仓库 remote 的习惯命名。

**为什么这个区分重要**：出问题时要先判断"这是 Git 层的问题还是 GitHub 层的问题"。`git push` 被拒绝是 Git 层；PR 上检查红了、合并按钮灰着，是 GitHub 层。

---

## 第 2 章 Pull Request 全流程与术语

### 2.1 PR 是什么

一个 PR 说的是一句话：**"请把 head 分支合并进 base 分支。"**

- **base**：合入的目标分支（通常是 `main`）。
- **head**：你开发用的源分支（如 `feat/add-bookmark-tags`）。
- PR 页面展示的 **diff** 是 base 与 head 的差异；你在 head 上每 push 一次，PR 自动更新，CI 自动重跑。

PR 页面的四个 Tab：

| Tab | 内容 |
|---|---|
| Conversation | 讨论区：描述、评论、review、CI 结果、时间线全在这里汇合 |
| Commits | 这个 PR 包含哪些 commit |
| Checks | 所有 CI 运行的汇总（详见第 3 章） |
| Files changed | 逐文件的 diff，行内评论（inline comment）就贴在这里 |

### 2.2 开 PR 时遇到的东西

- **PR template**：开 PR 时自动填进描述框的模板。本仓库的在 `.github/PULL_REQUEST_TEMPLATE.md`，里面要求填 `OpenSpec: <change-id>` 和 Test plan——模板是团队约定的入口。
- **Draft PR**：标记"还没准备好被评审"的 PR。CI 照跑，但 review 请求不会真正骚扰别人，也不能被合并。适合提前推上去看 CI 结果。
- **Linked issue**：描述里写 `Closes #123`，PR 合并时 GitHub 自动关掉 123 号 issue。`#123` 这种编号在 PR 和 issue 之间是通用的引用语法。
- **Reviewers / Assignees / Labels / Milestone**：右侧边栏。Reviewer 是"请谁来看"；Assignee 惯例上是"这事归谁推进"；Label 是分类标签（本仓库的自动化会认 `agentic-workflows` 这个 label，见 `.github/workflows/agentic-noise-cleanup.yml`）。
- **@mention 与 team**：`@某人` 会触发通知；`@org/team`（如本仓库 CODEOWNERS 里的 `@slax-lab/reader-core`）可以一次性请求整个团队。

### 2.3 Review（评审）机制

评审人看完 diff 后点 "Review changes"，三选一提交：

| 状态 | 含义 | 挡合并吗 |
|---|---|---|
| **Comment** | 只留言，不表态 | 不挡 |
| **Approve** | 批准 | 满足 ruleset 的"需要 N 个批准" |
| **Request changes** | 要求修改 | **挡**，直到同一人改口或按仓库规则被 dismiss |

相关术语：

- **Inline comment**：贴在 diff 某一行上的评论。可以多条攒在一起，随一次 review 统一提交。
- **Suggestion**：行内评论的特殊形式，直接给出替换代码，作者一键 "Apply suggestion" 提交。
- **Resolve conversation**：把一条讨论标记为已解决。本仓库的 ruleset 开了 **required conversation resolution**——未 resolve 的讨论会挡合并。
- **CODEOWNERS**：`.github/CODEOWNERS` 文件，声明"哪些路径归谁负责"。ruleset 开启 "Require review from Code Owners" 后，动到对应路径的 PR 必须有 owner 批准。本仓库的规则是兜底一条 `* @slax-lab/reader-core`（见 `.github/CODEOWNERS:5`），且该文件是 **LAST-MATCH-WINS**（最后命中的规则生效），所以兜底规则放最上面，细化规则放下面（文件里的注释专门解释了为什么这么排）。

### 2.4 三种合并策略

点 Merge 时按钮旁有三个选项，产出完全不同的历史：

| 策略 | 结果 | 适合 |
|---|---|---|
| **Merge commit** | 保留 head 分支的所有 commit，再加一个合并节点 | 想保留完整开发过程 |
| **Squash and merge** | 把整个 PR 压成**一个** commit 放到 base 上 | PR 里有很多 "fix typo""wip" 之类的碎 commit；主干历史保持一线 |
| **Rebase and merge** | 把 head 的 commit 逐个重放到 base 顶端，无合并节点 | 想要线性历史且 commit 本身已经干净 |

本仓库的惯例是 squash（`AGENTIC-PR-REVIEW-TUTORIAL.md` 第 6 步用的就是 `gh pr merge --squash`）。Squash 的一个实际后果：合并后 head 分支的原始 commit 不会出现在 main 上，所以分支可以安心删掉。

### 2.5 Ruleset / Branch protection（门禁）

仓库 Settings → Rules → Rulesets，对分支施加规则。本仓库对 main 用的关键项：

- **Require a pull request before merging**：禁止直接 push 到 main。
- **Required approvals**：至少 N 个 Approve。
- **Require review from Code Owners**：配合 CODEOWNERS。
- **Required status checks**：指定的检查必须为 success 才能合并（第 3 章展开）。本仓库要求的那条叫 `Agentic PR review`。
- **Require conversation resolution**：讨论必须全部 resolve。
- **Require linear history**：禁止 merge commit，配合 squash/rebase。

**绕过机制**：admin 可以在 ruleset 里被设为 bypass actor，紧急时强合。这是逃生门，不是日常路径。

### 2.6 其他常见名词

- **Issue**：任务/缺陷/讨论单，和 PR 共享编号空间。
- **Milestone**：把一组 issue/PR 归到一个发布目标下。
- **Release / Tag**：tag 是 Git 的打标；Release 是 GitHub 在 tag 之上加的发布页（可附 changelog 和二进制产物）。
- **Watch / Star / Fork 数**：仓库页的社交信号，无功能影响。
- **Merge queue**：多人同时合 main 时的排队机制，按序把每个 PR 与最新 main 预合并验证后再落地。大团队防"你合我合互相撞"用，小团队一般用不上。

---

## 第 3 章 CI/CD 概念

### 3.1 定义

- **CI（Continuous Integration，持续集成）**：每次代码变更（push / PR）自动构建 + 测试 + 静态检查，尽快暴露问题。
- **CD** 有两个意思，语境里要分清：
  - **Continuous Delivery（持续交付）**：合并后自动构建出**可部署**的产物，部署动作由人触发。
  - **Continuous Deployment（持续部署）**：合并后**自动**部署到生产，无人干预。
- 业界口头说 "CI/CD" 时，多数指"代码一合并，流水线自动跑完测试并上线"这一整条。

### 3.2 为什么 CI 挂在 PR 上

核心思想是**把质量检查左移到合并之前**：不合代码不进主干，主干永远保持可构建、可发布。PR 是"合并前"这个时点天然的存在，所以 CI 结果直接渲染在 PR 页面上，并由 required status checks 变成硬门禁。

### 3.3 Status check：CI 与门禁之间的接口

这是理解 GitHub CI 的关键机制，分两层：

- **Check run / Check suite**：GitHub Actions 每个 job 运行时自动产生的新式检查对象，带丰富输出（日志、注解），显示在 PR 的 Checks tab。
- **Commit status**：更老的 API，就是给某个 commit 打一个 `pending/success/failure/error` 状态，带一个 `context` 名字。本仓库的门禁 workflow 就是直接调这个老 API 上报状态（`.github/workflows/pr-review-gate.yml:138` 的 `POST repos/$REPO/statuses/$SHA`，context 为 `Agentic PR review`）。

Required status check 按 **context 名字**认检查。一个反直觉的事实（本仓库踩过坑，写在 gate 文件头注释里）：**一个被 skip 的 job，对 required check 来说算通过**。所以 gate workflow 的设计原则是"fail closed"——只要没能确认评审真的发生并发布，就报 failure（`.github/workflows/pr-review-gate.yml:129-135`）。

---

## 第 4 章 GitHub Actions 解剖

GitHub Actions 是 GitHub 自带的 CI/CD 引擎。配置就是放在 `.github/workflows/` 下的 YAML 文件，推到仓库即生效。

### 4.1 层级模型

```
Workflow（一个 YAML 文件）
  └── Job（多个，默认并行跑在不同 runner 上）
        └── Step（串行）
              ├── run: 执行 shell 命令
              └── uses: 调用一个封装好的 action
```

用本仓库的真实文件逐行解剖 `.github/workflows/pr-review-gate.yml`：

```yaml
name: PR review gate                    # workflow 的名字，显示在 Actions 页

on:                                     # 触发器：什么时候跑
  workflow_run:                         # 当另一个 workflow 跑完时
    workflows: ["PR Review", "PR Review (on demand)"]
    types: [completed]

permissions:                            # 本次运行里 GITHUB_TOKEN 的权限（最小授权）
  actions: read
  contents: read
  pull-requests: read
  statuses: write                       # 因为要打 commit status，需要这个写权限

jobs:
  gate:                                 # job id
    runs-on: ubuntu-latest              # 跑在什么 runner 上
    steps:
      - name: Report the gate status...
        env:                            # 这一步的环境变量
          GH_TOKEN: ${{ github.token }} # ${{ }} 是表达式，引用上下文对象
        run: |                          # 多行 shell 脚本
          set -euo pipefail
          ...
```

### 4.2 触发器（on）

| 触发器 | 何时跑 | 本仓库实例 |
|---|---|---|
| `push` | 推送到匹配分支 | （编译型 lock 文件内使用） |
| `pull_request` | PR 开/更新/重开 | pr-review.lock.yml（编译产物） |
| `workflow_run` | 另一个 workflow 完成 | `pr-review-gate.yml:16` |
| `schedule`（cron） | 定时 | `agentic-noise-cleanup.yml`（`41 */6 * * *`） |
| `workflow_dispatch` | 人在 Actions 页手动点 "Run workflow" | 同上，便于手动触发 |
| `issue_comment` | PR/issue 下出现评论 | pr-review-command.lock.yml（实现 `/review` 命令） |

三个值得知道的机制（都是本仓库文件里实测记录下来的）：

1. **`workflow_run`、`workflow_dispatch`、`issue_comment` 触发的 workflow，必须已经存在于默认分支上才会生效**（`pr-review-gate.yml:12-13` 注释）。改动这类触发器要先合并才测得了。
2. **用 `GITHUB_TOKEN` 产生的事件不会再触发新 workflow**（防递归）。例外只有 `workflow_dispatch` 和 `repository_dispatch`。本仓库的 noise-cleanup 第一版加了 `issues: [opened]` 触发器，永远不会跑——因为那些 issue 是 bot 用 `GITHUB_TOKEN` 开的（`agentic-noise-cleanup.yml` 头注释），最后改成了定时扫。
3. `pull_request` 事件里 checkout 到的是**合并预览 commit**（`refs/pull/N/merge`），不是 PR 分支自己的 head。要给"被评审的那个 commit"打状态时必须注意区分（`pr-review-gate.yml:80-86`）。

另外：**fork 来的 PR，secrets 默认不可见**（防止有人改一行 YAML 偷你的密钥），`GITHUB_TOKEN` 也降级为只读。

### 4.3 step 的两种形态：run 与 uses

- `run:` 直接写 shell。gate workflow 全是这种。
- `uses:` 调用一个**action**——别人封装好的可复用步骤。来源有三种：
  - GitHub 官方：`actions/checkout`（拉代码）、`actions/cache`（缓存依赖）、`actions/upload-artifact`
  - Marketplace 第三方：生态里上万个
  - 本地路径：`./.github/actions/xxx`（仓库内自定义）

**安全实践：SHA pinning**。本仓库编译产物里所有 `uses:` 都钉在完整 commit SHA 上，版本号只写在注释里（`.github/workflows/pr-review.lock.yml:219`：`uses: actions/checkout@3d3c42e5... # v7.0.1`）。原因：tag 可以被作者重新指向恶意代码，SHA 不可变。供应链安全要求高的仓库都这么做。

### 4.4 Runner

Job 的执行机。`runs-on: ubuntu-latest` 用的是 **GitHub-hosted runner**：每次运行给一台全新虚拟机，跑完销毁。也有 **self-hosted runner**（自己的机器，用于特殊硬件/内网/省钱）。公共仓库用 GitHub-hosted runner 免费；私有仓库有月度免费分钟数，超出计费（具体额度以 GitHub 官网当时页面为准）。

### 4.5 表达式、上下文与密钥

- `${{ <表达式> }}`：YAML 里的插值语法，运行时求值。
- **上下文（context）**：内置对象。常用的：
  - `github.*`：本次运行的元信息（`github.repository`、`github.sha`、`github.run_id`、`github.event` 是完整事件 payload）
  - `github.token`：本次运行自动签发的临时 token，权限由 workflow 顶部的 `permissions:` 块限定
  - `secrets.*`：仓库/组织级加密密钥（Settings → Secrets and variables → Actions），日志里自动打码
  - `vars.*`：非加密的配置变量。本仓库用 `vars.PR_REVIEW_ENABLED == 'false'` 做 AI 评审的总开关（`.github/workflows/pr-review-paused-notice.yml:28`）
- **`env:`** 定义环境变量，可挂在 workflow / job / step 任一层级。

**密钥的纪律**：永远不 `echo` secret（会被打码但不要依赖打码）；永远不进 git；workflow 里通过 `env: X: ${{ secrets.X }}` 注入。本仓库 AGENTS.md 的 Sensitive Files 一节同样禁止 agent 读取任何 `.env`。

### 4.6 其他高频机制（本仓库暂未全用，列给你认个脸）

| 机制 | 干什么 | 长什么样 |
|---|---|---|
| `strategy.matrix` | 同一 job 按参数组合跑多份（多 Node 版本、多 OS） | `matrix: { node: [20, 22] }` |
| `actions/cache` | 缓存依赖目录，加速 CI | `uses: actions/cache@v4` |
| Artifacts | job 之间或向用户传递文件产物（构建包、测试报告） | `actions/upload-artifact` |
| `concurrency` | 同一 PR 反复 push 时取消旧运行，省钱省时间 | `concurrency: { group: ..., cancel-in-progress: true }` |
| `environment` | 给部署 job 挂保护环境（人工审批、环境级 secrets） | `environment: production` |

---

## 第 5 章 CD：部署那一半

本仓库目前**没有** CD workflow——`.github/workflows/` 下全是 CI 和评审自动化。这里讲通用模式，等你给 backend（Cloudflare Workers）加部署时可以直接套：

```yaml
name: Deploy backend
on:
  push:
    branches: [main]          # 合并进 main 即触发
    paths: ['apps/backend/**'] # 只关心 backend 目录的变化

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production    # 挂保护环境，可要求人工点 Approve 才继续
    steps:
      - uses: actions/checkout@<pin-sha>
      - uses: pnpm/action-setup@<pin-sha>
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter backend run deploy   # 内部走 wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

模式要点：

1. **CI 与 CD 分文件**：CI 挂在 `pull_request`（合并前挡人），CD 挂在 `push to main`（合并后上线）。
2. **用 environment 做生产闸门**：`environment: production` 配上 required reviewers，就变成 Continuous Delivery（自动构建、人工放行）；不配就是 Continuous Deployment（全自动）。
3. **密钥只进 secrets**，用最小权限的 token。
4. **部署也要可观测**：失败时 Actions 页有红运行；正式项目还应配通知（Slack/飞书 webhook）。

---

## 第 6 章 gh CLI 速查

`gh` 是 GitHub 官方命令行，本仓库的两个教程和 workflow 脚本里大量使用。日常够用的子集：

```bash
# PR
gh pr create --draft                 # 开草稿 PR
gh pr list / gh pr status            # 列表 / 与我相关的
gh pr view 24 --web                  # 浏览器打开
gh pr checks 24                      # 看检查状态（等结果用 --watch）
gh pr diff 24                        # 看 diff
gh pr review 24 --approve            # 批准
gh pr merge 24 --squash              # squash 合并
gh pr ready 24                       # 草稿转正

# Actions
gh run list                          # 最近的 workflow 运行
gh run view <run-id>                 # 看某次运行
gh run view <run-id> --log-failed    # 只看失败 job 的日志（排障首选）
gh run rerun <run-id> --failed       # 重跑失败的 job
gh workflow list / gh workflow view <name>

# API 逃生门（UI/CLI 做不到的都走这）
gh api repos/OWNER/REPO/pulls/24/reviews --jq '.[].state'
gh api -X POST repos/OWNER/REPO/statuses/<sha> -f state=success -f context=xxx
```

`pr-review-gate.yml` 整个就是 `gh api` + `jq` 的组合拳，想练手直接读它。

---

## 第 7 章 动手练习

读一百遍不如跑一遍。前两个是只读的，直接在本仓库做；后面的写操作去你自己账号下新建一个 scratch 仓库练，不碰共享仓库。

**只读（本仓库）**

1. `gh pr list --state all --limit 20`，挑一个已合并的 PR，`gh pr view <n>` 看描述里的 `OpenSpec:` 行与模板结构。
2. `gh run list --limit 10`，找一个失败的，`gh run view <id> --log-failed` 把日志读完，回答：哪个 job 挂了、挂在哪条命令。
3. 打开 `.github/workflows/pr-review-gate.yml`，对照第 4.1 节，把每一行归类到 name/on/permissions/jobs/steps/env/run。
4. 在 GitHub 网页打开仓库 → Settings → Rules → Rulesets，看 main 的规则集，对照第 2.5 节逐条认出本仓库开了哪些。

**写操作（scratch 仓库）**

5. 建仓库 → 开分支 → 随便改个文件 → push → `gh pr create`。观察：没有 CI 时合并按钮直接可用。
6. 加一个最小 CI（下面这份即可），push 后重开 PR，观察 Checks tab 出现、以及它如何影响合并按钮：

```yaml
# .github/workflows/ci.yml
name: CI
on: [pull_request]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "pretend this is pnpm test" && exit 0   # 改成 exit 1 看红什么样
```

7. 在 Settings → Rules 给 main 加 required status check（context 名填 `test`），然后把 `exit 0` 改成 `exit 1` 再 push，亲眼看合并被挡。
8. 练习三种合并策略：连开三个小 PR，分别用 merge commit / squash / rebase 合并，然后 `git log --graph --oneline` 对比历史形状。

---

## 第 8 章 排障速查

| 症状 | 先看哪里 |
|---|---|
| 合并按钮灰的 | PR 页底部合并框会列出缺什么：缺的 check 名、缺的批准数、未 resolve 的讨论 |
| 某个 check 红了 | Checks tab → 点进去 → 失败 job → `gh run view <id> --log-failed` |
| 该跑的 workflow 没跑 | 触发器是否要求"已在默认分支上存在"（第 4.2 节机制 1）；是不是被 `paths` 过滤掉了 |
| 一个事件的连锁反应没发生 | 检查是不是 `GITHUB_TOKEN` 触发的事件（第 4.2 节机制 2，不递归） |
| required check 一直 pending | workflow 没上报这个 context；或 check 名与 ruleset 里配的不一致（大小写敏感） |
| skipped 的 job 居然算过 | 这是设定行为（第 3.3 节），门禁要自己 fail closed |
| fork PR 里 secret 是空的 | 设定行为（第 4.2 节），需要 `pull_request_target`（高危，用前读官方文档） |
| 想看某个 commit 上所有状态 | `gh api repos/OWNER/REPO/commits/<sha>/status` |

---

## 附录 名词速查表

| 术语 | 一句话解释 |
|---|---|
| Pull Request (PR) | 请求把 head 分支合进 base 分支的协作单元，承载讨论、评审、CI |
| base / head | PR 的目标分支 / 源分支 |
| Draft PR | 标记"未就绪"的 PR，不请求评审、不可合并 |
| Review | 一次正式评审，状态为 Comment / Approve / Request changes |
| Inline comment | 贴在 diff 某行的评论 |
| CODEOWNERS | 声明路径归属的文件，可强制 owner 评审 |
| Ruleset | 分支保护规则集，裁决能否合并 |
| Required status check | ruleset 点名必须为 success 的检查 |
| Check run | Actions job 产生的新式检查对象 |
| Commit status | 老式 API：给 commit 打一个带 context 名的状态 |
| CI / CD | 持续集成（合并前自动检查）/ 持续交付或部署（合并后自动发布） |
| Workflow | 一个 YAML 定义的自动化流程 |
| Job | workflow 内的执行单元，默认互相并行 |
| Step | job 内的串行步骤，`run`（shell）或 `uses`（action） |
| Action | 可复用的封装步骤，来源官方/Marketplace/本地 |
| Runner | 执行 job 的机器，GitHub-hosted 或 self-hosted |
| Trigger (`on`) | 触发 workflow 的事件（push、pull_request、schedule……） |
| `GITHUB_TOKEN` | 每次运行自动签发的临时凭据，权限由 `permissions:` 限定 |
| Secrets / Vars | 加密密钥 / 明文配置，仓库或组织级 |
| Artifact | workflow 产出的可下载文件包 |
| Environment | 部署目标抽象，可挂审批与独立 secrets |
| gh | GitHub 官方 CLI |
