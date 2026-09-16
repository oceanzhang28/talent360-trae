import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { formatScore, formatRate } from "@/modules/scoring/format";

/**
 * 展示层格式化（PRD 第 35 节）：页面 / Excel / PDF 固定 2 位小数。
 * 独立于引擎：只做展示转换，不影响引擎计算精度（铁律 8）。
 */

describe("formatScore", () => {
  it("Decimal 值固定 2 位小数", () => {
    expect(formatScore(new Decimal(4))).toBe("4.00");
    expect(formatScore(new Decimal("3.5"))).toBe("3.50");
    expect(formatScore(new Decimal("4.005"))).toBe("4.01");
    expect(formatScore(new Decimal("3.995"))).toBe("4.00");
  });

  it("除不尽的引擎结果：26/7 → 3.71", () => {
    expect(formatScore(new Decimal(26).div(7))).toBe("3.71");
  });

  it("接受 number 输入（兼容既有展示代码）", () => {
    expect(formatScore(4)).toBe("4.00");
    expect(formatScore(3.856)).toBe("3.86");
  });

  it("无得分显示占位符", () => {
    expect(formatScore(null)).toBe("—");
    expect(formatScore(undefined)).toBe("—");
  });
});

describe("formatRate", () => {
  it("完成率转百分比 2 位小数", () => {
    expect(formatRate(new Decimal(0.4))).toBe("40.00%");
    expect(formatRate(new Decimal(1))).toBe("100.00%");
    expect(formatRate(new Decimal(0))).toBe("0.00%");
    expect(formatRate(new Decimal(1).div(3))).toBe("33.33%");
  });

  it("无任务（rate=null）显示占位符", () => {
    expect(formatRate(null)).toBe("—");
  });
});
