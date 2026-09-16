import type { QuestionnaireDTO } from "@/modules/questionnaires/service";
import type {
  QuestionnaireData,
  RelationFlags,
} from "@/modules/questionnaires/validate";

/**
 * 在线问卷编辑器的本地状态模型（PRD 第 12.1 节）。
 *
 * 从组件中抽出的纯逻辑：初始状态构建、入参转换、编号生成、拖拽排序解析。
 * 抽出的目的：拖拽/排序这类逻辑必须能用确定性单测覆盖（见 tests/unit/questionnaire-editor-model.test.ts），
 * 而浏览器里的真实拖拽行为受时序影响较大，不适合作为唯一保障。
 */

export type Rel = RelationFlags;

export type Dim = {
  key: string;
  parentKey: string | null;
  name: string;
  description: string;
  /** 输入框用字符串，保存时转数字 */
  weight: string;
  rel: Rel;
};

export type Q = {
  key: string;
  dimensionKey: string;
  code: string;
  type: "RATING" | "TEXT";
  title: string;
  description: string;
  weight: string;
  required: boolean;
  override: boolean;
  rel: Rel;
};

export type EditorState = { dims: Dim[]; questions: Q[] };

export const ALL_TRUE: Rel = {
  self: true,
  manager: true,
  peer: true,
  subordinate: true,
};

export const REL_FLAGS: Array<{
  key: keyof Rel;
  short: string;
  label: string;
}> = [
  { key: "self", short: "自", label: "自评" },
  { key: "manager", short: "上", label: "上级" },
  { key: "peer", short: "平", label: "平级" },
  { key: "subordinate", short: "下", label: "下级" },
];

let keySeq = 0;
export const nextKey = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${keySeq++}`;

export function numOrZero(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/** 生成问卷内不重复的题目编号：Q1 → Q1-副本 → Q1-副本2 → … */
export function uniqueCode(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  if (!used.has(`${base}-副本`)) return `${base}-副本`;
  let n = 2;
  while (used.has(`${base}-副本${n}`)) n += 1;
  return `${base}-副本${n}`;
}

/** 新增题目的默认编号：最小可用的 Qn */
export function nextQuestionCode(used: Set<string>): string {
  let n = 1;
  while (used.has(`Q${n}`)) n += 1;
  return `Q${n}`;
}

export function toEditorState(dto: QuestionnaireDTO | null): EditorState {
  if (!dto) return { dims: [], questions: [] };
  const dims: Dim[] = [];
  const questions: Q[] = [];
  const walk = (
    node: QuestionnaireDTO["dimensions"][number],
    parentKey: string | null,
  ) => {
    const key = nextKey("d");
    dims.push({
      key,
      parentKey,
      name: node.name,
      description: node.description ?? "",
      weight: String(node.weight),
      rel: {
        self: node.applicableSelf,
        manager: node.applicableManager,
        peer: node.applicablePeer,
        subordinate: node.applicableSubordinate,
      },
    });
    for (const q of node.questions) {
      questions.push({
        key: nextKey("q"),
        dimensionKey: key,
        code: q.code,
        type: q.type,
        title: q.title,
        description: q.description ?? "",
        weight: q.weight === null ? "" : String(q.weight),
        required: q.required,
        override: q.overrideRelationRules,
        rel: {
          self: q.applicableSelf,
          manager: q.applicableManager,
          peer: q.applicablePeer,
          subordinate: q.applicableSubordinate,
        },
      });
    }
    for (const child of node.children) walk(child, key);
  };
  for (const top of dto.dimensions) walk(top, null);
  return { dims, questions };
}

/** 本地状态 → 服务端入参（order 直接取数组下标，保证同级有序） */
export function toPayload(state: EditorState): QuestionnaireData {
  return {
    dimensions: state.dims.map((d, index) => ({
      key: d.key,
      parentKey: d.parentKey,
      name: d.name.trim(),
      description: d.description.trim() === "" ? null : d.description.trim(),
      weight: numOrZero(d.weight),
      order: index,
      applicable: d.rel,
    })),
    questions: state.dims.flatMap((dim) =>
      state.questions
        .filter((q) => q.dimensionKey === dim.key)
        .map((q, index) => ({
          dimensionKey: dim.key,
          code: q.code.trim(),
          type: q.type,
          title: q.title.trim(),
          description:
            q.description.trim() === "" ? null : q.description.trim(),
          weight: q.type === "TEXT" ? null : numOrZero(q.weight),
          required: q.type === "TEXT" ? q.required : true,
          order: index,
          overrideRelationRules: q.override,
          applicable: q.override ? q.rel : ALL_TRUE,
        })),
    ),
  };
}

export function questionsOf(state: EditorState, dimensionKey: string): Q[] {
  return state.questions.filter((q) => q.dimensionKey === dimensionKey);
}

export function childrenOf(state: EditorState, parentKey: string): Dim[] {
  return state.dims.filter((d) => d.parentKey === parentKey);
}

/**
 * 维度拖拽排序：仅允许在同一父级（同级）之间移动，返回新状态；无变化返回 null。
 */
export function reorderDimensions(
  state: EditorState,
  activeKey: string,
  overKey: string,
): EditorState | null {
  if (activeKey === overKey) return null;
  const active = state.dims.find((d) => d.key === activeKey);
  const over = state.dims.find((d) => d.key === overKey);
  if (!active || !over || active.parentKey !== over.parentKey) return null;

  const dims = [...state.dims];
  const from = dims.findIndex((d) => d.key === activeKey);
  const to = dims.findIndex((d) => d.key === overKey);
  dims.splice(from, 1);
  dims.splice(to, 0, active);
  return { ...state, dims };
}

export type QuestionDropTarget =
  { type: "question"; key: string } | { type: "zone"; dimensionKey: string };

/**
 * 题目拖拽：同维度内排序，或跨维度移动（含拖到空维度）。
 * 以「插入到目标题之前」为语义，按 key 定位插入点，避免移除后再按下标插入的偏移错误。
 */
export function moveQuestionByDrag(
  state: EditorState,
  activeKey: string,
  target: QuestionDropTarget,
): EditorState | null {
  const active = state.questions.find((q) => q.key === activeKey);
  if (!active) return null;

  let targetDimensionKey: string;
  let anchorKey: string | null = null;

  if (target.type === "question") {
    const overQuestion = state.questions.find((q) => q.key === target.key);
    if (!overQuestion || overQuestion.key === activeKey) return null;
    targetDimensionKey = overQuestion.dimensionKey;
    anchorKey = overQuestion.key;
  } else {
    targetDimensionKey = target.dimensionKey;
  }

  const targetExists = state.dims.some((d) => d.key === targetDimensionKey);
  if (!targetExists) return null;

  const rest = state.questions.filter((q) => q.key !== activeKey);
  const moved: Q = { ...active, dimensionKey: targetDimensionKey };

  let index: number;
  if (anchorKey !== null) {
    // 插入到目标题之前
    const found = rest.findIndex((q) => q.key === anchorKey);
    index = found === -1 ? rest.length : found;
  } else {
    // 拖到维度区域：追加到该维度末尾（空维度即追加到数组末尾）
    const lastIndex = rest.reduce(
      (acc, q, i) => (q.dimensionKey === targetDimensionKey ? i : acc),
      -1,
    );
    index = lastIndex === -1 ? rest.length : lastIndex + 1;
  }

  const questions = [...rest];
  questions.splice(index, 0, moved);

  // 顺序与归属都没变则视为无操作（避免多余的保存与历史记录）
  // 注意：必须同时比较归属维度，否则「拖到维度区域但顺序恰好不变」的跨维度移动会被漏掉
  const unchanged =
    questions.length === state.questions.length &&
    questions.every((q, i) => {
      const before = state.questions[i]!;
      return q.key === before.key && q.dimensionKey === before.dimensionKey;
    });
  if (unchanged) return null;

  return { ...state, questions };
}
