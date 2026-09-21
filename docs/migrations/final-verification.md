# 前端迁移最终验收 / Final frontend verification

[迁移记录 / Migration record](slax-reader-web-extension.md) · [参与指南 / Contributing](../contributing/README.md)

Web、扩展和共享库已迁入集成分支，阶段检查结果见迁移记录。本清单记录仍需收尾的工作，
不表示所有检查已通过。最终合入 `dev` 必须通过 PR。
Web, Extension and their shared packages are imported on the integration branch. Stage results are in the migration record; the remaining checks below are not claimed as passed. Final integration into `dev` requires a PR.

## 完整安装 / Full installation

- [ ] 在干净工作树运行带安装脚本的 `pnpm install --frozen-lockfile`，记录系统、CPU、Node/pnpm 版本和结果。/ Run a clean install with lifecycle scripts enabled and record the platform and tool versions.
- [ ] 回看 macOS 的 `better-sqlite3` 安装失败：为何未使用预编译包，是否仅需 Command Line Tools，以及本机 Xcode 许可状态。许可须由使用者自行处理。/ Investigate prebuilt binary selection, Command Line Tools sufficiency and the host license state; the user handles license acceptance.
- [ ] 安装通过后，按 app 指南完成 prepare、类型检查、测试与构建。/ Run the documented app checks after installation succeeds.

之前的 `--ignore-scripts` 只验证了依赖解析和链接，不能替代完整安装。
Xcode 不应成为在线文档、反馈或翻译贡献的前置条件；其他平台使用各自的编译工具。
Earlier installs with scripts disabled validated resolution/linking only. Xcode is not a requirement for online documentation, feedback or translation contributions; native build tools are platform-specific.

## 真实开发 backend 联调 / Real development backend

按用户要求，全部迁移阶段完成后统一进行。使用开发测试账户和开发者提供的配置，不复制旧仓库环境文件，不部署生产服务。
As requested, run these checks after the migration stages using development accounts and supplied configuration. Do not copy legacy environment files or deploy production services.

| 待验收 / Check | 通过标准 / Expected result |
| --- | --- |
| Web 登录 / Web login | 登录、退出与会话状态正常 / Login, logout and session state work |
| 书签 / Bookmarks | 列表可读，收藏状态能同步 / List loads and save state synchronizes |
| 阅读 / Reading | 文章打开与内容展示正常 / Articles open and render |
| 划线评论 / Highlights and comments | 创建、读取和相应交互正常 / Creation, retrieval and relevant interactions work |
| 扩展与 Web / Extension bridge | 同一开发环境下登录识别、收藏、划线与 Web 数据协作正常 / Session detection, saving and annotations work with Web data |

以上五项目前均待真实环境验收。记录环境、提交号、操作步骤、实际结果和待修问题；不在记录中保存 token 或账户私密信息。
All five require real-environment verification. Record the environment, commit, steps, results and remaining issues without storing tokens or private account data.

## 合入前收尾 / Before the final PR merges

- [ ] 用户集中反馈的问题已核对、修复或明确记录。/ Triage and resolve or explicitly record the user's collected feedback.
- [ ] 旧前端仓库仍保持未修改，导入来源与差异可追溯。/ Confirm the source remains untouched and provenance is accurate.
- [ ] 与届时最新 `dev` 的兼容性、冲突和 CI 检查完成。/ Check compatibility with current `dev`, resolve conflicts and complete CI.
- [ ] `pnpm exec openspec validate --all --strict` 通过，任务状态与实际一致。/ Strict OpenSpec validation passes and task status matches the evidence.
- [ ] 集成分支的 PR 描述注明 `OpenSpec: integrate-slax-reader-web-extension`，列出验证和限制。/ Link the OpenSpec change and summarize validation and limitations in the integration PR.

此迁移尚未提供自动 PR 预览、免后端演示或经过验收的全平台安装方案。现有仓库 CI 侧重配置一致性，
不能把它通过等同于 Web/Extension 功能全部通过；应用检查需要在 PR 中单独报告。
This migration does not provide automatic previews, a backend-free demo or verified installation on every OS. Configuration CI passing is not proof that all app behavior passed; report app checks separately.
