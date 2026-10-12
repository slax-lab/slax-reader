# slax-reader-dweb 测试指南

测试体系按 .claude/test-framework/PLAN.md 设计。第三期 Sprint 0（2026-05-25）完成目录合并：原 `tests/components/` 并入 `tests/unit/components/`，三层简化为 unit / integration / e2e（第三期新增） / theme。

| 目录                       | 用途                          | 测试类型               |
| -------------------------- | ----------------------------- | ---------------------- |
| `tests/unit/utils/`        | 纯函数                        | 单元                   |
| `tests/unit/composables/`  | composable                    | 单元                   |
| `tests/unit/stores/`       | Pinia store                   | 单元                   |
| `tests/unit/components/`   | Vue 组件交互                  | 单元（含 ce.vue 单测） |
| `tests/integration/`       | 多组件 + store + router       | 页面集成（非 e2e）     |
| `tests/integration/pages/` | pages 集成（第三期 Sprint 4） | 页面集成               |
| `tests/e2e/`               | 真实浏览器（第三期 Sprint 2） | Playwright             |
| `tests/theme/`             | 主题与 iframe 注入            | 单元+组件混合（已有）  |

## 三件套基础设施

- `tests/setup/index.ts`：vitest 自动加载，挂全局 mock + DOM 清理 hook
- `tests/setup/i18n.ts`：`createTestI18n(locale)` 工厂（locale 仅 'en' / 'zh'）
- `tests/setup/pinia.ts`：`createTestPinia()` 工厂
- `tests/setup/mount.ts`：`mountWithApp(component, options)` —— 自动注入 i18n + pinia

## 写新 spec 的标准流程

1. **先 `Read` 被测源码全文**（强制纪律）
2. 镜像源码路径建 spec 文件：`layers/core/app/utils/foo.ts` → `tests/unit/utils/foo.spec.ts`；组件 `layers/core/app/components/Foo/Bar.vue` → `tests/unit/components/Foo/Bar.spec.ts`
3. 引入 fixture 当数据、引入 mock 当桩
4. `describe('xxx', () => { it('行为描述', ...) })`，禁止用例描述写成"测试 xxx 函数"
5. 跑 `pnpm test`、再跑 `pnpm test:coverage` 看新增文件覆盖率

## fixture / mock 怎么用

- **fixture = 假数据**（`tests/fixtures/*.ts`）：导出 `baseXxx` 基础对象 + `makeXxx(overrides)` 工厂
- **mock = 假行为**（`tests/mocks/*.ts`）：导出 `mockXxx` 函数，spec 内 `mockResolvedValueOnce` 控制返回

详见 .claude/test-framework/PLAN.md §5。

## Nuxt auto-import 怎么 mock

statically auto-imported 函数（`navigateTo` / `useRuntimeConfig` / `useRequestHeaders` / `request` 等）一律用 `mockNuxtImport('name', () => mockFn)`，**不要**用 `vi.stubGlobal`——编译后的导入绑定 stubGlobal 拦不到。

**关键约束（施工期发现）**：`mockNuxtImport` 是 macro，被 transform 成 `vi.mock` 后会被 hoist 到文件顶部，此时**跨文件 import 的 binding 仍在 TDZ**——不能从 `tests/mocks/*.ts` import spy 句柄传给 `mockNuxtImport` factory。每个 spec 必须在自己文件内用 `vi.hoisted` 声明 spy。

完整示例参考 [tests/unit/composables/useAuth.spec.ts](unit/composables/useAuth.spec.ts) 顶部 vi.hoisted + mockNuxtImport('request', ...) 的写法。

至于 `tests/mocks/request.ts` 的角色：它仅服务于"被测代码用**显式 import** 形式调 request()"的场景（目前只有 `components/Article/Selection/adapters/DwebHttpClient.ts`）。auto-import 场景请按上面 vi.hoisted 模式自建 mock。详见 mock 文件顶部的两套用法注释。

## 第四期决策树：废弃路径降级 + vitest exclude

第四期把所有 happy-dom 不可测路径与废弃组件移出主跑分母，靠 raw config 监控全量不退化。新增 spec 或处理"覆盖率不达标"问题时按下面树形决策。

```
新组件/文件想纳入主跑覆盖？
├─ 纯函数 / 简单组件（happy-dom 可跑） → 写 unit spec，单文件阈值 80/70/85/80
├─ 含真实 DOM 行为（iframe / SW / Selection / Custom Element） → 走以下分支：
│  ├─ 是新增功能 → 在 `.claude/test-framework/phase5-todo.md` 登记 + vitest exclude（vitest.shared.ts 加入 phase4ExcludeAdditions）+ 后期补 e2e
│  └─ 是改造既有 phase5 文件 → 评估能否抽 seam 让 unit 可达；若能就移出 exclude
├─ 是废弃路径专属（仅 w/sw 用）→ vitest exclude + phase5-todo 登记 deadline
└─ 是死代码（全 repo 无 import）→ vitest exclude + phase5-todo 标记调查删除
```

### 主跑 vs raw 二轮验证

- **`pnpm test:coverage`**（dweb 内）/ **`pnpm test:dweb:coverage`**（仓库根）→ 主跑（exclude 后）；阈值生效，KPI 阻塞
- **`pnpm test:coverage:raw`** / **`pnpm test:dweb:coverage:raw`** → raw 二轮（不含第四期 13 项 exclude）；不带阈值，仅监控全量行覆盖不退化（55% 基线）

### 单文件 / 目录 / global 阈值如何选择

- **单文件阈值 80/70/85/80**：每个治理过的活路径文件标准模板
- **降级单文件阈值 50/40/50/50（w/[id]）/ 50/30/50/50（sw/[id]）**：废弃路径页保底
- **目录通配阈值（pages/** 70/60/70/70 / utils/** 95/85/95/95）**：vitest perFile 检查，仅在目录下所有文件都达标时启用
- **global 阈值 65/55/65/65**：vitest.config.ts 顶层，exclude 后整体兜底
- **不为 composables/** / components/** 启用通配阈值**：因含未治理的 useArticle.ts / global/\* 等文件，perFile 通配会拦下

### KeepAlive / Transition / v-element-hover 治理 recipe

happy-dom 不可测路径的常用 seam 改造（第四期已落地实例）：

| 限制 | 治理方式 | 实例参考 |
| --- | --- | --- |
| `onDeactivated` 仅 KeepAlive 切换触发 | 在 spec 包 `<KeepAlive><Comp v-if="show" /></KeepAlive>`，`setProps({show:false})` | UserOperateIcon.spec.ts |
| `v-element-hover="state => isShow=state"` 内联 arrow 不触发 | 源码抽具名 `onHover`，spec 调 `setupState.onHover(true)` | AILanguageTips.vue + spec |
| `<Transition @after-leave>` 不真触发 | 源码抽 cleanup seam（buildXxxCleanup 闭包），spec mock 子组件立即 emit dismiss | Toast/index.ts + spec |
| `customElements.define` 重复注册 | mock CEComponents 时 factory 内只注册一次（`if (!customElements.get(name))`） | processors/video.spec.ts、modal.ts 顶层 guard |
| `vi.mock` factory hoist 引用错误 | 把 stub class 定义在 factory 内，副作用通过 `globalThis.__xxx` 中转，或用 `vi.hoisted({ ... })` 提前声明 | photo-swipe.processor.spec.ts、BookmarkArticle.spec.ts |
| `useAsyncData` 模板自动 unwrap | mock 必须返回 `{data: ref(...)}`（vue ref），不能裸 `{data:{value:...}}` | privacy.spec.ts |
| Async setup 组件 mount | 用 Suspense 包裹：`<Suspense><Comp /></Suspense>` + flushPromises | privacy.spec.ts / terms.spec.ts |
| `vi.fn().mockImplementation(() => obj)` 不能作 constructor | mock 链中需要 `new XxxClass()` 的 export 必须用 `class XxxClass {}` 风格 | BookmarkArticle.spec.ts MarkModal/DwebArticleSelection mock |
| 模板渲染 `useFoo().title`，mock 返 plain `{value: 'x'}` 失败 | mock 实现内部 `import { ref } from 'vue'` 包装 | BookmarkArticle.spec.ts useArticleDetail mock |
| `setupState.xxx.value = newVal` TypeError | runtime 已 unwrap；改测模板/事件触发或用别的入口 | ImagePreview.spec.ts、MarkMindMap.spec.ts |
| `defineCustomElement` mock 不能 `customElements.define` 注册 | happy-dom 不允许同 class 多 name；让源码顶层 guard 自己注册 | modal.spec.ts |
| `request().stream(...)` 流式协议 mock | mock 返 callBack 函数；`callBack(handler:(text,isDone)=>void)` | AISummaries.spec.ts |
| `protected override` 方法 setTimeout(0) 内分支 | spec `vi.useFakeTimers() + await vi.runAllTimersAsync()`；捕获 modal.showMenus 入参主动调三回调（callback/positionCallback/noActionCallback） | DwebArticleSelection.spec.ts |
