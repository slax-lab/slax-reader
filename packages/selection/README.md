# @slax-reader/selection

Selection模块的共享核心逻辑，用于dweb和extensions两个项目。

## 架构设计

### 核心理念

- **依赖注入**：所有外部依赖通过适配器接口注入
- **适配器模式**：隔离环境差异（浏览器扩展 vs Nuxt应用）
- **单一职责**：每个类专注于一个功能领域

### 目录结构

```
src/
├── core/           # 核心业务逻辑（无环境依赖）
│   ├── Base.ts
│   ├── MarkRenderer.ts
│   ├── MarkManager.ts
│   └── ArticleSelection.ts
├── adapters/       # 适配器接口定义
│   ├── IUserProvider.ts
│   ├── IHttpClient.ts
│   ├── IToastService.ts
│   ├── II18nService.ts
│   ├── IEnvironmentAdapter.ts
│   └── IModalRenderer.ts
└── types/          # 类型定义
    └── index.ts
```

## 使用方式

### Extensions端

```typescript
import { SelectionFactory } from '@slax-reader/selection'
import {
  ExtensionsUserProvider,
  ExtensionsHttpClient
  // ... 其他适配器
} from './adapters'

const selection = SelectionFactory.create(config, {
  userProvider: new ExtensionsUserProvider(config),
  httpClient: new ExtensionsHttpClient()
  // ...
})
```

### Dweb端

```typescript
import { SelectionFactory } from '@slax-reader/selection'
import {
  DwebUserProvider,
  DwebHttpClient
  // ... 其他适配器
} from './adapters'

const selection = SelectionFactory.create(config, {
  userProvider: new DwebUserProvider(useUserStore()),
  httpClient: new DwebHttpClient()
  // ...
})
```

## 开发指南

### 构建

```bash
pnpm build
```

### 开发模式

```bash
pnpm dev
```

### 类型检查

```bash
pnpm typecheck
```

## 贡献指南

修改核心逻辑时，确保：

1. 不引入环境特定依赖
2. 通过适配器接口访问外部功能
3. 保持类型安全
4. 添加必要的JSDoc注释
