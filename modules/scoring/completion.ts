import Decimal from "decimal.js";
import type { CompletionRate, CompletionResult, CompletionTask } from "./types";

/**
 * 完成率计算（技术文档第 34 节 / PRD 第 34 节）：
 * 有效提交任务数 / 应评价任务数，按总 / 上级 / 平级 / 下级 / 自评分别统计。
 * rate 保留 Decimal 完整精度，展示层再格式化（铁律 8）。
 */

function rateOf(tasks: CompletionTask[]): CompletionRate {
  const expected = tasks.length;
  const submitted = tasks.filter((t) => t.status === "SUBMITTED").length;
  return {
    expected,
    submitted,
    rate: expected === 0 ? null : new Decimal(submitted).div(expected),
  };
}

export function computeCompletion(tasks: CompletionTask[]): CompletionResult {
  const of = (relation: CompletionTask["relationType"]) =>
    tasks.filter((t) => t.relationType === relation);
  const self = rateOf(of("SELF"));
  return {
    total: rateOf(tasks),
    manager: rateOf(of("MANAGER")),
    peer: rateOf(of("PEER")),
    subordinate: rateOf(of("SUBORDINATE")),
    self: { ...self, done: self.submitted > 0 },
  };
}
