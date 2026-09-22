# 本地前端配置

| 应用 | 配置目录 | 开发命令（在仓库根执行） |
| --- | --- | --- |
| Web | `local_web` | `pnpm web -- dev` |
| Extension | `local_extension` | `pnpm extension -- dev` |

在仓库根复制对应示例，再填写生成的文件：

```sh
cp deploy/local_web/.env.example deploy/local_web/.env
cp deploy/local_extension/.env.example deploy/local_extension/.env
pnpm preflight
```

每个应用先读取自己的 `.env`，再读取 `.env.dev`；后者可省略，用于覆盖开发环境配置。终端中已经设置的变量优先级最高。根目录 `.env` 不会自动加载。

环境名称取终端或基础 `.env` 中的 `SLAX_ENV`，默认 `development`；preview、beta、production 对应 `.env.preview`、`.env.beta`、`.env.production`。profile 文件本身不能切换环境。所有 `pnpm web -- ...` 和 `pnpm extension -- ...` 命令都遵循此规则，包括构建与类型检查。

只提交公开的 `.env.example`。真实环境文件已被 Git 忽略，前端配置可能进入浏览器产物，不要放入服务端密钥。环境文件统一由上述 deploy 目录或进程环境提供；preflight 只检查 deploy 和进程配置。

详细说明：[Web 配置](../docs/apps/web/development.md) · [Extension 配置](../docs/apps/extension/development.md)。
