import type Decimal from "decimal.js";

/**
 * 评分引擎类型定义（技术文档第 27~34 节 / PRD 第 31~35 节）。
 *
 * 纯函数模块：输入为数据层查询后映射的扁平结构，不依赖 Prisma 生成客户端，
 * 字符串字面量与 Prisma 枚举保持一致（RelationType / TaskStatus）。
 * 所有分数与权重运算均使用 decimal.js，中间计算永不舍入（铁律 8）。
 */

/** 评价关系类型（与 Prisma RelationType 枚举一致） */
export type ScoringRelation = "SELF" | "MANAGER" | "PEER" | "SUBORDINATE";

/** 评价任务状态（与 Prisma TaskStatus 枚举一致，完成率计算用） */
export type ScoringTaskStatus =
  "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "RETURNED";

/** 维度（扁平输入，parentId 为空 = 一级维度；weight 为百分数如 40） */
export interface ScoringDimension {
  id: string;
  parentId: string | null;
  weight: Decimal.Value;
  /** 关系适用规则（PRD 第 11 节）：维度级默认 */
  applicableSelf: boolean;
  applicableManager: boolean;
  applicablePeer: boolean;
  applicableSubordinate: boolean;
}

/** 题目（仅 RATING 题参与计分：weight 非空；TEXT 题 weight=null 会被引擎忽略） */
export interface ScoringQuestion {
  id: string;
  dimensionId: string;
  weight: Decimal.Value | null;
  /** 题目级 override：false 时继承所属维度规则 */
  overrideRelationRules: boolean;
  applicableSelf: boolean;
  applicableManager: boolean;
  applicablePeer: boolean;
  applicableSubordinate: boolean;
}

/**
 * 一条有效提交（一个评价人对一个被评人的当前有效版本）。
 * 数据层负责筛选：Submission.invalidatedAt 为空（退回重评后旧版本不传入，技术文档第 20 节）。
 */
export interface ScoringSubmission {
  relationType: ScoringRelation;
  /** RATING 题分数：questionId -> 0.5~5.0 */
  scores: Record<string, Decimal.Value>;
}

/** 项目关系权重配置（百分数，合计 100；HR 项目级配置，PRD 第 33 节） */
export interface ScoringRelationWeights {
  manager: Decimal.Value;
  peer: Decimal.Value;
  subordinate: Decimal.Value;
}

/** 评分引擎输入（针对一个被评人） */
export interface ScoringInput {
  dimensions: ScoringDimension[];
  questions: ScoringQuestion[];
  submissions: ScoringSubmission[];
  weights: ScoringRelationWeights;
}

/** 题目得分明细（某关系视角） */
export interface QuestionScoreDetail {
  questionId: string;
  /** 各评价人原始评分（与提交顺序一致） */
  scores: Decimal[];
  /** 题目平均分；可见但无有效评分时为 null */
  average: Decimal | null;
  /** 归一化题目权重（同维度内「可见且有分」题目中归一化）；不参与计分时为 null */
  normalizedWeight: Decimal | null;
}

/** 维度得分明细（一级或二级维度通用结构） */
export interface DimensionScoreDetail {
  dimensionId: string;
  /** 维度得分；可见但无有效数据时为 null */
  score: Decimal | null;
  /** 归一化维度权重（同级有效维度中归一化）；不参与计分时为 null */
  normalizedWeight: Decimal | null;
  /** 直挂题目明细（两级问卷的一级维度） */
  questions: QuestionScoreDetail[];
  /** 二级维度明细（三级问卷的一级维度） */
  children: DimensionScoreDetail[];
}

/** 单个关系的得分明细 */
export interface RelationScoreDetail {
  relation: ScoringRelation;
  /** 关系综合得分（各一级维度得分 × 归一化维度权重）；无有效提交时为 null */
  score: Decimal | null;
  /**
   * 有效关系权重 = 配置权重 / 有效关系配置权重和（PRD 第 34 节归一化）。
   * 无效关系（缺关系 / 0 提交）与 SELF 恒为 null——SELF 不参与 360 总分（铁律 7）。
   */
  effectiveWeight: Decimal | null;
  /** 该关系的有效提交数（评价人数） */
  submissionCount: number;
  /** 一级维度明细（按问卷 order） */
  dimensions: DimensionScoreDetail[];
}

/** 评分结果（一个被评人） */
export interface ScoringResult {
  /** 360 总分：仅 MANAGER/PEER/SUBORDINATE 有效关系加权；无任何有效关系时为 null */
  total360: Decimal | null;
  /** 自评综合得分（不参与 total360，供自评 vs 他评差异分析）；未自评时为 null */
  selfScore: Decimal | null;
  /** 各关系明细（固定顺序 SELF / MANAGER / PEER / SUBORDINATE） */
  relations: RelationScoreDetail[];
}

/** 完成率输入：被评人全部 active 关系对应的任务 */
export interface CompletionTask {
  relationType: ScoringRelation;
  status: ScoringTaskStatus;
}

/** 单项完成率 */
export interface CompletionRate {
  /** 应评价任务数 */
  expected: number;
  /** 已提交任务数（status = SUBMITTED） */
  submitted: number;
  /** submitted / expected，Decimal 完整精度；expected = 0 时为 null */
  rate: Decimal | null;
}

/** 完成率结果（技术文档第 34 节：总 / 上级 / 平级 / 下级 / 自评） */
export interface CompletionResult {
  total: CompletionRate;
  manager: CompletionRate;
  peer: CompletionRate;
  subordinate: CompletionRate;
  /** 自评额外给出完成状态（布尔） */
  self: CompletionRate & { done: boolean };
}
