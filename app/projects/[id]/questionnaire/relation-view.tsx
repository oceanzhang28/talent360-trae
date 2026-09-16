"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type {
  DimensionDTO,
  QuestionDTO,
  QuestionnaireDTO,
} from "@/modules/questionnaires/service";

/** 关系视角（PRD 第 11 节）：维度级 applicable + 题目级 override */
const RELATIONS = [
  { key: "self", label: "自评视角" },
  { key: "manager", label: "上级视角" },
  { key: "peer", label: "平级视角" },
  { key: "subordinate", label: "下级视角" },
] as const;

type RelationKey = (typeof RELATIONS)[number]["key"];

const APPLICABLE_FIELDS: Record<
  RelationKey,
  keyof Pick<
    QuestionDTO,
    | "applicableSelf"
    | "applicableManager"
    | "applicablePeer"
    | "applicableSubordinate"
  >
> = {
  self: "applicableSelf",
  manager: "applicableManager",
  peer: "applicablePeer",
  subordinate: "applicableSubordinate",
};

function dimensionVisible(dim: DimensionDTO, relation: RelationKey): boolean {
  return dim[APPLICABLE_FIELDS[relation]];
}

function questionVisible(
  question: QuestionDTO,
  relation: RelationKey,
): boolean {
  // 未覆盖时继承维度规则（维度已在上层过滤）；覆盖后按题目自身规则
  return question.overrideRelationRules
    ? question[APPLICABLE_FIELDS[relation]]
    : true;
}

function QuestionRow({ question }: { question: QuestionDTO }) {
  return (
    <li className="flex items-start gap-2 py-1.5">
      <span className="text-muted-foreground shrink-0 pt-0.5 font-mono text-xs">
        {question.code}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm">{question.title}</p>
        {question.description && (
          <p className="text-muted-foreground text-xs">
            {question.description}
          </p>
        )}
        <p className="text-muted-foreground mt-0.5 text-xs">
          {question.type === "RATING"
            ? `量表 · 权重 ${question.weight}% · 必答`
            : `文本 · ${question.required ? "必答" : "选填"}`}
        </p>
      </div>
      <Badge variant="outline" className="shrink-0">
        {question.type === "RATING" ? "量表" : "文本"}
      </Badge>
    </li>
  );
}

function DimensionSection({
  dim,
  relation,
  nested,
}: {
  dim: DimensionDTO;
  relation: RelationKey;
  nested?: boolean;
}) {
  const questions = dim.questions.filter((q) => questionVisible(q, relation));
  const children = dim.children.filter((c) => dimensionVisible(c, relation));
  if (questions.length === 0 && children.length === 0) return null;

  return (
    <section className={nested ? "" : "rounded-md border p-4"}>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="font-semibold">{dim.name}</h3>
        <span className="text-muted-foreground text-xs">
          权重 {dim.weight}%
        </span>
      </div>
      {dim.description && (
        <p className="text-muted-foreground mb-2 text-sm">{dim.description}</p>
      )}
      {questions.length > 0 && (
        <ul className="divide-y">
          {questions.map((q) => (
            <QuestionRow key={q.code} question={q} />
          ))}
        </ul>
      )}
      {children.map((child) => (
        <div key={child.name} className="mt-3 border-t pt-3 first-of-type:mt-0">
          <DimensionSection dim={child} relation={relation} nested />
        </div>
      ))}
    </section>
  );
}

/** 按关系视角过滤的问卷预览 */
export function RelationView({
  questionnaire,
}: {
  questionnaire: QuestionnaireDTO;
}) {
  const [relation, setRelation] = useState<RelationKey>("self");
  const visible = questionnaire.dimensions.filter((d) =>
    dimensionVisible(d, relation),
  );

  return (
    <div className="space-y-4">
      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label="关系视角"
      >
        {RELATIONS.map((r) => (
          <button
            key={r.key}
            type="button"
            role="tab"
            aria-selected={relation === r.key}
            onClick={() => setRelation(r.key)}
            className={
              relation === r.key
                ? "bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm"
                : "bg-muted text-foreground hover:bg-muted/80 rounded-md px-3 py-1.5 text-sm"
            }
          >
            {r.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-muted-foreground rounded-md border p-4 text-sm">
          当前视角下没有适用的题目。
        </p>
      ) : (
        <div className="space-y-4">
          {visible.map((dim) => (
            <DimensionSection key={dim.name} dim={dim} relation={relation} />
          ))}
        </div>
      )}
    </div>
  );
}
