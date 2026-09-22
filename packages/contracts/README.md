# @slax-reader/contracts

供 Web、扩展、CLI 和 API 共用的 HTTP JSON 类型。零运行时依赖，不引用 Prisma、Cloudflare bindings、服务端 Context 或应用源码。

```ts
import { ErrorName, MarkType } from '@slax-reader/contracts'
import type { ApiResponse, ApiKeyListItem, AddUrlBookmarkRequest } from '@slax-reader/contracts'

const request: AddUrlBookmarkRequest = { target_url: 'https://example.com', tags: [] }
type KeyListResponse = ApiResponse<ApiKeyListItem[]>
```

工作区消费者在自己的 package.json 中声明 `"@slax-reader/contracts": "workspace:*"`，再从包名导入。也可使用 `/http`、`/errors`、`/bookmarks`、`/marks`、`/tags`、`/collections`、`/api-keys`、`/events` 子路径。不要跨目录导入 apps/api。

这是私有源码包：exports 指向 TypeScript，由应用的 TypeScript 工具链、Wrangler 或前端 bundler 编译。当前不发布 npm，也不提供供普通 Node 直接执行的编译后 JS；未来 Docker adapter 应在自己的构建中编译依赖。

## 协议边界

- `ApiResponse<T>` 是 `{ data, message, code }`；`T` 含 undefined 时 data 可省略。`null` 与省略不同。body code 不保证等于 HTTP status。
- DTO 默认使用 JSON 日期字符串。API 内部用 `ApiKeyListItem<Date>`、`BookmarkTag<Date>`、`MarkDetail<Date>` 等显式表示序列化前的数据，不改变现有 Date 对象或序列化行为。
- 当前 hashid 是 **number**，UUID 是 string；没有统一改成字符串。`start_offet`、`taget_cover`、`subscrition_count` 等现有拼写保持兼容。
- 分页只共享真实通用结构：URL 的 `PageQuery`/`CursorQuery` 使用字符串，`CursorPage<T>` 保留 `next_cursor: string | null`。没有替不同接口统一分页默认值、上限或参数名。
- 标记 `source` 是解析后的数组或数字，`approx_source` 可为空对象或 null；无可见标记时 `user_list` 保留历史空数组，有内容时为 ID 映射。来源包含 share、bookmark 和 collection。
- `/events` 使用自己的裸响应 `{ received, dropped }` 或 `{ error }`，不套普通 envelope；服务端仍自行校验输入、取得身份并提交内部事件。
- 类型不会校验网络输入。现有控制器的解析、权限与运行时校验留在 API。

## 当前覆盖

公共错误名称和 MarkType、响应 envelope、分页、书签创建/编辑/标签请求及导出结果、标记创建/删除与列表、标签请求/响应、合集设置与列表、API Key 请求/响应、客户端事件请求/响应。API 原模块保留类型别名以兼容内部调用，定义以本包为准。

数据库 PO、Worker Env、内部队列/Workflow、鉴权实现不属于本包。尚未整理的其余 HTTP 接口仍在 API，尤其是直接展开数据库行的书签详情/列表，不能把旧 PO 或未使用的 DTO 当成已经完整核对的公开合约。

## 验证

`pnpm --filter @slax-reader/contracts typecheck` 在没有 Node、DOM、Cloudflare ambient types 的环境下检查源码与消费者样例。`pnpm api -- typecheck` 包含该检查；`pnpm api -- test` 包含实际控制器序列化兼容测试。API CI 同时监听本目录，四 Worker bundle 验证运行时枚举依赖可打包。
