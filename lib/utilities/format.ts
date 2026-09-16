/**
 * 展示层分数格式化：固定 2 位小数（页面 / Excel / PDF）。
 * 注意：评分引擎内部计算禁止调用此函数，必须保留完整精度（AGENTS.md 铁律 8）。
 */
export function formatScore(value: number): string {
  return value.toFixed(2);
}
