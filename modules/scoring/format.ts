import Decimal from "decimal.js";

/**
 * 评分结果展示层格式化（PRD 第 35 节）：页面 / Excel / PDF 固定 2 位小数。
 * 仅做展示转换，禁止在评分引擎计算链中调用（AGENTS.md 铁律 8：中间计算不舍入）。
 */

const PLACEHOLDER = "—";

/** 分数：2 位小数；无得分（null/undefined）显示占位符 */
export function formatScore(
  value: Decimal | number | null | undefined,
): string {
  if (value === null || value === undefined) return PLACEHOLDER;
  return new Decimal(value).toFixed(2);
}

/** 完成率：转百分比并保留 2 位小数；无任务（rate=null）显示占位符 */
export function formatRate(rate: Decimal | null): string {
  if (rate === null) return PLACEHOLDER;
  return `${rate.times(100).toFixed(2)}%`;
}
