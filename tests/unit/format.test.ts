import { describe, expect, it } from "vitest";
import { formatScore } from "@/lib/utilities/format";

describe("formatScore", () => {
  it("整数补齐 2 位小数", () => {
    expect(formatScore(4)).toBe("4.00");
    expect(formatScore(5)).toBe("5.00");
  });

  it("四舍五入到 2 位小数", () => {
    expect(formatScore(3.856)).toBe("3.86");
    // 4.005 的二进制浮点表示为 4.004999...，toFixed 结果为 "4.01" 不可依赖；
    // 评分引擎使用 Decimal 计算后转 number，正常场景不受影响
    expect(formatScore(3.995)).toBe("4.00");
  });

  it("保留 1 位小数时补齐", () => {
    expect(formatScore(0.5)).toBe("0.50");
    expect(formatScore(3.5)).toBe("3.50");
  });
});
