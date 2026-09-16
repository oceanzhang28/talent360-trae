# Talent 360 — MVP 开发任务清单

> **使用规则**：严格按 Sprint 顺序执行，一次只做一个 Sprint。每个任务完成后勾选 `[x]`，且必须满足 `AGENTS.md` 的 Definition of Done 才能进入下一个任务。禁止跳到后面 Sprint 提前做高级功能。
>
> **当前进度**：MVP 全部完成（Sprint 0 ~ 9 ✅，2026-09-16）——下一步：小范围真实测试；V1 功能待真实流程跑通后再立项

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

## Sprint 5：评价端（单人模式）✅（2026-09-16 完成）

- [x] `DraftAnswer`（unique(taskId, questionId)）/ `Submission`（版本快照）/ `SubmissionAnswer` 模型 + migration（`20260916060345_add_draft_submission`）
- [x] `requireReviewerTask(taskId)` 权限中间件（Sprint 1 顺延；按 employeeNo 匹配项目人员快照，系统管理员/HR 不放行——铁律 4）
- [x] `GET /api/my/tasks`：按关系分组（自评/上级/平级/下级）+ 状态计数
- [x] 员工首页「我的待评价」：待评价/进行中/已退回/已完成人数
- [x] `GET /api/tasks/:id`：按被评人返回问卷结构（维度级 applicable + 题目级 override 过滤）
- [x] 草稿读写：`GET/PUT /api/tasks/:id/draft`（DraftAnswer，增量保存，首次写入任务进入 IN_PROGRESS）
- [x] 前端自动保存：debounce 1.5s，只提交变化字段；刷新/换设备/切模式不丢数据
- [x] 量表题组件：10 档单选（显示项目自定义 label），必答不可空（服务端校验 + 前端缺失标红）
- [x] 开放题组件：必填/选填校验（≤2000 字）
- [x] 按人提交：`POST /api/tasks/:id/submit` → 生成 Submission 版本快照 + SubmissionAnswer；必答项不全拒绝（返回缺失明细）；**首次正式提交设置问卷 lockedAt（Sprint 3 遗留 TODO）**；旧版本 invalidatedAt 标记
- [x] 提交后只读查看（SUBMITTED / 非 ACTIVE 项目禁用输入）
- [x] HR 退回：`POST /api/tasks/:id/return` → 任务 RETURNED + 当前 Submission 失效 + AuditLog；评价人重新编辑再提交生成新版本（历史版本保留）
- [x] 任务状态机：NOT_STARTED / IN_PROGRESS / SUBMITTED / RETURNED（RETURNED 编辑期间保持状态，重交后才变 SUBMITTED）
- [x] 手机端纵向问卷布局（手机优先：量表两行五列网格、吸底提交栏、纵向题目流）

**验收结果**：✅ 单人全流程（草稿→退出→恢复→提交→HR退回→重交 v2）在 PC + 手机视口均可完成（E2E chromium + mobile 各跑一遍）；铁律 4 验证：HR/系统管理员/非本人评价人访问草稿与任务详情接口一律 403（集成测试 + E2E 双覆盖）；必答缺失提交被拦截并返回缺失明细；项目 CLOSED 后草稿/提交均拒绝（只读）。单元 12（关系过滤/草稿校验/必答校验纯函数）、集成 13（全流程/版本快照/lockedAt/退回审计/状态窗口/权限）、E2E 4（全流程 × chromium/mobile + 必答拦截），全套 114 单元/集成 + 32 E2E 通过，lint/typecheck/format 通过。

---

## Sprint 6：矩阵评价模式 ✅（2026-09-16 完成）

- [x] `GET /api/my/matrix?relation=XXX`：矩阵数据（该关系跨项目的任务 + 按关系过滤的问卷结构 + 量表 + 草稿回填；relation 缺省自动选第一个有任务的关系）
- [x] `/review/matrix?relation=XXX&dimension=xxx`：关系 tab → 维度分页（replaceState 同步 URL，本地切换不触发重新请求、不丢编辑中数据）
- [x] 矩阵表（PC）：TanStack Table，行=被评人，列=当前维度题目（直挂题 + 二级维度题，`flattenDimensionQuestions`）；容器横向滚动，禁止整表缩放
- [x] 每单元格复用同一 DraftAnswer（taskId + questionId），与单人模式数据实时互通（草稿读写走同一 `PUT /api/tasks/:id/draft`）
- [x] 开放题：每个被评人独立文本框（矩阵单元格 Textarea / 移动卡片 TextQuestion）
- [x] 批量提交：`POST /api/tasks/batch-submit`，一次提交所有已填写完整的人员（必答不全 / 已提交 / 窗口不允许的跳过并返回原因明细；混入他人任务整批 403）
- [x] 单人/矩阵一键切换，草稿不丢（切换前先 flush 落库；提取 `useDraftAutosave` 共享 hook，支持多任务分组并行保存）
- [x] 移动端矩阵：「当前维度 → 当前题目 → 人员卡片」卡片流（复用大按钮量表组件，吸底批量提交栏）
- [x] 任务列表页每个关系分组新增「矩阵模式」入口；单人评价页新增「切换矩阵模式」按钮

**验收结果**：✅ 矩阵填一半 → 切单人模式数据完整（E2E：矩阵 Q1=4.5 → 单人页 aria-pressed=true）；反向同样（单人 → 切回矩阵数据保留）；批量提交成功 2 份、必答缺失跳过并返回缺失明细（Q1~Q4）；移动端卡片流（维度 → 题目 select → 人员卡片打分）实际可操作并完成批量提交。铁律 4：批量提交混入他人任务整批 403（集成测试）；HR 无任何草稿数据路径。单元 4（维度列组装）、集成 8（矩阵数据/草稿互通/批量提交全场景/权限/参数校验/窗口）、E2E 4（PC 矩阵互通+批量提交、mobile 卡片流，各 × 工程互斥跳过），全套 126 单元/集成 + 34 E2E 通过，lint/typecheck/format 通过。

---

## Sprint 7：评分引擎（系统核心）✅（2026-09-16 完成）

- [x] `modules/scoring` 独立模块（engine / completion / format / types），纯函数 + decimal.js Decimal 运算，中间不舍入，不依赖 Prisma 生成客户端
- [x] **先写测试**，覆盖技术文档第 59 节全部场景：
  - [x] 正常三关系（上级+平级+下级）
  - [x] 缺少下级关系 → 权重自动归一化
  - [x] 配置了下级但 0 提交 → 视为无效关系归一化
  - [x] 关系只适用部分题目 → 题目权重归一化（40:30 案例等）
  - [x] 关系完全不评某维度 → 维度权重归一化
  - [x] 两层问卷 / 三层问卷
  - [x] 自评不入总分
  - [x] 多评价人题目平均（3.5/4.0/4.5 → 4.00）
  - [x] 关系权重 40/30/30 加权总分
  - [x] 退回重评后使用当前有效版本（invalidatedAt=null 筛选语义 + 引擎测试）
- [x] 计算：题目平均 → 题目权重归一化 → 二级维度 → 一级维度 → 关系得分 → 360 总分；归一化总原则：各级权重在「实际参与计分的有效集合」内归一化；结构防御 fail fast（混合挂载/超两级/悬空引用抛 ScoringStructureError）
- [x] 完成率计算：总/上级/平级/下级/自评（仅 SUBMITTED 计完成，Decimal 全精度）
- [x] 展示层格式化（2 位小数）独立工具函数 formatScore / formatRate，不影响引擎精度

**验收结果**：✅ scoring 覆盖率：行覆盖 100%、分支覆盖 98.27%（v8 provider，`npm run test:coverage`），远超 90% 要求；PRD 第 31 节示例逐条对上（题目平均 4.00 / 关系加权 / 40:30:30 总分 4.00）、PRD 第 32 节 40:30 归一化、PRD 第 34 节缺下级/0 提交归一化（26.8/7 全精度断言）。全套 168 单元/集成（新增 42 个 scoring 测试）+ E2E 34 通过，lint/typecheck/format 通过。附带修复：集成测试共享工号并行 upsert 竞态（vitest fileParallelism=false）。

---

## Sprint 8：进度看板与结果冻结 ✅（2026-09-16 完成）

- [x] `GET /api/projects/:id/progress`：项目总体（应完成/已完成/完成率）
- [x] 按评价人进度：应评 X 人 / 已完成 / 剩余（供 HR 线下催办）
- [x] 按被评人进度：自评/上级/平级/下级分关系完成表
- [x] 进度看板页（HR，TanStack Table + 汇总卡片）
- [x] 冻结流程：校验 → 执行评分引擎 → 生成 ResultSnapshot + ResultDimension + ResultQuestion → status=FROZEN → AuditLog（事务）
- [x] 允许未 100% 完成冻结，但展示完整性警告（各关系完成率 + 自评状态）
- [x] 结果完整性提示：应评/实评/总完成率/分关系完成率
- [x] HR 结果后台：被评人列表 + 总分/自评/上级/平级/下级得分 + 完成率
- [x] 结果下钻：一级维度 → 二级维度 → 题目得分
- [x] HR 查看每位评价人实名评价明细（仅 HR 端，正式报告不显示姓名）
- [x] 解冻：仅系统管理员（`POST /api/projects/:id/unfreeze` + AuditLog）

**验收**：冻结后报告数据只读自 ResultSnapshot；后续修改业务表不影响已冻结结果；解冻权限控制正确。

**验收结果**：✅ 不可变性实证：冻结后直改 SubmissionAnswer 业务数据，结果列表/下钻输出不变（集成测试）；解冻删除全部快照 + 重新冻结整体重算（managerScore 4.0 → 3.1、总分 310/70 → 274/70）；HR 解冻 403 / 系统管理员成功（集成 + E2E）。未 100% 完成冻结：3/6 提交仍可冻结，AuditLog 标记 incomplete=true，进度页琥珀色完整性警告（应评/实评/总完成率/分关系/未自评名单），冻结 confirm 弹窗含完成率明细（E2E 断言）。得分存储 Decimal(8,6)、展示 2 位（张三 4.43 = (4×40+5×30)/70，权重 40:30 归一化）。单元 4（快照映射）+ 集成 14（进度/权限/冻结/快照/下钻/实名明细/不可变/解冻/重算）+ E2E 2（chromium+mobile 双工程），全套 187 单元/集成 + 36 E2E 通过，lint/typecheck/format 通过。

---

## Sprint 9：Excel 完整导出（MVP 收尾）✅（2026-09-16 完成）

- [x] ExcelJS 生成 `360_results.xlsx`，6 个 Sheet（`modules/results/excel.ts`，批量取数无 N+1）：
  - [x] Sheet1 被评人汇总（工号/姓名/部门/岗位/职级/360总分/自评/上级/平级/下级/应评数/已提交数/完成率）
  - [x] Sheet2 评价明细（被评人/评价人/关系/一级维度/二级维度/题目编码/题目/题型/得分/开放题原文；每行 = 有效提交的一道答案）
  - [x] Sheet3 题目级汇总（快照 RATING 题平均分 × 关系）
  - [x] Sheet4 维度级汇总（快照一级/二级维度得分 × 关系，树序）
  - [x] Sheet5 评价任务完成情况（任务状态中文 + 提交时间）
  - [x] Sheet6 评价关系表（与导入模板 8 字段一致，可导出→调整→重新导入）
- [x] 稳定字段名（便于 Power Query / 透视表）：中文列头 + 固定列序；数值 2 位小数（round 2 + numFmt "0.00"，完成率 0~1 数值 + "0.00%" 格式）
- [x] `POST /api/projects/:id/export/excel` + HR 端导出按钮（结果后台，blob 下载）+ AuditLog（EXPORT_RESULTS）
- [x] 全链路冒烟：集成测试覆盖"创建→问卷→关系→提交→冻结→导出"（9 用例）

**验收结果**：✅ 全链路集成测试（创建→导入→提交 3 份→截止→冻结→导出）直连 service 生成 buffer 并用 ExcelJS 反解析断言：6 个 Sheet 名称与顺序稳定；Sheet1 张三 360 总分 4.43（=310/70，展示 2 位）、自评 3/上级 4/平级 5/下级 空、完成率 75%，李四全空 0/2；Sheet2 13 行含李四 Q5 开放题原文「上级开放反馈：继续保持」与维度路径（Q3=专业能力/技术深度）；Sheet3 12 行（仅 RATING 快照，Q5 文本与无提交关系不入）；Sheet4 12 行树序（团队管理→专业能力→技术深度→技术广度 × 三关系）；Sheet5 6 任务（3 已提交含提交时间/3 未开始）；Sheet6 4 条非自评关系（8 字段与导入模板对齐）；导出写 EXPORT_RESULTS 审计。权限：非项目管理员 403、未冻结 409（集成测试）；E2E：API 200 + xlsx 二进制（PK 魔数）+ Content-Disposition + 结果后台导出按钮可见（chromium/mobile 双工程）。全套 196 vitest（新增 9 集成）+ 36 E2E 通过，lint/typecheck/format 通过。

**验收（MVP 整体验收，PRD 第 47 节 + 技术文档第 77 节）**：

> 不依赖人工计算与人工改库，完整跑通一次真实 360：
> Excel 导入问卷 → Excel 导入关系 → 飞书(或mock)登录 → 单人评价 → 矩阵评价 → 草稿恢复 → 按人/批量提交 → HR 退回重评 → 截止 → 冻结 → 自动计算 → Excel 导出。
> 建议真实小范围测试：5 名被评人 × 20 名评价人 × 30 量表题 + 3 开放题。

**✅ 真实小范围测试（2026-09-16 跑通，`scripts/real-test.mjs` / `submit-bulk.mjs` / `verify-export.mjs`）**：
- **数据规模（按建议 5×20×30）**：5 名被评人（20001~20005 张伟/李娜/王强/刘洋/陈静，含部门/岗位/职级）× 20 名评价人（30001~30020）+ 孙建军 上级；**33 题** = 30 量表（QA/QB/TC/TD/CE 各维度，适用自评/上级/平级/下级）+ 3 开放题（TEXT1~TEXT3）；**60 条评价任务**（自评 5 + 上级 5 + 平级 20 + 下级 30）+ 5 自评。
- **搭建**：`real-test.mjs` mock 登录 HR(60000)→ 建 ACTIVE 项目→ **真实 API** 导入问卷 commit、导入关系 commit（8 字段模板）。
- **提交**：`submit-bulk.mjs` 走真实 HTTP 逐人填草稿（1.5s 自动保存链路）并提交；含单人提交流程 + 批量提交演示；**60/60 全部已提交**，无任务缺题。
- **浏览器走查（关键节点）**：HR 进度看板显示 **60/60、完成率 100%、无未完成告警** → 提前截止 → 冻结 → 结果后台 5 名被评人均显示得分/完成率 → 点「导出 Excel」触发下载。
- **导出验证（`verify-export.mjs` 反解析真实下载文件）**：size 116900 bytes，**6 个 Sheet**（被评人汇总 5 人、评价明细 1976 行含量表+开放题原文、题目级汇总 601 行、维度级汇总 141 行、任务完成情况 60 已提交 均含提交时间、评价关系 56 行含上级/平级/下级）。
- **结果合理**：5 名被评人 360 总分 ≈3.76、自评/上级/平级/下级 一致（保留权重 40/30/30 归一化）；题目级得分落到 3.5/3.75 等 0.5 网格，开放题原文保留。

**MVP 完成后暂停开发，先跑真实测试；V1（拖拽编辑器、模板库、测试模式、图表、网页/PDF 报告、飞书多维表格同步等）待真实流程跑通后再立项。**

## Sprint 10：过程看结果 + 人员初始化配置 + 界面中文化 ✅（2026-09-16 完成）

真实测试反馈的三项改进：

- [x] **需求 1：测评过程中即可查看已提交结果（不必先冻结）**
  - [x] `modules/results/snapshot.ts` 抽出只读纯函数 `toScoringData` / `aggregateReviewees` / `computeDrafts`（冻结落库与实时计分共用同一得分口径，避免两套算法）
  - [x] `modules/results/service.ts` 新增 `loadRealtimeScoring`；`listProjectResults` / `getResultDetail` 未冻结时走实时分支（`frozen=false`，仅统计已提交评价，不落库）；`listReviewerDetails` 移除未冻结 409 拦截
  - [x] UI：结果后台/下钻页未冻结时显示「实时数据」提示条与「· 实时」标记；项目设置页「结果后台」入口常驻；进度看板新增「已提交结果（实时）」入口卡片
  - [x] 冻结后仍读 ResultSnapshot（只读快照）；Excel 导出保持「仅冻结后」不变（导出即正式结果）
- [x] **需求 2：人员初始化配置（全局人员主数据）**
  - [x] `User` 增加 `department / position / grade`（migration `add_user_dept_position_grade`）
  - [x] `POST /api/admin/users`（新增，工号唯一 409）、`PATCH /api/admin/users/:id`（改姓名/部门/岗位/职级 + 角色）、`POST /api/admin/users/bulk`（Excel 批量导入，模板列 工号/姓名/部门/岗位/职级，表内重复与已存在工号记错误并跳过）
  - [x] 用户管理页：新增人员表单 + 批量导入 + 行内编辑 + 列表新增 部门/岗位/职级 列
- [x] **需求 3：界面英文中文化**：根 layout 的 `title`/`description` 由 "Create Next App" 改为「人才盘点 360」/「360 度人才测评平台」，`lang` 改为 `zh-CN`；用户管理描述中的 `SYSTEM_ADMIN` 术语改为「系统管理员」

**验收结果**：✅ 未冻结项目直接进入结果后台可见实时分数（张三 上级 4.00 → 总分 4.00 / 完成 1/4，无提交者显示「—」），冻结后读快照行为不变；用户管理可新增/编辑/批量导入人员并落库 部门/岗位/职级。新增集成测试 `tests/integration/admin-users.test.ts`（9 用例：新增 201/唯一 409/权限 403/编辑清空/禁改自己角色/列表新字段/批量导入错误行号/空文件 400）与 E2E `tests/e2e/sprint10.spec.ts`（2 用例 × 双工程），并更新 `results.test.ts` 未冻结用例为实时计分断言。全套 **205 vitest + 39 E2E** 通过，lint/typecheck/format 通过。

