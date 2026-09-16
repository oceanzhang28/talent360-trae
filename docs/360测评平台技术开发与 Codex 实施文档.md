# 360测评平台技术开发与 Codex 实施文档

# 1. 技术目标

建设一个：

- 单公司
- 单体优先
- 模块化
- TypeScript全栈
- PostgreSQL主数据库
- 飞书OAuth登录
- 可Docker化
- 可公网部署

的360测评系统。

当前规模：

> 单项目被评人 ≤ 200人。

因此不建设：

- 微服务
- Kubernetes
- Kafka
- Elasticsearch
- 分布式数据库

避免过度设计。

---

# 2. 推荐技术栈

## 2.1 Web框架

推荐：

> Next.js + TypeScript

采用当前稳定版本。

使用：

- App Router
- Server Components
- Server Actions / Route Handlers

原则：

> 前后台共用一个代码仓库。

不单独拆：

- React前端
- Java后端
- 独立API项目

降低Codex维护复杂度。

---

# 3. UI技术

建议：

- Tailwind CSS
- shadcn/ui
- TanStack Table
- dnd-kit
- ECharts

用途：

### shadcn/ui

基础后台组件。

### TanStack Table

- 结果表格
- 关系表
- 进度表
- 矩阵评价

### dnd-kit

问卷拖拽编辑器。

### ECharts

- 雷达图
- 柱状图
- 自评他评对比

---

# 4. 数据库

推荐：

> PostgreSQL

ORM：

> Prisma

数据库是：

> 系统唯一事实来源 Source of Truth。

禁止直接以飞书多维表格作为主数据库。

---

# 5. 文件处理

Excel：

> ExcelJS

用于：

- 问卷导入
- 关系导入
- Excel结果导出

PDF：

推荐：

> HTML报告 + Playwright打印PDF。

原因：

同一套HTML页面可以同时作为：

- 网页报告；
- PDF模板。

不需要维护两套报告代码。

---

# 6. 身份认证

统一使用：

> 飞书企业自建应用。

PC：

> 飞书扫码OAuth。

移动端：

> 飞书OAuth授权。

飞书官方提供企业系统扫码登录集成能力，正式开发时应由公司飞书管理员创建企业自建应用，并按实际开放平台控制台申请所需用户身份权限。具体scope名称和API版本实施时以飞书开放平台最新文档为准。

---

# 7. 身份映射逻辑

数据库不需要提前同步全公司员工。

登录过程：

```text
用户
 ↓
飞书 OAuth
 ↓
callback
 ↓
换取用户身份
 ↓
获取员工 employee_no
 ↓
查询 project_person.employee_no
 ↓
查询其当前项目任务
```

核心匹配字段：

> employee_no

禁止使用：

> 姓名

作为唯一标识。

---

# 8. 推荐项目目录

```text
talent360/
├─ app/
│  ├─ (auth)/
│  ├─ admin/
│  ├─ review/
│  ├─ reports/
│  └─ api/
│
├─ components/
│  ├─ ui/
│  ├─ questionnaire/
│  ├─ matrix-review/
│  ├─ charts/
│  └─ reports/
│
├─ modules/
│  ├─ auth/
│  ├─ projects/
│  ├─ questionnaires/
│  ├─ people/
│  ├─ review-relations/
│  ├─ review-tasks/
│  ├─ scoring/
│  ├─ reports/
│  ├─ excel/
│  ├─ feishu/
│  └─ audit/
│
├─ lib/
│  ├─ db/
│  ├─ validation/
│  ├─ permissions/
│  └─ utilities/
│
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/
│  └─ seed.ts
│
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  └─ e2e/
│
├─ scripts/
├─ docker/
├─ .env.example
└─ README.md
```

---

# 9. 核心数据模型

以下为逻辑数据模型。

---

## 9.1 User

系统登录用户。

```text
User
- id
- feishuOpenId
- feishuUnionId
- employeeNo
- name
- systemRole
- lastLoginAt
- createdAt
- updatedAt
```

systemRole：

```text
SYSTEM_ADMIN
USER
```

HR项目管理员：

> 不建议放在User全局角色里。

通过：

> ProjectAdmin

管理。

---

# 10. Project

```text
Project
- id
- name
- description
- questionnaireInstruction
- startAt
- endAt
- status
- selfReviewEnabled
- managerWeight
- peerWeight
- subordinateWeight
- frozenAt
- frozenBy
- deletedAt
- purgeAfter
- createdAt
- updatedAt
```

状态：

```text
DRAFT
PUBLISHED
ACTIVE
CLOSED
FROZEN
ARCHIVED
DELETED
```

---

# 11. ProjectAdmin

```text
ProjectAdmin
- id
- projectId
- userId
- createdAt
```

约束：

```text
unique(projectId, userId)
```

---

# 12. ProjectPerson

保存：

> 项目当时的人员信息快照。

```text
ProjectPerson
- id
- projectId
- employeeNo
- name
- department
- position
- grade
- feishuOpenId nullable
- createdAt
```

唯一约束：

```text
unique(projectId, employeeNo)
```

---

# 13. Questionnaire

```text
Questionnaire
- id
- projectId nullable
- templateName nullable
- isTemplate
- lockedAt nullable
- createdAt
- updatedAt
```

模板：

> 与项目问卷使用同样数据模型。

---

# 14. Dimension

树状结构最大两级。

```text
Dimension
- id
- questionnaireId
- parentId nullable
- name
- description
- weight
- order
- applicableSelf
- applicableManager
- applicablePeer
- applicableSubordinate
```

parentId为空：

> 一级维度。

parentId不为空：

> 二级维度。

建议第一版增加校验：

> 同一个一级维度不能同时直接放题目和二级维度。

避免评分歧义。

---

# 15. Question

```text
Question
- id
- dimensionId
- type
- code
- title
- description
- weight
- required
- order
- overrideRelationRules
- applicableSelf
- applicableManager
- applicablePeer
- applicableSubordinate
```

type：

```text
RATING
TEXT
```

TEXT：

> weight = null。

---

# 16. ProjectScale

```text
ProjectScale
- id
- projectId
- value
- label
- order
```

固定value：

```text
0.5
1.0
1.5
2.0
2.5
3.0
3.5
4.0
4.5
5.0
```

HR只修改：

> label。

---

# 17. ReviewRelation

评价关系。

```text
ReviewRelation
- id
- projectId
- revieweePersonId
- reviewerPersonId
- relationType
- active
- createdAt
- updatedAt
```

relationType：

```text
SELF
MANAGER
PEER
SUBORDINATE
```

唯一约束：

```text
unique(
 projectId,
 revieweePersonId,
 reviewerPersonId
)
```

---

# 18. ReviewTask

每一条关系对应一份评价任务。

```text
ReviewTask
- id
- projectId
- relationId
- status
- startedAt
- submittedAt
- returnedAt
- currentSubmissionVersion
```

状态：

```text
NOT_STARTED
IN_PROGRESS
SUBMITTED
RETURNED
```

---

# 19. DraftAnswer

只保存评价人当前草稿。

```text
DraftAnswer
- id
- taskId
- questionId
- score nullable
- textValue nullable
- updatedAt
```

唯一：

```text
unique(taskId, questionId)
```

HR：

> 无接口读取DraftAnswer。

---

# 20. Submission

每次正式提交生成一个版本。

```text
Submission
- id
- taskId
- version
- submittedAt
- invalidatedAt nullable
- invalidReason nullable
```

---

# 21. SubmissionAnswer

提交快照。

```text
SubmissionAnswer
- id
- submissionId
- questionId
- score nullable
- textValue nullable
```

这样可以实现：

```text
第一次提交
 → HR退回
 → 第二次提交
```

同时仍保留：

> 第一次历史数据。

最终计算：

> 使用当前有效版本。

---

# 22. ResultSnapshot

冻结项目时生成正式结果快照。

```text
ResultSnapshot
- id
- projectId
- revieweePersonId
- totalScore
- selfScore
- managerScore
- peerScore
- subordinateScore
- expectedCount
- submittedCount
- completionRate
- createdAt
```

---

# 23. ResultDimension

```text
ResultDimension
- resultSnapshotId
- dimensionId
- relationType
- score
```

---

# 24. ResultQuestion

```text
ResultQuestion
- resultSnapshotId
- questionId
- relationType
- score
```

---

# 25. AuditLog

仅关键操作。

```text
AuditLog
- id
- actorUserId
- projectId
- action
- entityType
- entityId
- metadataJson
- createdAt
```

action：

```text
RETURN_REVIEW
DELETE_RELATION
CHANGE_RELATION
FREEZE_PROJECT
UNFREEZE_PROJECT
EXPORT_RESULTS
SYNC_FEISHU
DELETE_PROJECT
RESTORE_PROJECT
```

---

# 26. 飞书多维表格配置

```text
FeishuBitableConfig
- id
- projectId
- appToken
- detailTableId
- summaryTableId
- lastSyncAt
```

Secret：

> 如涉及敏感Token，不以明文日志输出。

---

# 27. 评分算法

算法必须写成独立模块：

```text
modules/scoring
```

禁止：

> 把评分逻辑散落在页面组件里。

---

# 28. 第一步：题目平均分

某关系类型 r：

```text
QuestionScore(q,r)
=
AVG(所有该关系已提交评价人的有效评分)
```

例如：

```text
4.0
3.5
4.5
```

得到：

```text
4.0
```

---

# 29. 第二步：题目权重归一化

如果关系r只看到部分题目：

```text
NormalizedWeight(q,r)
=
OriginalWeight(q)
/
Σ ApplicableOriginalWeights
```

---

# 30. 第三步：二级维度

```text
SecondDimensionScore
=
Σ(
 QuestionScore
 × NormalizedQuestionWeight
)
```

---

# 31. 第四步：一级维度

三级问卷：

```text
FirstDimensionScore
=
Σ(
 SecondDimensionScore
 × NormalizedSecondDimensionWeight
)
```

两级问卷：

```text
FirstDimensionScore
=
Σ(
 QuestionScore
 × NormalizedQuestionWeight
)
```

---

# 32. 第五步：关系得分

```text
RelationScore
=
Σ(
 FirstDimensionScore
 × NormalizedDimensionWeight
)
```

如果该关系不评价部分一级维度：

> 对剩余维度重新归一化。

---

# 33. 第六步：最终360分

仅：

- MANAGER
- PEER
- SUBORDINATE

参与。

SELF：

> 不参与。

设有效关系集合：

```text
R
```

则：

```text
EffectiveRelationWeight(r)
=
ConfiguredWeight(r)
/
Σ ConfiguredWeight(valid relations)
```

最终：

```text
Total360
=
Σ(
 RelationScore(r)
 × EffectiveRelationWeight(r)
)
```

---

# 34. 完成率

```text
CompletionRate
=
有效提交任务数
/
应评价任务数
```

分别计算：

- 总完成率
- 上级完成率
- 平级完成率
- 下级完成率
- 自评完成状态

---

# 35. 冻结逻辑

冻结时：

1. 查询所有有效Submission；
2. 执行评分引擎；
3. 生成ResultSnapshot；
4. 生成维度结果；
5. 生成题目结果；
6. 保存完成度；
7. Project.status = FROZEN；
8. 记录AuditLog。

之后报告：

> 只读取ResultSnapshot。

避免历史结果随着业务表变化。

---

# 36. 飞书登录模块

建议单独实现：

```text
modules/feishu/auth
```

包含：

```text
getAuthorizationUrl()
exchangeCode()
getCurrentUser()
getEmployeeNo()
```

业务模块不直接调用飞书HTTP接口。

而调用：

```text
FeishuAuthService
```

方便未来更换认证方式。

---

# 37. 飞书环境变量

至少预留：

```text
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_REDIRECT_URI=
FEISHU_BASE_URL=
```

多维表格相关：

```text
FEISHU_BITABLE_ENABLED=
```

具体飞书权限scope：

> 由IT管理员依据实施时开放平台当前权限名称配置。

---

# 38. 身份安全规则

登录后服务器必须验证：

1. 飞书OAuth成功；
2. 员工来自指定企业；
3. 能获取employeeNo；
4. employeeNo与项目人员匹配。

不能：

> 接受前端自行传employeeNo作为认证依据。

---

# 39. API模块建议

## Auth

```text
GET  /api/auth/feishu/start
GET  /api/auth/feishu/callback
POST /api/auth/logout
GET  /api/me
```

---

## Projects

```text
GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PATCH  /api/projects/:id
POST   /api/projects/:id/publish
POST   /api/projects/:id/close
POST   /api/projects/:id/freeze
POST   /api/projects/:id/unfreeze
DELETE /api/projects/:id
```

---

# 40. 问卷API

```text
GET   /api/projects/:id/questionnaire
POST  /api/projects/:id/questionnaire/import
PATCH /api/questions/:id
POST  /api/dimensions
POST  /api/questions
POST  /api/questionnaire/reorder
POST  /api/questionnaire/validate
```

---

# 41. 人员关系API

```text
POST /api/projects/:id/relations/import/preview
POST /api/projects/:id/relations/import/commit

GET  /api/projects/:id/relations
POST /api/projects/:id/relations
PATCH /api/relations/:id
DELETE /api/relations/:id
```

---

# 42. 评价端API

```text
GET /api/my/tasks

GET /api/tasks/:id
GET /api/tasks/:id/draft

PUT /api/tasks/:id/draft
POST /api/tasks/:id/submit

POST /api/tasks/batch-submit
```

---

# 43. HR评价管理

```text
GET  /api/projects/:id/progress
GET  /api/projects/:id/reviewers
GET  /api/projects/:id/reviewees

POST /api/tasks/:id/return
```

HR禁止：

```text
PATCH /api/tasks/:id/answers
```

即：

> 不提供管理员修改评价答案API。

---

# 44. 结果API

```text
GET /api/projects/:id/results
GET /api/projects/:id/results/:personId
GET /api/projects/:id/results/:personId/report
```

---

# 45. 导出

```text
POST /api/projects/:id/export/excel
POST /api/projects/:id/reports/pdf
POST /api/projects/:id/reports/pdf-batch
```

---

# 46. 多维表格

```text
POST /api/projects/:id/feishu/test
POST /api/projects/:id/feishu/sync
GET  /api/projects/:id/feishu/sync-status
```

---

# 47. 权限中间件

统一：

```text
requireLogin()
requireSystemAdmin()
requireProjectAdmin(projectId)
requireReviewerTask(taskId)
```

禁止在页面上简单通过：

```text
if(role)
```

代替服务端权限验证。

---

# 48. Excel关系导入流程

严格两阶段。

## Preview

```text
Excel
 ↓
解析
 ↓
标准化
 ↓
校验
 ↓
返回 PreviewResult
```

PreviewResult：

```json
{
  "total": 860,
  "valid": 850,
  "errors": 5,
  "duplicates": 3,
  "conflicts": 2
}
```

此阶段：

> 不写正式表。

---

## Commit

HR确认后：

> 再执行数据库事务。

事务失败：

> 整批回滚。

---

# 49. 自动保存

前端：

> debounce 约1~2秒。

只保存变化字段。

要求：

- 切换人员不丢数据；
- 切换单人/矩阵不丢数据；
- 页面刷新可恢复；
- 手机/PC重新登录可恢复。

---

# 50. 矩阵模式实现

URL建议：

```text
/review/matrix?relation=PEER&dimension=xxx
```

状态维度：

```text
relation
dimension
reviewees
questions
draftAnswers
```

每个单元格本质仍然保存：

```text
taskId + questionId
```

所以：

> 单人模式与矩阵模式共用同一DraftAnswer。

不要为矩阵再建第二套答案表。

---

# 51. 移动端矩阵

不能使用完整宽表强行缩放。

建议：

```text
当前维度
 ↓
当前题目
 ↓
多个人员评分卡
```

或者：

> 固定姓名列 + 横向滑动题目。

必须实际手机测试。

---

# 52. PDF设计

采用：

```text
/reports/:personId/print
```

专门打印页面。

服务器使用Playwright：

```text
HTML
 ↓
Chromium
 ↓
PDF
```

批量：

```text
多个PDF
 ↓
ZIP
```

---

# 53. 批量任务

MVP：

可以同步处理小批量。

V1/V2建议加入后台任务队列。

优先考虑：

> pg-boss / PostgreSQL-based queue

原因：

> 可以不额外维护Redis。

若后续规模扩大，再切：

> BullMQ + Redis。

---

# 54. Excel导出结构

生成：

```text
360_results.xlsx
```

包含：

```text
被评人汇总
评价明细
题目级汇总
维度级汇总
任务完成情况
评价关系
```

所有Sheet：

> 使用稳定字段名。

便于HR后续Power Query / Pivot / Python分析。

---

# 55. 飞书多维表格同步

数据库仍为主数据。

同步流程：

```text
HR点击同步
 ↓
验证App Token / Table ID
 ↓
读取正式结果
 ↓
转换固定字段格式
 ↓
批量写入评分明细
 ↓
批量写入汇总
 ↓
写SyncLog
```

建议：

> 只有冻结结果允许同步正式结果。

如业务需要同步临时结果：

> UI明确标识“未冻结数据”。

---

# 56. 安全设计

360数据属于敏感HR数据。

必须做到：

### 传输

正式环境：

> HTTPS。

### 数据库

数据库：

> 不暴露公网端口。

### Cookie

使用：

```text
HttpOnly
Secure
SameSite=Lax
```

### API

所有项目接口：

> 服务端鉴权。

### 日志

禁止打印：

- 完整评价内容
- App Secret
- access token

---

# 57. CSRF / XSS / SQL注入

要求：

- ORM参数化查询；
- React默认转义；
- Markdown如支持必须sanitize；
- 状态修改API启用CSRF防护；
- OAuth callback校验state。

---

# 58. 数据删除

soft delete：

```text
deletedAt
purgeAfter = deletedAt + 30 days
```

普通查询：

> 自动排除deleted记录。

系统管理员：

> 可以恢复。

彻底清理：

> 单独purge job。

---

# 59. 推荐测试体系

## 单元测试

重点：

### scoring

必须覆盖：

- 正常三关系；
- 缺少下级；
- 下级有配置但0提交；
- 关系题目不同；
- 关系维度不同；
- 两级问卷；
- 三级问卷；
- 自评不入总分；
- 权重归一化；
- 多评价人题目平均。

评分引擎：

> 测试覆盖率建议 ≥ 90%。

---

# 60. 集成测试

覆盖：

```text
项目创建
→ 问卷导入
→ 关系导入
→ 登录
→ 填写
→ 提交
→ 冻结
→ 结果
```

---

# 61. E2E

推荐：

> Playwright。

至少测试：

### HR

创建项目。

### Employee

登录并提交。

### HR

查看结果并冻结。

---

# 62. Codex开发原则

Codex不得一次生成整个系统。

采用：

> Epic → Story → PR

方式。

每次只完成一个完整模块。

---

# 63. 推荐开发顺序

## Sprint 0：项目骨架

让Codex完成：

- Next.js初始化
- TypeScript
- PostgreSQL
- Prisma
- Tailwind
- shadcn
- Docker开发环境
- ESLint
- Prettier
- Vitest
- Playwright

完成后：

> 能本地一条命令启动。

---

# 64. Sprint 1：认证与权限

开发：

- User
- 飞书登录抽象
- mock登录模式
- 系统管理员
- ProjectAdmin
- 权限middleware

非常重要：

开发期间提供：

```text
AUTH_MODE=mock
AUTH_MODE=feishu
```

这样没有飞书App时：

> Codex仍可以开发全部业务。

---

# 65. Sprint 2：项目

完成：

- 项目CRUD
- 生命周期
- 项目管理员
- 项目配置
- 评分档位

---

# 66. Sprint 3：问卷

先实现：

- 数据结构
- Excel导入
- 权重校验
- 关系题目控制

不要一开始开发拖拽编辑器。

先保证：

> 数据模型正确。

---

# 67. Sprint 4：人员关系

完成：

- Excel解析
- Preview
- 错误报告
- Commit
- 人员快照
- ReviewRelation
- ReviewTask
- 自评自动任务

---

# 68. Sprint 5：评价端

先做：

> 单人模式。

完成：

- 任务列表
- 问卷
- 自动保存
- 提交
- 只读
- 退回

确认数据逻辑正确以后：

> 再做矩阵。

---

# 69. Sprint 6：矩阵模式

实现：

- 按关系分组
- 按维度
- 多人员
- 自动保存
- 单人提交
- 批量提交

必须保证：

> 与单人模式共享草稿。

---

# 70. Sprint 7：评分引擎

这是系统最核心模块。

先写：

> Tests。

再写：

> Implementation。

不要边做页面边写公式。

推荐Codex工作指令：

```text
Implement the scoring engine from specification.
Do not modify UI.
Write unit tests first.
All scoring must use Decimal arithmetic.
Do not round intermediate calculations.
```

---

# 71. Sprint 8：进度与结果

实现：

- 总进度
- 评价人进度
- 被评人进度
- 结果页
- 完整性提示
- freeze

---

# 72. Sprint 9：Excel

实现完整分析工作簿。

完成MVP。

此时应该进行：

> 一次真实小范围360测试。

例如：

> 5名被评人 × 20名评价人。

不要继续开发高级功能，直到真实流程跑通。

---

# 73. V1开发

真实测试通过后再做：

- 拖拽问卷编辑器
- 模板库
- 测试模式
- ECharts
- 网页报告
- PDF
- 批量PDF
- 飞书多维表格

---

# 74. V2开发

再增加：

- 回收站
- 审计
- 后台任务
- 监控
- 正式部署
- 备份
- 安全强化
- 移动端深度优化

---

# 75. Codex必须遵守的约束

在仓库根目录建立：

```text
AGENTS.md
```

核心内容：

```text
1. Do not change scoring formulas without updating tests.
2. PostgreSQL is the source of truth.
3. HR users must never edit submitted answers.
4. Draft answers must never be exposed to HR APIs.
5. employeeNo is the business identity key.
6. Historical ProjectPerson records are snapshots.
7. Self review never contributes to total 360 score.
8. Never round intermediate scoring calculations.
9. All project data access must verify project permission.
10. Never log Feishu tokens or sensitive review content.
```

---

# 76. Definition of Done

每个Codex任务只有同时满足以下条件才算完成：

- 功能实现；
- TypeScript无错误；
- lint通过；
- unit tests通过；
- 相关integration tests通过；
- 数据库migration已生成；
- API权限已检查；
- README或模块文档更新；
- 未破坏已有测试。

---

# 77. 第一阶段验收场景

建立测试项目：

> 2026管理干部360测试

准备：

- 5名被评人
- 20名评价人
- 30道量表题
- 3道开放题
- 自评/上级/平级/下级

完整执行：

```text
Excel导入
→ 飞书登录
→ 单人评价
→ 矩阵评价
→ 保存草稿
→ 提交
→ HR退回
→ 重新提交
→ 截止
→ 冻结
→ 计算
→ Excel
```

所有流程无人工改数据库：

> MVP才算验收通过。

---

# 78. 第一阶段暂时不要做的事情

Codex开发过程中明确禁止范围蔓延：

不要开发：

- AI评价摘要
- 九宫格
- 继任
- IDP
- 绩效
- 强制排名
- 通讯录全量同步
- 自动催办
- 多租户
- 复杂组织树
- 微服务
- Kubernetes

第一目标只有一个：

> 稳定完成一次真实360测评。

---

# 79. 推荐开发策略

这个项目最适合按照：

```text
业务规则
 ↓
数据库
 ↓
测试
 ↓
API
 ↓
UI
```

推进。

尤其以下三个模块必须“后端逻辑优先”：

1. 评价关系
2. 提交版本
3. 评分引擎

而不是先让Codex把页面做漂亮。

---

# 80. 项目最终架构

整体结构应保持：

```text
                  飞书
                   │
                   │ OAuth
                   ▼
┌──────────────────────────────┐
│        Talent 360 Web        │
│                              │
│  HR后台      员工评价端      │
│                              │
│  项目        单人评价        │
│  问卷        矩阵评价        │
│  人员        我的任务        │
│  进度                        │
│  结果                        │
└──────────────┬───────────────┘
               │
               ▼
         PostgreSQL
               │
       ┌───────┴────────┐
       ▼                ▼
    Excel/PDF      飞书多维表格
                     手动同步
```

核心原则：

> PostgreSQL存正式数据；飞书负责身份；多维表格负责二次分析。

这三个角色不要混淆。