# 简聊 Talksume

聊出好简历，投中好岗位。对话式简历生成与精准投递，分本地版（桌面端）和云端版（简聊 Cloud），两者共用同一个核心。

设计文档见 `docs/初赛设计文档.md`。

## 目录

| 路径              | 内容                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `packages/core`   | 领域模型与端口接口：投递状态机、`Notifier` / `JobQueue` / `BlobStore` / `PlatformConnector` |
| `packages/server` | 两个版本共用的 Fastify 应用工厂 `buildApp(deps)`，身份来源由 `IdentityProvider` 注入，默认是固定的本机用户 |
| `cloud/server`    | 云端版入口，注入云端适配器（闭源，开源发布时整个 `cloud/` 剔除）                            |
| `cloud/auth`      | 云端用户系统：注册登录、会话、邮件、HR 邀请，自带数据表和迁移（闭源）                       |
| `cloud/web`       | 云端 Web 入口：复用 `apps/web`，注册登录门和账号相关页面（闭源）                            |
| `apps/web`        | Web 端（Vite + React），桌面端复用同一套渲染层                                              |
| `deploy`          | Docker Compose 部署：PostgreSQL（pgvector）、Redis、server、web                             |
| `docs`            | 设计文档与图                                                                                |

## 开发

需要 Node ≥ 22.19（推荐 24）和 pnpm 12。服务端直接用 Node 原生的类型擦除运行 `.ts`，不需要构建，所以源码只能使用可擦除的 TypeScript 语法（`erasableSyntaxOnly`）。

```bash
pnpm install
pnpm dev:server   # http://localhost:8080
pnpm dev:web      # http://localhost:5173，/api 代理到 8080
```

云端开发用 `pnpm dev:cloud-web`（5173，同样代理到 8080）。云端版必须注册登录；`NODE_ENV` 不是 production 且开了邮件但没配 SMTP 时（非 production），验证、重置邮件的内容会打到 server 日志，从日志里取链接。管理员用 `ADMIN_EMAILS=you@example.com` 引导。

开源侧（`packages/*`、`apps/*`）不能引用 `cloud/`：`pnpm check:boundary` 检查引用，`pnpm verify:open-build` 把 `cloud/` 剔除后重新安装、类型检查并跑开源部分的测试。测试默认带 `TALKSUME_DEV_AUTH=1`（见 `vitest.config.ts`），用 `x-talksume-user` 头和演示用户；生产环境禁止这个身份。

提交前跑一遍：

```bash
pnpm lint && pnpm typecheck && pnpm test
```

## 部署

```bash
cp deploy/.env.example deploy/.env   # 修改 POSTGRES_PASSWORD、ADMIN_EMAILS；要用邮件验证再配 APP_URL 和 SMTP_*
docker compose -f deploy/docker-compose.yml up -d --build
```

启动后访问 `http://<host>:8000`。必须注册登录才能使用；`ADMIN_EMAILS` 里的邮箱注册并验证后成为管理员，在「HR 邀请」页生成链接开通 HR 账号。

邮件功能由 `AUTH_EMAIL_ENABLED` 控制，默认 `false`：
- 关（默认）：不需要 SMTP 和 `APP_URL`。注册即视为已验证并直接登录，重复邮箱会明确提示「已注册」；忘记密码、重发验证邮件不可用，用户联系管理员，管理员在「HR 邀请」页的「重置用户密码」生成临时密码（会作废该用户全部会话并记审计），没有管理员可登录时在服务器上跑 `pnpm --filter @talksume/cloud-auth reset-password --email <邮箱>`。
- 开：注册要邮件验证，支持邮件找回密码；生产环境必须配 `APP_URL` 和 `SMTP_*`，缺了启动报错。

关邮件且没配 `APP_URL` 时，写请求的 `Origin` 只放行主机名与请求 `Host` 一致的来源；建议仍然配上 `APP_URL`。
