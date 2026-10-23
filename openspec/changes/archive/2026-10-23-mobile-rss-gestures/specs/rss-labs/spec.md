# Spec Delta

## MODIFIED Requirements

### Requirement: Native application RSS user experience

APP SHALL 使用原生 Compose 实现实验室设置、订阅管理和文章列表。每个 RSS 订阅源 SHALL 在 Inbox 顶部来源栏中与我的 Inbox、Collection 平级，以圆形图标直接切换内容，不使用独立 RSS 首页路由。文章 SHALL 通过现有 BookmarkRoutes / DetailScreen 的 RSS 来源模式打开，复用现有阅读器排版、平台滚动容器及图片查看；预览不创建书签，收藏仅由用户显式触发。

来源栏 SHALL 在存在订阅时以固定首位提供“全部”来源，表示所有订阅的合并时间线，并作为默认选择；用户选择任一单一订阅后 SHALL 仍可返回“全部”。切换来源时，APP SHALL 在显示新来源前清除上一来源的滚动位置，新来源 SHALL 从顶部开始，且来源栏自身的横向位置不得因切换而重置。

#### Scenario: Shared bookmark reader
- **WHEN** 用户在 Android 或 iOS 上从 RSS 列表打开含图片的文章
- **THEN** 系统将后端净化的缓存 HTML 交给现有书签详情阅读器，复用正文渲染及图片查看，不启动书签同步、划线或 AI 操作

#### Scenario: Select an RSS source beside collections
- **WHEN** 用户在 Android 或 iOS 首页点击顶部某个 RSS 圆形来源图标
- **THEN** 在同一首页显示该源文章，图标呈选中状态；点击我的 Inbox 或 Collection 直接切回对应内容，顶部不再出现第二排 RSS 来源选择，也不在 Inbox 下拉菜单增加 RSS 项

#### Scenario: Return to all sources after selecting one
- **WHEN** 用户先选择某个 RSS 订阅，再点击来源栏首位的“全部”
- **THEN** 页面显示所有订阅的合并时间线，“全部”图标呈选中状态，单一订阅图标不再选中

#### Scenario: Switch sources while the previous source is scrolled
- **WHEN** 用户在一个已滚动的 RSS 来源中点击另一个来源或“全部”
- **THEN** 新来源从列表顶部开始显示，不恢复上一来源的滚动位置
- **AND** 来源栏保持在用户当前的水平位置，不因列表切换而跳动

#### Scenario: Add a source from the shared rail
- **WHEN** 用户点击顶部来源栏末尾的添加 RSS
- **THEN** 已开启实验室时显示底部订阅表单，未开启时前往设置；名称可修改，输入及错误在失败后保留，成功后关闭表单并选中新订阅

#### Scenario: Settings only controls the RSS experiment
- **WHEN** 用户在 APP 设置中开启或关闭 RSS 实验室
- **THEN** 设置页只读取和写入实验室状态，不加载 RSS 订阅或文章，不跳转到内容页；开启失败保留已确认状态并提供重试

#### Scenario: RSS uses Inbox feed components
- **WHEN** 用户打开已启用的 RSS 内容页
- **THEN** 页面复用 Inbox 顶部来源栏、导航、分隔线和圆角列表；RSS 采用网页的圆形站点图标、文字回退及名称，文章行显示来源时间、标题、摘要和右侧缩略图；订阅管理使用菜单和底部面板

#### Scenario: Save before bookmark synchronization completes
- **WHEN** 后端确认收藏而本地书签同步尚未完成
- **THEN** APP 在当前 RSS 详情显示已收藏，并更新首页缓存及按钮状态，保持阅读位置，不等待 PowerSync 或自动跳转

#### Scenario: Save actions in the shared reader
- **WHEN** 用户阅读 RSS 文章
- **THEN** 详情顶部显示收藏到 Inbox、打开原文按钮；正文和头部总高度超过当前视口时，文章末尾也显示收藏按钮，短文章不重复显示；图片加载或视口变化后更新测量，两处按钮共享忙碌和收藏状态

#### Scenario: Return to the source list
- **WHEN** 用户从详情返回首页，或者在来源栏切换 RSS 与 Inbox
- **THEN** 原列表保留缓存、选择和滚动位置，预览或收藏不会重新创建首页
