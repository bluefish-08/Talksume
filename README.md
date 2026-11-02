# 简聊 Talksume

聊出好简历，投中好岗位。对话式简历生成与精准投递，分本地版（桌面端）和云端版（简聊 Cloud），两者共用同一个核心。

设计文档见 `docs/初赛设计文档.md`。

## 目录

| 路径              | 内容                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `packages/core`   | 领域模型与端口接口：投递状态机、`Notifier` / `JobQueue` / `BlobStore` / `PlatformConnector` |
| `packages/server` | 两个版本共用的 Fastify 应用工厂 `buildApp(deps)`                                            |
| `cloud/server`    | 云端版入口，注入云端适配器                                                                  |
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

提交前跑一遍：

```bash
pnpm lint && pnpm typecheck && pnpm test
```

## 部署

```bash
cp deploy/.env.example deploy/.env   # 修改 POSTGRES_PASSWORD
docker compose -f deploy/docker-compose.yml up -d --build
```

启动后访问 `http://<host>:8000`。
