import { prisma } from "@/lib/db/prisma";
import {
  validateQuestionnaire,
  type QuestionnaireData,
  type ValidationError,
} from "./validate";

/**
 * 项目问卷的库内校验（与 Excel 导入共用同一套规则，见 validate.ts）。
 *
 * 为什么单独一个模块：`projects/service.ts`（发布前校验）与
 * `questionnaires/service.ts`（编辑保存）都需要它，而后者已经依赖前者
 * （syncStatus），放在 service 里会形成循环依赖。
 */

/**
 * 读取库内问卷并转成校验用的扁平中间表示。
 * key 直接用数据库 id（同一项目内唯一），parentKey/dimensionKey 用对应 id 引用。
 */
export async function loadQuestionnaireData(
  projectId: string,
): Promise<QuestionnaireData | null> {
  const questionnaire = await prisma.questionnaire.findUnique({
    where: { projectId },
    select: { id: true },
  });
  if (!questionnaire) return null;

  const [dimensions, questions] = await Promise.all([
    prisma.dimension.findMany({
      where: { questionnaireId: questionnaire.id },
      orderBy: { order: "asc" },
    }),
    prisma.question.findMany({
      where: { dimension: { questionnaireId: questionnaire.id } },
      orderBy: { order: "asc" },
    }),
  ]);

  return {
    dimensions: dimensions.map((d) => ({
      key: d.id,
      parentKey: d.parentId,
      name: d.name,
      description: d.description,
      weight: d.weight.toNumber(),
      order: d.order,
      applicable: {
        self: d.applicableSelf,
        manager: d.applicableManager,
        peer: d.applicablePeer,
        subordinate: d.applicableSubordinate,
      },
    })),
    questions: questions.map((q) => ({
      dimensionKey: q.dimensionId,
      code: q.code,
      type: q.type,
      title: q.title,
      description: q.description,
      weight: q.weight === null ? null : q.weight.toNumber(),
      required: q.required,
      order: q.order,
      overrideRelationRules: q.overrideRelationRules,
      applicable: {
        self: q.applicableSelf,
        manager: q.applicableManager,
        peer: q.applicablePeer,
        subordinate: q.applicableSubordinate,
      },
    })),
  };
}

/**
 * 校验项目问卷是否完整（PRD 第 14 节：发布前必须通过问卷完整性校验）。
 * 问卷不存在时返回一条错误，交由调用方决定提示文案。
 */
export async function validateProjectQuestionnaire(
  projectId: string,
): Promise<ValidationError[]> {
  const data = await loadQuestionnaireData(projectId);
  if (!data) {
    return [{ path: "问卷", message: "项目还没有问卷" }];
  }
  return validateQuestionnaire(data);
}
