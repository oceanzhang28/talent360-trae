# Talent 360

企业内部 360 测评平台（单公司使用，单项目被评人 ≤ 200 人）。

## 技术栈

- Next.js 16（App Router）+ TypeScript
- PostgreSQL 17 + Prisma 7（唯一正式数据源）
- Tailwind CSS 4 + shadcn/ui（radix-nova）
- Vitest（单元/集成测试）、Playwright（E2E）
- 飞书 OAuth 登录（开发期使用 `AUTH_MODE=mock`）

## 快速开始

```bash
npm install                          # 安装依赖
cp .env.example .env                 # 首次配置环境变量

npm run db:up                        # 启动 PostgreSQL（Docker）
npx prisma migrate dev               # 执行数据库迁移
npx prisma generate                  # 生成 Prisma Client（→ app/generated/prisma）
npm run dev                          # 启动开发服务器 → http://localhost:3001（3000 已被其他应用占用）
```

## 常用命令

| 命令                        | 说明                                                             |
| --------------------------- | ---------------------------------------------------------------- |
| `npm run dev`               | 启动开发服务器                                                   |
| `npm run lint`              | ESLint 检查                                                      |
| `npm run typecheck`         | TypeScript 类型检查                                              |
| `npm test`                  | 单元 + 集成测试（Vitest）                                        |
| `npm run e2e`               | E2E 测试（Playwright，首次需 `npx playwright install chromium`） |
| `npm run db:up` / `db:down` | 启停 PostgreSQL 容器                                             |
| `npm run db:migrate`        | 创建/应用迁移                                                    |
| `npm run db:studio`         | Prisma Studio 数据库管理界面                                     |
| `npm run format`            | Prettier 格式化                                                  |

## 飞书登录配置（真机联调 / 生产）

开发期用 `AUTH_MODE=mock` 即可，无需真实飞书应用。要用真实飞书身份登录，需先在飞书开放平台准备：

1. 创建**企业自建应用**，在「凭证与基础信息」取得 App ID / App Secret
2. 「安全设置 → 重定向 URL」加入回调地址，须与 `FEISHU_REDIRECT_URI` **完全一致**
   （本机联调 `http://localhost:3001/api/auth/feishu/callback`）
3. 「权限管理」申请并**发布版本**（企业内通常需管理员审批）后才生效，至少需要：
   - 用户授权 scope：`contact:user.base:readonly`（基础信息）、`contact:user.employee_id:readonly`（工号）
   - 字段权限：**获取用户受雇信息** —— `user_info` 返回 `employee_no` 的前置条件，
     缺失时登录会因「身份匹配失败」被拒（PRD 第 22 节，`employeeNo` 是唯一身份键）
4. `.env` 配置：`AUTH_MODE=feishu` + `FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_REDIRECT_URI`
   （可选 `FEISHU_SCOPES` 指定需用户授权的 scope，留空则不传 `scope` 参数）

端点口径（2026-09 按官方文档核对，见 `modules/feishu/auth.ts`）：

| 用途                   | 端点                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| 获取授权码             | `accounts.feishu.cn/open-apis/authen/v1/authorize`（`client_id` + `response_type=code`） |
| 换取 user_access_token | `accounts.feishu.cn/oauth/v3/token`                                                      |
| 获取用户信息           | `open.feishu.cn/open-apis/authen/v1/user_info`                                           |

> 生产环境（`NODE_ENV=production`）若误配 `AUTH_MODE=mock`，服务会**拒绝启动**
> （`instrumentation.ts` 启动断言：mock 登录等于任意工号可登录并自动建号）。

## 项目文档

- [docs/360测评平台产品需求文档 PRD.md](docs/360测评平台产品需求文档%20PRD.md) — 产品需求
- [docs/360测评平台技术开发与 Codex 实施文档.md](docs/360测评平台技术开发与%20Codex%20实施文档.md) — 技术设计与实施
- [docs/MVP-TASKS.md](docs/MVP-TASKS.md) — Sprint 0~9 开发任务清单（当前进度）
- [AGENTS.md](AGENTS.md) — AI 开发约束（十条铁律、DoD、范围禁令）

## 目录结构

```text
app/          # 页面与 API 路由（(auth) / admin / review / reports / api）
components/   # UI 组件（ui / questionnaire / matrix-review / charts / reports）
modules/      # 业务模块（auth / projects / questionnaires / people /
              #   review-relations / review-tasks / scoring / reports /
              #   excel / feishu / audit）
lib/          # 基础设施（db / validation / permissions / utilities）
prisma/       # schema 与 migrations（Client 生成至 app/generated/prisma）
tests/        # unit / integration / e2e
scripts/      # 运维与数据脚本
docker/       # Docker Compose 开发环境
docs/         # PRD、技术实施文档、任务清单
```

## 开发须知

- **AI 协作开发**：任何 AI 代理（Codex/Claude 等）须先阅读 `AGENTS.md` 并严格遵守
- **评分引擎**：位于 `modules/scoring`，测试先行，中间计算不舍入
- **身份认证**：`employeeNo` 为业务身份唯一键；开发期用 mock 登录，无需真实飞书应用
