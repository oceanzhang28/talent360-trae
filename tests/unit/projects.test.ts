import { describe, expect, it } from "vitest";
import { weightsSumTo100 } from "@/modules/projects/service";
import { STATUS_LABEL, toLocalInputValue } from "@/modules/projects/status";

describe("weightsSumTo100（权重合计校验，百分之一取整避免浮点误差）", () => {
  it("默认权重 40/30/30 合计为 100", () => {
    expect(weightsSumTo100(40, 30, 30)).toBe(true);
  });

  it("小数权重按百分之一取整判等", () => {
    // 设计意图：以 1% 为最小单位取整求和，避免 0.1+0.2 类浮点误差误判
    expect(weightsSumTo100(33.3, 33.3, 33.4)).toBe(true);
    expect(weightsSumTo100(39.9, 30, 30.1)).toBe(true);
  });

  it("单项为 0 也允许（如无下级评价的项目）", () => {
    expect(weightsSumTo100(0, 100, 0)).toBe(true);
    expect(weightsSumTo100(50, 50, 0)).toBe(true);
  });

  it("合计不为 100 时拒绝（以 1% 为最小单位）", () => {
    expect(weightsSumTo100(50, 30, 30)).toBe(false);
    expect(weightsSumTo100(33.3, 33.3, 33.3)).toBe(false);
    expect(weightsSumTo100(40, 30, 30.5)).toBe(false);
  });
});

describe("状态与时间展示工具", () => {
  it("七个状态都有中文标签", () => {
    expect(STATUS_LABEL.DRAFT).toBe("草稿");
    expect(STATUS_LABEL.PUBLISHED).toBe("已发布");
    expect(STATUS_LABEL.ACTIVE).toBe("测评中");
    expect(STATUS_LABEL.CLOSED).toBe("已截止");
    expect(STATUS_LABEL.FROZEN).toBe("已冻结");
    expect(STATUS_LABEL.ARCHIVED).toBe("已归档");
    expect(STATUS_LABEL.DELETED).toBe("已删除");
  });

  it("toLocalInputValue 生成 datetime-local 格式", () => {
    const iso = "2026-01-02T03:04:00.000Z"; // 时区相关，仅验证格式
    const value = toLocalInputValue(iso);
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(toLocalInputValue(null)).toBe("");
  });
});
