import ExcelJS from "exceljs";
import type { RelationType, User } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError, requireProjectAdmin } from "@/lib/permissions";
import { writeAudit } from "@/modules/audit/service";
import { RELATION_LABELS, RELATION_ORDER } from "./service";

/**
 * 结果 Excel 完整导出（技术文档第 54 节 / PRD 第 46 节）：
 * 360_results.xlsx 固定 6 个 Sheet、稳定字段名与列序，便于 Power Query / 透视表。
 * 仅 FROZEN / ARCHIVED 项目可导出（与结果后台一致，正式结果只读快照）。
 * 展示层 2 位小数（铁律 8）：得分列四舍五入到 2 位并设 numFmt，完成率为 0~1 数值 + 百分比格式。
 */

export const RESULTS_EXCEL_FILENAME = "360_results.xlsx";

/** 结果数据可读状态：冻结后（含归档历史项目） */
const RESULT_STATUSES = new Set(["FROZEN", "ARCHIVED"]);

const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "未开始",
  IN_PROGRESS: "进行中",
  SUBMITTED: "已提交",
  RETURNED: "已退回",
};

const TYPE_LABELS: Record<string, string> = {
  RATING: "量表",
  TEXT: "文本",
};

function round2(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

function fmtDateTime(d: Date | null): string {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function relationSeq(relation: RelationType): number {
  return RELATION_ORDER.indexOf(relation);
}

type SheetSpec = {
  name: string;
  headers: string[];
  rows: (string | number | null)[][];
  /** 列号（1 起）→ 数字格式 */
  numFmt?: Record<number, string>;
  /** 额外列宽（列号 → 宽度），默认按表头长度 */
  widths?: Record<number, number>;
};

function addSheet(workbook: ExcelJS.Workbook, spec: SheetSpec): void {
  const sheet = workbook.addWorksheet(spec.name);
  sheet.addRow(spec.headers);
  sheet.getRow(1).font = { bold: true };
  for (const row of spec.rows) sheet.addRow(row);
  spec.headers.forEach((header, i) => {
    sheet.getColumn(i + 1).width =
      spec.widths?.[i + 1] ?? Math.max(12, Math.min(24, header.length * 2 + 6));
  });
  for (const [col, fmt] of Object.entries(spec.numFmt ?? {})) {
    sheet.getColumn(Number(col)).numFmt = fmt;
  }
}

/**
 * 生成结果导出 Excel（直连 service，不经 HTTP 层，便于集成测试）。
 * 权限：项目管理员；未冻结 409。导出动作写 AuditLog（EXPORT_RESULTS）。
 */
export async function generateResultsExcel(
  projectId: string,
  user: User,
): Promise<Buffer> {
  const project = await requireProjectAdmin(projectId, user);
  if (!RESULT_STATUSES.has(project.status)) {
    throw new ApiError(409, "项目未冻结，暂无正式结果可导出");
  }

  const questionnaire = await prisma.questionnaire.findUnique({
    where: { projectId },
  });
  if (!questionnaire) {
    throw new ApiError(404, "项目问卷不存在");
  }

  // ---- 批量取数（避免逐人 N+1） ----
  const [dimensions, questions, snapshots, relations] = await Promise.all([
    prisma.dimension.findMany({
      where: { questionnaireId: questionnaire.id },
      orderBy: { order: "asc" },
    }),
    prisma.question.findMany({
      where: { dimension: { questionnaireId: questionnaire.id } },
    }),
    prisma.resultSnapshot.findMany({
      where: { projectId },
      include: {
        reviewee: {
          select: {
            id: true,
            employeeNo: true,
            name: true,
            department: true,
            position: true,
            grade: true,
          },
        },
      },
    }),
    prisma.reviewRelation.findMany({
      where: { projectId, active: true },
      include: {
        reviewee: {
          select: {
            employeeNo: true,
            name: true,
            department: true,
            position: true,
            grade: true,
          },
        },
        reviewer: { select: { employeeNo: true, name: true } },
        tasks: { select: { status: true, submittedAt: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const snapshotIds = snapshots.map((s) => s.id);
  const [dimScores, questionScores, submissions] = await Promise.all([
    snapshotIds.length
      ? prisma.resultDimension.findMany({
          where: { resultSnapshotId: { in: snapshotIds } },
        })
      : Promise.resolve([]),
    snapshotIds.length
      ? prisma.resultQuestion.findMany({
          where: { resultSnapshotId: { in: snapshotIds } },
        })
      : Promise.resolve([]),
    prisma.submission.findMany({
      where: {
        invalidatedAt: null,
        task: { relation: { projectId, active: true } },
      },
      include: {
        task: {
          include: {
            relation: {
              include: {
                reviewee: { select: { employeeNo: true, name: true } },
                reviewer: { select: { employeeNo: true, name: true } },
              },
            },
          },
        },
        answers: true,
      },
    }),
  ]);

  // ---- 问卷结构索引 ----
  const dimById = new Map(dimensions.map((d) => [d.id, d]));
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const questionsByDim = new Map<string, typeof questions>();
  for (const q of questions) {
    const list = questionsByDim.get(q.dimensionId) ?? [];
    list.push(q);
    questionsByDim.set(q.dimensionId, list);
  }
  const childrenByParent = new Map<string, typeof dimensions>();
  for (const d of dimensions) {
    if (d.parentId === null) continue;
    const list = childrenByParent.get(d.parentId) ?? [];
    list.push(d);
    childrenByParent.set(d.parentId, list);
  }
  // 题目树序（与结果下钻一致：一级维度 order → 直挂题 → 二级维度 order → 二级题）
  const questionSeq = new Map<string, number>();
  // 维度树序（一级维度 → 其二级维度，深度优先）
  const dimensionSeq = new Map<string, number>();
  let seq = 0;
  let dseq = 0;
  for (const root of dimensions.filter((d) => d.parentId === null)) {
    dimensionSeq.set(root.id, dseq++);
    for (const child of childrenByParent.get(root.id) ?? []) {
      dimensionSeq.set(child.id, dseq++);
      for (const q of questionsByDim.get(child.id) ?? []) {
        questionSeq.set(q.id, seq++);
      }
    }
    for (const q of questionsByDim.get(root.id) ?? []) {
      questionSeq.set(q.id, seq++);
    }
  }
  /** 题目 →（一级维度名, 二级维度名；直挂题为空串） */
  const dimPathOf = (questionId: string): { l1: string; l2: string } => {
    const q = questionById.get(questionId);
    if (!q) return { l1: "", l2: "" };
    const dim = dimById.get(q.dimensionId);
    if (!dim) return { l1: "", l2: "" };
    if (dim.parentId === null) return { l1: dim.name, l2: "" };
    const parent = dimById.get(dim.parentId);
    return { l1: parent?.name ?? "", l2: dim.name };
  };

  // 被评人快照按工号排序（各 Sheet 行序稳定）
  const sortedSnapshots = snapshots
    .slice()
    .sort((a, b) => a.reviewee.employeeNo.localeCompare(b.reviewee.employeeNo));
  // 关系行序：被评人工号 → 关系序 → 评价人工号
  const sortedRelations = relations
    .slice()
    .sort(
      (a, b) =>
        a.reviewee.employeeNo.localeCompare(b.reviewee.employeeNo) ||
        relationSeq(a.relationType) - relationSeq(b.relationType) ||
        a.reviewer.employeeNo.localeCompare(b.reviewer.employeeNo),
    );

  // ---- Sheet1 被评人汇总 ----
  const sheet1: SheetSpec = {
    name: "被评人汇总",
    headers: [
      "工号",
      "姓名",
      "部门",
      "岗位",
      "职级",
      "360总分",
      "自评得分",
      "上级得分",
      "平级得分",
      "下级得分",
      "应评数",
      "已提交数",
      "完成率",
    ],
    numFmt: {
      6: "0.00",
      7: "0.00",
      8: "0.00",
      9: "0.00",
      10: "0.00",
      13: "0.00%",
    },
    rows: sortedSnapshots.map((s) => [
      s.reviewee.employeeNo,
      s.reviewee.name,
      s.reviewee.department,
      s.reviewee.position,
      s.reviewee.grade,
      round2(s.totalScore?.toNumber() ?? null),
      round2(s.selfScore?.toNumber() ?? null),
      round2(s.managerScore?.toNumber() ?? null),
      round2(s.peerScore?.toNumber() ?? null),
      round2(s.subordinateScore?.toNumber() ?? null),
      s.expectedCount,
      s.submittedCount,
      s.completionRate?.toNumber() ?? null,
    ]),
  };

  // ---- Sheet2 评价明细（每行 = 一位评价人对一位被评人的一道题答案） ----
  const sortedSubmissions = submissions
    .slice()
    .sort(
      (a, b) =>
        a.task.relation.reviewee.employeeNo.localeCompare(
          b.task.relation.reviewee.employeeNo,
        ) ||
        relationSeq(a.task.relation.relationType) -
          relationSeq(b.task.relation.relationType) ||
        a.task.relation.reviewer.employeeNo.localeCompare(
          b.task.relation.reviewer.employeeNo,
        ),
    );
  const sheet2: SheetSpec = {
    name: "评价明细",
    headers: [
      "被评人工号",
      "被评人姓名",
      "评价人工号",
      "评价人姓名",
      "关系",
      "一级维度",
      "二级维度",
      "题目编码",
      "题目",
      "题型",
      "得分",
      "开放题原文",
    ],
    widths: { 9: 36, 12: 50 },
    rows: sortedSubmissions.flatMap((sub) => {
      const rel = sub.task.relation;
      const answers = sub.answers
        .slice()
        .sort(
          (a, b) =>
            (questionSeq.get(a.questionId) ?? 0) -
            (questionSeq.get(b.questionId) ?? 0),
        );
      return answers.map((a) => {
        const q = questionById.get(a.questionId);
        const path = dimPathOf(a.questionId);
        return [
          rel.reviewee.employeeNo,
          rel.reviewee.name,
          rel.reviewer.employeeNo,
          rel.reviewer.name,
          RELATION_LABELS[rel.relationType],
          path.l1,
          path.l2,
          q?.code ?? "",
          q?.title ?? "",
          q ? (TYPE_LABELS[q.type] ?? "") : "",
          a.score === null ? null : a.score.toNumber(),
          a.textValue ?? "",
        ];
      });
    }),
  };

  // ---- Sheet3 题目级汇总（快照：RATING 题平均分 × 关系） ----
  const questionScoresBySnapshot = new Map<string, typeof questionScores>();
  for (const row of questionScores) {
    const list = questionScoresBySnapshot.get(row.resultSnapshotId) ?? [];
    list.push(row);
    questionScoresBySnapshot.set(row.resultSnapshotId, list);
  }
  const sheet3: SheetSpec = {
    name: "题目级汇总",
    headers: [
      "被评人工号",
      "被评人姓名",
      "关系",
      "一级维度",
      "二级维度",
      "题目编码",
      "题目",
      "得分",
    ],
    numFmt: { 8: "0.00" },
    widths: { 7: 36 },
    rows: sortedSnapshots.flatMap((s) =>
      (questionScoresBySnapshot.get(s.id) ?? [])
        .slice()
        .sort(
          (a, b) =>
            relationSeq(a.relationType) - relationSeq(b.relationType) ||
            (questionSeq.get(a.questionId) ?? 0) -
              (questionSeq.get(b.questionId) ?? 0),
        )
        .map((row) => {
          const q = questionById.get(row.questionId);
          const path = dimPathOf(row.questionId);
          return [
            s.reviewee.employeeNo,
            s.reviewee.name,
            RELATION_LABELS[row.relationType],
            path.l1,
            path.l2,
            q?.code ?? "",
            q?.title ?? "",
            round2(row.score.toNumber()),
          ];
        }),
    ),
  };

  // ---- Sheet4 维度级汇总（快照：一级/二级维度得分 × 关系） ----
  const dimScoresBySnapshot = new Map<string, typeof dimScores>();
  for (const row of dimScores) {
    const list = dimScoresBySnapshot.get(row.resultSnapshotId) ?? [];
    list.push(row);
    dimScoresBySnapshot.set(row.resultSnapshotId, list);
  }
  const sheet4: SheetSpec = {
    name: "维度级汇总",
    headers: [
      "被评人工号",
      "被评人姓名",
      "关系",
      "一级维度",
      "二级维度",
      "得分",
    ],
    numFmt: { 6: "0.00" },
    rows: sortedSnapshots.flatMap((s) =>
      (dimScoresBySnapshot.get(s.id) ?? [])
        .slice()
        .sort(
          (a, b) =>
            relationSeq(a.relationType) - relationSeq(b.relationType) ||
            (dimensionSeq.get(a.dimensionId) ?? 0) -
              (dimensionSeq.get(b.dimensionId) ?? 0),
        )
        .map((row) => {
          const dim = dimById.get(row.dimensionId);
          const l1 =
            dim?.parentId === null || !dim?.parentId
              ? (dim?.name ?? "")
              : (dimById.get(dim.parentId)?.name ?? "");
          const l2 = dim?.parentId == null ? "" : (dim?.name ?? "");
          return [
            s.reviewee.employeeNo,
            s.reviewee.name,
            RELATION_LABELS[row.relationType],
            l1,
            l2,
            round2(row.score.toNumber()),
          ];
        }),
    ),
  };

  // ---- Sheet5 评价任务完成情况（每行 = 一条 active 关系的任务） ----
  const sheet5: SheetSpec = {
    name: "任务完成情况",
    headers: [
      "被评人工号",
      "被评人姓名",
      "评价人工号",
      "评价人姓名",
      "关系",
      "任务状态",
      "提交时间",
    ],
    widths: { 7: 18 },
    rows: sortedRelations.map((rel) => {
      const task = rel.tasks[0];
      return [
        rel.reviewee.employeeNo,
        rel.reviewee.name,
        rel.reviewer.employeeNo,
        rel.reviewer.name,
        RELATION_LABELS[rel.relationType],
        STATUS_LABELS[task?.status ?? "NOT_STARTED"] ?? "未开始",
        fmtDateTime(task?.submittedAt ?? null),
      ];
    }),
  };

  // ---- Sheet6 评价关系表（与导入模板 8 字段一致，可导出→调整→重新导入） ----
  const sheet6: SheetSpec = {
    name: "评价关系",
    headers: [
      "被评人工号",
      "被评人姓名",
      "被评人部门",
      "被评人岗位",
      "被评人职级",
      "评价人工号",
      "评价人姓名",
      "评价关系",
    ],
    rows: sortedRelations
      .filter((rel) => rel.relationType !== "SELF")
      .map((rel) => [
        rel.reviewee.employeeNo,
        rel.reviewee.name,
        rel.reviewee.department,
        rel.reviewee.position,
        rel.reviewee.grade,
        rel.reviewer.employeeNo,
        rel.reviewer.name,
        RELATION_LABELS[rel.relationType],
      ]),
  };

  const workbook = new ExcelJS.Workbook();
  for (const spec of [sheet1, sheet2, sheet3, sheet4, sheet5, sheet6]) {
    addSheet(workbook, spec);
  }

  // 导出审计（技术文档第 25 节：仅关键操作）
  await writeAudit({
    actorUserId: user.id,
    projectId,
    action: "EXPORT_RESULTS",
    entityType: "Project",
    entityId: projectId,
    metadata: {
      filename: RESULTS_EXCEL_FILENAME,
      sheets: 6,
      revieweeCount: snapshots.length,
    },
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
