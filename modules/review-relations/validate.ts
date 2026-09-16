/**
 * 评价关系解析后的校验纯函数（PRD 第 16.1、17、18 节 / 技术文档第 48 节）。
 *
 * - 关系始终从被评人视角定义（李四评价张三 = 上级）
 * - 同一评价人 + 被评人在同一项目只能有一种关系（冲突）
 * - 完全相同的行视为重复
 * - Preview 阶段不写库：只输出 total/valid/errors/duplicates/conflicts + 明细
 */

export type ImportedRelationType = "MANAGER" | "PEER" | "SUBORDINATE";

export const RELATION_TYPE_LABELS: Record<ImportedRelationType, string> = {
  MANAGER: "上级",
  PEER: "平级",
  SUBORDINATE: "下级",
};

/** Excel 解析出的原始行（未校验） */
export type ParsedRelationRow = {
  /** Excel 行号（从 1 开始，含表头） */
  row: number;
  revieweeEmployeeNo: string;
  revieweeName: string;
  revieweeDepartment: string;
  revieweePosition: string;
  revieweeGrade: string;
  reviewerEmployeeNo: string;
  reviewerName: string;
  /** 原始关系文本，如"上级" */
  relationLabel: string;
};

export type ValidRelationRow = {
  row: number;
  revieweeEmployeeNo: string;
  revieweeName: string;
  reviewerEmployeeNo: string;
  reviewerName: string;
  relationType: ImportedRelationType;
};

export type PreviewIssueType = "error" | "duplicate" | "conflict";

export type PreviewIssue = {
  row: number;
  type: PreviewIssueType;
  message: string;
};

/** Commit 阶段写入 ProjectPerson 的人员信息（评价人仅有工号姓名，其余可空） */
export type PersonInput = {
  employeeNo: string;
  name: string;
  department: string | null;
  position: string | null;
  grade: string | null;
};

export type RelationsCheckResult = {
  total: number;
  valid: number;
  errors: number;
  duplicates: number;
  conflicts: number;
  issues: PreviewIssue[];
  relations: ValidRelationRow[];
  people: PersonInput[];
};

/** 解析关系文本：上级/平级/下级 → 枚举；其余返回 null */
export function parseRelationType(label: string): ImportedRelationType | null {
  const normalized = label.trim();
  if (normalized === "上级") return "MANAGER";
  if (normalized === "平级") return "PEER";
  if (normalized === "下级") return "SUBORDINATE";
  return null;
}

function labelOf(type: ImportedRelationType): string {
  return RELATION_TYPE_LABELS[type];
}

/**
 * 校验全部行并汇总（PRD 第 18 节预检查）。
 * 分类互斥：error（字段/格式问题）→ duplicate（与已见完全相同）→ conflict（同 pair 不同类型）。
 */
export function checkRelations(
  rows: ParsedRelationRow[],
): RelationsCheckResult {
  const issues: PreviewIssue[] = [];
  const relations: ValidRelationRow[] = [];
  const nameByNo = new Map<string, string>();
  const pairTypes = new Map<string, ImportedRelationType>();
  const exactSeen = new Set<string>();
  const peopleMap = new Map<string, PersonInput>();

  /** 记录工号→姓名；同工号不同姓名报冲突错误（PRD 18：工号姓名冲突） */
  function checkNameConflict(employeeNo: string, name: string, role: string) {
    const known = nameByNo.get(employeeNo);
    if (known !== undefined && known !== name) {
      issues.push({
        row: rowCounter,
        type: "error",
        message: `工号姓名冲突：工号 ${employeeNo} 已登记为「${known}」，本行${role}姓名为「${name}」`,
      });
      return false;
    }
    nameByNo.set(employeeNo, name);
    return true;
  }

  /** 人员汇总：只补空不覆盖（评价人后作为被评人时补全部门等信息） */
  function upsertPerson(person: PersonInput) {
    const existing = peopleMap.get(person.employeeNo);
    if (!existing) {
      peopleMap.set(person.employeeNo, person);
      return;
    }
    existing.name = person.name;
    existing.department = existing.department ?? person.department;
    existing.position = existing.position ?? person.position;
    existing.grade = existing.grade ?? person.grade;
  }

  let rowCounter = 0;

  for (const r of rows) {
    rowCounter = r.row;

    // 1. 字段级错误（工号/姓名为空 → PRD 18；被评人部门/岗位/职级必填 → PRD 16.1）
    const fieldErrors: string[] = [];
    if (!r.revieweeEmployeeNo.trim()) fieldErrors.push("被评人工号为空");
    if (!r.revieweeName.trim()) fieldErrors.push("被评人姓名为空");
    if (!r.revieweeDepartment.trim()) fieldErrors.push("被评人部门为空");
    if (!r.revieweePosition.trim()) fieldErrors.push("被评人岗位为空");
    if (!r.revieweeGrade.trim()) fieldErrors.push("被评人职级为空");
    if (!r.reviewerEmployeeNo.trim()) fieldErrors.push("评价人工号为空");
    if (!r.reviewerName.trim()) fieldErrors.push("评价人姓名为空");
    if (fieldErrors.length > 0) {
      issues.push({
        row: r.row,
        type: "error",
        message: fieldErrors.join("；"),
      });
      continue;
    }

    // 2. 非法关系类型
    const relationType = parseRelationType(r.relationLabel);
    if (!relationType) {
      issues.push({
        row: r.row,
        type: "error",
        message: `非法关系类型「${r.relationLabel}」，应为：上级 / 平级 / 下级`,
      });
      continue;
    }

    const revieweeNo = r.revieweeEmployeeNo.trim();
    const reviewerNo = r.reviewerEmployeeNo.trim();
    const revieweeName = r.revieweeName.trim();
    const reviewerName = r.reviewerName.trim();

    // 3. 工号姓名冲突（被评人、评价人两个方向）
    const revieweeOk = checkNameConflict(revieweeNo, revieweeName, "被评人");
    const reviewerOk = checkNameConflict(reviewerNo, reviewerName, "评价人");
    if (!revieweeOk || !reviewerOk) continue;

    // 4. 重复关系（同 pair + 同类型，与已见行完全相同）
    const pairKey = `${revieweeNo}|${reviewerNo}`;
    const exactKey = `${pairKey}|${relationType}`;
    if (exactSeen.has(exactKey)) {
      issues.push({
        row: r.row,
        type: "duplicate",
        message: `重复关系：评价人 ${reviewerName}（${reviewerNo}）对被评人 ${revieweeName}（${revieweeNo}）的${labelOf(relationType)}关系已出现过`,
      });
      continue;
    }

    // 5. 一个评价人对同一被评人存在两种关系（PRD 17）
    const existingType = pairTypes.get(pairKey);
    if (existingType !== undefined && existingType !== relationType) {
      issues.push({
        row: r.row,
        type: "conflict",
        message: `同一评价人对同一被评人存在两种关系：${labelOf(existingType)} 与 ${labelOf(relationType)}（评价人 ${reviewerName} / 被评人 ${revieweeName}）`,
      });
      continue;
    }

    // 有效行
    exactSeen.add(exactKey);
    pairTypes.set(pairKey, relationType);
    relations.push({
      row: r.row,
      revieweeEmployeeNo: revieweeNo,
      revieweeName,
      reviewerEmployeeNo: reviewerNo,
      reviewerName,
      relationType,
    });

    // 人员汇总：被评人带完整信息；评价人仅工号姓名
    upsertPerson({
      employeeNo: revieweeNo,
      name: revieweeName,
      department: r.revieweeDepartment.trim() || null,
      position: r.revieweePosition.trim() || null,
      grade: r.revieweeGrade.trim() || null,
    });
    upsertPerson({
      employeeNo: reviewerNo,
      name: reviewerName,
      department: null,
      position: null,
      grade: null,
    });
  }

  const count = (type: PreviewIssueType) =>
    issues.filter((i) => i.type === type).length;

  return {
    total: rows.length,
    valid: relations.length,
    errors: count("error"),
    duplicates: count("duplicate"),
    conflicts: count("conflict"),
    issues,
    relations,
    people: Array.from(peopleMap.values()),
  };
}
