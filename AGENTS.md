<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Talent 360 开发约束（AGENTS.md）

## 项目概述

- 单公司内部 360 测评平台（Talent 360），规模：单项目被评人 ≤ 200 人
- 技术栈：Next.js (App Router) + TypeScript + Prisma + PostgreSQL + Tailwind CSS + shadcn/ui
- 需求与设计的唯一事实来源：`docs/360测评平台产品需求文档 PRD.md` 与 `docs/360测评平台技术开发与 Codex 实施文档.md`
- 开发任务清单：`docs/MVP-TASKS.md`（严格按 Sprint 顺序推进）

## 十条铁律（任何改动不可违反）

1. 改评分公式必须先改/更新测试，再改实现（Do not change scoring formulas without updating tests）
2. PostgreSQL 是唯一正式数据源（Source of Truth），禁止以飞书多维表格作为主数据库
3. HR 用户永远不能修改已提交的评价答案（不存在 `PATCH /api/tasks/:id/answers` 类接口）
4. DraftAnswer 草稿永远不能通过任何 HR API 暴露（HR 只能看到 未开始/进行中/已提交 状态）
5. `employeeNo` 是业务身份唯一键，禁止使用姓名做身份匹配
6. ProjectPerson 是项目时点快照，修改一个项目的人员信息不得影响其他项目历史记录
7. 自评（SELF）永远不参与 360 总分，仅用于自评 vs 他评差异分析
8. 评分中间计算永不舍入；后台保留完整精度，仅展示层（页面/Excel/PDF）显示 2 位小数
9. 所有项目数据访问必须在服务端校验项目权限（`requireLogin / requireSystemAdmin / requireProjectAdmin / requireReviewerTask`），禁止用前端 `if (role)` 代替服务端鉴权
10. 禁止在日志中打印飞书 token、App Secret、access token、完整评价内容

## 开发流程纪律

- 一次只做一个 Sprint；每个任务须满足下方 Definition of Done 才能勾选并进入下一个
- 评分逻辑必须集中在 `modules/scoring`，禁止散落在页面组件或 API 路由内
- 评分引擎：测试先行（先写单元测试，再写实现）；核心场景覆盖率 ≥ 90%
- 业务模块不得直接调用飞书 HTTP 接口，统一通过 `modules/feishu/auth` 的 `FeishuAuthService` 抽象
- 开发与测试阶段使用 `AUTH_MODE=mock`（模拟选择 employeeNo 登录），不依赖真实飞书 App；`AUTH_MODE=feishu` 为生产行为
- Excel 关系导入严格执行 Preview / Commit 两阶段，Commit 必须在数据库事务内，失败整批回滚
- 写 Next.js 代码前先查阅 `node_modules/next/dist/docs/` 中对应指南（本项目使用 Next.js 16，API 与旧版存在差异）

## Definition of Done（每个任务完成标准）

- [ ] 功能实现符合 PRD 对应章节
- [ ] TypeScript 编译无错误：`npm run typecheck`
- [ ] ESLint 通过：`npm run lint`
- [ ] 单元测试通过：`npm test`
- [ ] 涉及数据模型时已生成 Prisma migration
- [ ] API 已做服务端权限校验
- [ ] 相关文档（README / 模块说明 / MVP-TASKS.md 勾选）已更新
- [ ] 未破坏已有测试

## 范围禁令（MVP/V1 期间禁止开发，防止范围蔓延）

AI 评价摘要、九宫格、继任管理、IDP、绩效盘点、潜力评价、强制排名、百分位/部门排名、通讯录全量同步、自动飞书催办、多租户、复杂组织树、微服务、Kubernetes、Kafka、Elasticsearch、分布式数据库。

第一目标只有一个：**稳定完成一次真实 360 测评**。

## 常用命令

```bash
docker compose -f docker/docker-compose.yml up -d   # 启动 PostgreSQL
npm run dev                                          # 启动开发服务器
npm run typecheck                                    # 类型检查
npm run lint                                         # 代码检查
npm test                                             # 单元测试
npx prisma migrate dev                               # 执行数据库迁移
npx prisma studio                                    # 数据库可视化管理
```

## 目录约定

```text
app/          # 页面与 API 路由（(auth) / admin / review / reports / api）
components/   # UI 组件（ui / questionnaire / matrix-review / charts / reports）
modules/      # 业务模块（auth / projects / questionnaires / people /
              #   review-relations / review-tasks / scoring / reports /
              #   excel / feishu / audit）
lib/          # 基础设施（db / validation / permissions / utilities）
prisma/       # schema 与 migrations
tests/        # unit / integration / e2e
scripts/      # 运维与数据脚本
docker/       # Docker Compose 开发环境
docs/         # PRD、技术实施文档、任务清单
```
