# Talent 360 — MVP 开发任务清单

> **使用规则**：严格按 Sprint 顺序执行，一次只做一个 Sprint。每个任务完成后勾选 `[x]`，且必须满足 `AGENTS.md` 的 Definition of Done 才能进入下一个任务。禁止跳到后面 Sprint 提前做高级功能。
>
> **当前进度**：Sprint 3（问卷）——Sprint 0、Sprint 1、Sprint 2 已完成 ✅

---

## Sprint 0：项目骨架 ✅（2026-09-16 完成）

- [x] Next.js 16 (App Router) + TypeScript + Tailwind + ESLint 初始化
- [x] 文档迁移至 `docs/`（PRD + 技术实施文档）
- [x] 创建 `AGENTS.md`（十条铁律 + DoD + 范围禁令）
- [x] 创建本任务清单 `docs/MVP-TASKS.md`
- [x] Prisma 7 初始化 + `User` 模型 + 首个 migration（`prisma7.config.ts` + adapter-pg）
- [x] PostgreSQL Docker 开发环境（`docker/docker-compose.yml`，postgres:17.9-alpine）
- [x] shadcn/ui 初始化（radix-nova 风格，neutral 基色，含 button 组件）
- [x] Vitest + 单元/集成示例测试（含 DB 连接冒烟）
- [x] Playwright 配置（chromium + mobile 视口，E2E 冒烟通过）
- [x] Prettier + prettier-plugin-tailwindcss（已全量格式化）
- [x] 目录骨架：`modules/` `lib/` `tests/` `scripts/` `docker/` `app/(auth)|admin|review|reports|api`
- [x] `.env.example`（DATABASE_URL、AUTH_MODE、飞书变量预留）
- [x] package.json 脚本：typecheck / test / e2e / db:up / db:down / db:migrate / db:studio / format

**验收结果**：✅ `npm run db:up && npm run dev`（端口 3001）可启动返回 200；`npm run lint`、`npm run typecheck`、`npm test`（4/4）、`npm run e2e`（2/2）全部通过。

> 备注：开发端口固定 3001（3000 被本机其他应用占用）；Prisma 7 的 `migrate dev` 不自动生成 Client，clone 后需执行 `npx prisma generate`（见 README）。

---

## Sprint 1：认证与权限 ✅（2026-09-16 完成）

- [x] `modules/auth`：session 管理（JWT HS256，HttpOnly + Secure + SameSite=Lax Cookie，7 天）
- [x] `AUTH_MODE=mock` 登录页：输入 employeeNo + 姓名模拟飞书身份，自动 upsert User
- [x] `modules/feishu/auth`：`FeishuAuthService` 抽象（getAuthorizationUrl / exchangeCode / getCurrentUser），`AUTH_MODE=feishu` 走真实 OAuth（扫码 + 移动端授权）
- [x] OAuth callback 校验 state（一次性 Cookie，CSRF 防护）
- [x] 服务端身份校验链：OAuth 成功 → employeeNo 必须存在 → openId/工号绑定或冲突拒绝（409）→ 建立会话
- [x] 权限中间件：`requireLogin` / `requireSystemAdmin` + `withApi` 统一错误包装（`lib/permissions`）
  - `requireProjectAdmin(projectId)` → 顺延至 Sprint 2（依赖 ProjectAdmin 模型）
  - `requireReviewerTask(taskId)` → 顺延至 Sprint 5（依赖 ReviewTask 访问控制）
- [x] `GET /api/me`、`POST /api/auth/logout`、`POST /api/auth/mock/login`
- [x] 系统管理员页 `/admin/users`：用户列表、设置/取消 SYSTEM_ADMIN（禁止自我降级）
- [x] seed 脚本：初始系统管理员（employeeNo `00000`，`npm run db:seed` 幂等）

**验收结果**：✅ E2E 覆盖：未登录 `/api/me` → 401；mock 登录后返回当前用户；普通用户访问 `/api/admin/users` → 403；管理员可获取列表并访问管理页；登出后 → 401。单元测试 18/18（session 签发/篡改/跨密钥、权限守卫、withApi 错误映射）、E2E 12/12 全部通过。

---

## Sprint 2：项目管理 ✅（2026-09-16 完成）

- [x] `Project` / `ProjectAdmin` / `ProjectScale` 模型 + migration（`20260916035126_add_projects`）
- [x] 项目 CRUD：`GET/POST /api/projects`、`GET/PATCH/DELETE /api/projects/:id`
- [x] 项目状态机：DRAFT → PUBLISHED → ACTIVE → CLOSED → FROZEN → ARCHIVED（+ DELETED 软删除）
  - PUBLISHED→ACTIVE / ACTIVE→CLOSED 由时间触发的惰性转换完成（读取时 `syncStatus` 同步）
- [x] 生命周期操作：`publish`（校验时间必填且 start<end、权重合计 100%；问卷/关系校验留 Sprint 3/4 TODO）、`close`（提前结束）、`freeze`、`unfreeze`（仅系统管理员）、`archive`、`DELETE`（软删除，仅系统管理员）
- [x] 时间操作：提前结束（ACTIVE→CLOSED，endAt=now）、延长截止（ACTIVE 下仅 endAt 且必须晚于原值）、重新开放（CLOSED 下设未来 endAt→ACTIVE）
- [x] HR 项目管理员配置（一个项目多管理员，按工号添加，不能移除最后一个）
- [x] 评分档位配置：固定 value 0.5~5.0（创建时播种 PRD 第 10 节默认 label），HR 只能改 label
- [x] 关系权重配置：上级/平级/下级，合计必须 100%（以 1% 为单位取整求和，避免浮点误差）
- [x] `requireProjectAdmin(projectId)` 权限中间件（自 Sprint 1 顺延；系统管理员天然通过）
- [x] HR 项目列表页 + 项目详情/设置页（生命周期/基本信息/档位/管理员四卡片）+ 新建页 + 首页项目管理入口
- [x] 项目软删除：deletedAt + purgeAfter=+30 天（本阶段只做标记，回收站 UI 属于 V2）

**验收结果**：✅ 集成测试 10/10 覆盖：HR 只能看到自己管理的项目（系统管理员看全部）；状态流转符合 PRD 6.2（发布校验/惰性时间同步/提前结束/冻结/仅系统管理员解冻/归档）；权重≠100% 无法发布（400）；非项目管理员 403；软删除后不可见但数据保留。单元 16/16（权重取整求和/状态标签），E2E 20/20（新建→配置档位→发布→列表可见；权重错误发布被拒；非管理员 API 403 + 页面重定向），lint/typecheck 通过。

**遗留 TODO**：freeze 时生成评分快照（Sprint 8）；publish 校验被评人已配置（Sprint 4）。~~publish 校验问卷已配置~~（Sprint 3 已完成）。

---

## Sprint 3：问卷（数据结构 + Excel 导入）✅（2026-09-16 完成）

- [x] `Questionnaire` / `Dimension` / `Question` 模型 + migration（`20260916045707_add_questionnaire`）
- [x] 维度树：最大两级；校验"同一一级维度不能同时直接挂题目和二级维度"
- [x] 题型：RATING（固定 10 档，必答）/ TEXT（可配置必填/选填，weight=null）
- [x] 关系适用规则：维度级 4 个布尔（自评/上级/平级/下级）+ 题目级 override
- [x] 问卷 Excel 模板生成（API 下载，含示例数据 + 填写说明）：16 个标准字段（PRD 12.2）
- [x] 问卷 Excel 导入：解析 → 校验 → 错误报告（行级 + 结构级明细）→ 事务整体替换写入
- [x] 权重校验：一级维度合计=100%；同维度下二级维度合计=100%；同维度下题目合计=100%（百分之一取整求和）
- [x] 完整性校验接口：`POST /api/projects/:id/questionnaire/validate`（只校验不写入）
- [x] 问卷锁定逻辑：lockedAt 非空禁止修改（首次正式提交在 Sprint 5 设置；修改窗口限 DRAFT/PUBLISHED，含惰性状态同步）
- [x] 问卷只读预览页（HR 端，`/projects/:id/questionnaire` 按自评/上级/平级/下级四视角过滤）
- [x] 问卷模板：isTemplate 标记 + 保存为模板 / 从模板复制（深拷贝维度与题目，同名模板 409）
- [x] `publishProject` 补问卷校验：至少一个维度和一道题目，否则 400

**验收结果**：✅ 官方模板 Excel（PRD 12.2 的 16 字段）导入生成问卷树（维度/权重/题型/关系适用/题目说明全部正确）；权重非法（一级 60+50）导入被拦截并返回行级/结构级错误明细，不写入；无问卷发布被拦截（400）；锁定后与测评开始（ACTIVE）后导入均 409；模板保存→列表→应用内容一致。单元 20/20（校验纯函数 + Excel 往返）、集成 9/9、E2E 24/24（下载模板→UI 导入→发布→预览按关系过滤；未导入问卷发布被拦截），lint/typecheck/format 通过。Sprint 2 用例已适配发布新校验（发布前先导入问卷）。

**遗留 TODO**：lockedAt 在首次评价提交时设置（Sprint 5）；维度级适用关系的 Excel 表达目前固定全适用（PRD 11.1 维度级配置的编辑能力后续补充）。

---

## Sprint 4：人员与评价关系 ✅（2026-09-16 完成）

- [x] `ProjectPerson` / `ReviewRelation` / `ReviewTask` 模型 + migration（`20260916053527_add_people_relations_tasks_audit`）
- [x] 人员快照：unique(projectId, employeeNo)，每项目独立
- [x] 关系 Excel 模板生成（PRD 第 16.1 节 8 字段）
- [x] 导入 Preview：解析 → 标准化 → 校验，返回 total/valid/errors/duplicates/conflicts，不写正式表
- [x] 错误检测：工号/姓名为空、工号姓名冲突、重复关系、同评价人对同一被评人双关系、非法关系类型
- [x] 导入 Commit：数据库事务，失败整批回滚；整体替换非 SELF 关系（按 pairKey 对齐，已提交软删/未提交物理删）
- [x] 自评自动生成：项目启用 selfReviewEnabled 时系统自动创建 SELF 关系 + 任务；关闭时移除；HR 删除过的自评不自动恢复
- [x] 关系手工调整 API：新增 / 修改 / 删除（已有提交仍可调整；删除已完成关系则该评价不参与结果）
- [x] HR 人员与关系管理页（TanStack Table v8：人员列表、关系列表、导入向导、手工增删改）
- [x] `AuditLog` 模型 + 删除/修改关系写审计

**验收**：PRD 第 18 节预检查场景全部覆盖（集成测试断言全部 5 类问题）；860 行量级 Excel 导入（200 被评人规模）Preview < 1s、Commit < 1s（限值 5s/15s）。
**测试**：单元 26（relations 校验 13 + 模板往返等）、集成 13（两阶段/替换/自评/调整/审计/权限/状态窗口/性能）、E2E 4（预检查拦截 + 完整导入流程 × chromium/mobile）。

---

## Sprint 5：评价端（单人模式）

- [ ] `GET /api/my/tasks`：按关系分组（自评/上级/平级/下级）+ 状态计数
- [ ] 员工首页「我的待评价」：待评价/进行中/已完成人数
- [ ] `GET /api/tasks/:id`：按被评人返回问卷结构（过滤该关系不适用的维度/题目）
- [ ] 草稿读写：`GET/PUT /api/tasks/:id/draft`（DraftAnswer，unique(taskId, questionId)）
- [ ] 前端自动保存：debounce 1~2s，只提交变化字段；刷新/换设备/切模式不丢数据
- [ ] 量表题组件：10 档单选（显示项目自定义 label），必答不可空
- [ ] 开放题组件：必填/选填校验
- [ ] 按人提交：`POST /api/tasks/:id/submit` → 生成 Submission v1 + SubmissionAnswer 快照；必答项不全则拒绝
- [ ] 提交后只读查看
- [ ] HR 退回：`POST /api/tasks/:id/return` → 任务 RETURNED + 写 AuditLog；评价人可重新编辑再提交（生成新版本，历史版本保留）
- [ ] 任务状态机：NOT_STARTED / IN_PROGRESS / SUBMITTED / RETURNED
- [ ] 手机端纵向问卷布局（手机优先）

**验收**：单人全流程（草稿→退出→恢复→提交→HR退回→重交）在 PC + 手机浏览器均可完成；HR 任何接口拿不到草稿内容。

---

## Sprint 6：矩阵评价模式

- [ ] `/review/matrix?relation=XXX&dimension=xxx`：按关系 → 按维度分页
- [ ] 矩阵表：行=被评人，列=该维度题目，TanStack Table（PC 横向表格）
- [ ] 每单元格复用同一 DraftAnswer（taskId + questionId），与单人模式数据实时互通
- [ ] 开放题：每个被评人独立文本框
- [ ] 批量提交：`POST /api/tasks/batch-submit`，一次提交所有已填写完整的人员
- [ ] 单人/矩阵模式一键切换，草稿不丢
- [ ] 移动端矩阵：固定姓名列 + 横向滑动，或"当前维度→当前题目→人员卡片"（禁止整表缩放）

**验收**：矩阵填一半 → 切单人模式数据完整；反向同样；移动端可实际操作（Playwright 移动视口 + 真机抽查）。

---

## Sprint 7：评分引擎（系统核心）

- [ ] `modules/scoring` 独立模块，纯函数 + Decimal 运算，中间不舍入
- [ ] **先写测试**，覆盖技术文档第 59 节全部场景：
  - [ ] 正常三关系（上级+平级+下级）
  - [ ] 缺少下级关系 → 权重自动归一化
  - [ ] 配置了下级但 0 提交 → 视为无效关系归一化
  - [ ] 关系只适用部分题目 → 题目权重归一化（40:30 案例等）
  - [ ] 关系完全不评某维度 → 维度权重归一化
  - [ ] 两层问卷 / 三层问卷
  - [ ] 自评不入总分
  - [ ] 多评价人题目平均（3.5/4.0/4.5 → 4.00）
  - [ ] 关系权重 40/30/30 加权总分
  - [ ] 退回重评后使用当前有效版本
- [ ] 计算：题目平均 → 题目权重归一化 → 二级维度 → 一级维度 → 关系得分 → 360 总分
- [ ] 完成率计算：总/上级/平级/下级/自评
- [ ] 展示层格式化（2 位小数）独立工具函数，不影响引擎精度

**验收**：scoring 模块测试覆盖率 ≥ 90% 全部通过；PRD 第 31/32 节示例数值逐条对得上。

---

## Sprint 8：进度看板与结果冻结

- [ ] `GET /api/projects/:id/progress`：项目总体（应完成/已完成/完成率）
- [ ] 按评价人进度：应评 X 人 / 已完成 / 剩余（供 HR 线下催办）
- [ ] 按被评人进度：自评/上级/平级/下级分关系完成表
- [ ] 进度看板页（HR，TanStack Table + 汇总卡片）
- [ ] 冻结流程：校验 → 执行评分引擎 → 生成 ResultSnapshot + ResultDimension + ResultQuestion → status=FROZEN → AuditLog（事务）
- [ ] 允许未 100% 完成冻结，但展示完整性警告（各关系完成率 + 自评状态）
- [ ] 结果完整性提示：应评/实评/总完成率/分关系完成率
- [ ] HR 结果后台：被评人列表 + 总分/自评/上级/平级/下级得分 + 完成率
- [ ] 结果下钻：一级维度 → 二级维度 → 题目得分
- [ ] HR 查看每位评价人实名评价明细（仅 HR 端，正式报告不显示姓名）
- [ ] 解冻：仅系统管理员（`POST /api/projects/:id/unfreeze` + AuditLog）

**验收**：冻结后报告数据只读自 ResultSnapshot；后续修改业务表不影响已冻结结果；解冻权限控制正确。

---

## Sprint 9：Excel 完整导出（MVP 收尾）

- [ ] ExcelJS 生成 `360_results.xlsx`，6 个 Sheet：
  - [ ] Sheet1 被评人汇总（工号/姓名/部门/岗位/职级/360总分/自评/上级/平级/下级/完成率）
  - [ ] Sheet2 评价明细（被评人/评价人/关系/一级维度/二级维度/题目/得分/开放题原文）
  - [ ] Sheet3 题目级汇总
  - [ ] Sheet4 维度级汇总
  - [ ] Sheet5 评价任务完成情况
  - [ ] Sheet6 评价关系表
- [ ] 稳定字段名（便于 Power Query / 透视表）；数值 2 位小数
- [ ] `POST /api/projects/:id/export/excel` + HR 端导出按钮 + AuditLog
- [ ] 全链路冒烟：集成测试覆盖"创建→问卷→关系→提交→冻结→导出"

**验收（MVP 整体验收，PRD 第 47 节 + 技术文档第 77 节）**：

> 不依赖人工计算与人工改库，完整跑通一次真实 360：
> Excel 导入问卷 → Excel 导入关系 → 飞书(或mock)登录 → 单人评价 → 矩阵评价 → 草稿恢复 → 按人/批量提交 → HR 退回重评 → 截止 → 冻结 → 自动计算 → Excel 导出。
> 建议真实小范围测试：5 名被评人 × 20 名评价人 × 30 量表题 + 3 开放题。

**MVP 完成后暂停开发，先跑真实测试；V1（拖拽编辑器、模板库、测试模式、图表、网页/PDF 报告、飞书多维表格同步等）待真实流程跑通后再立项。**
