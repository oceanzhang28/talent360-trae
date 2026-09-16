import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { computeCompletion } from "@/modules/scoring/completion";
import type { CompletionTask } from "@/modules/scoring/types";

/** 完成率计算（技术文档第 34 节 / PRD 第 34 节） */

function task(
  relationType: CompletionTask["relationType"],
  status: CompletionTask["status"],
): CompletionTask {
  return { relationType, status };
}

describe("完成率计算", () => {
  it("分关系统计：总 / 上级 / 平级 / 下级 / 自评", () => {
    // 上级 1/1、平级 2 中 1、下级 0/1、自评 1/1 → 总 3/5
    const result = computeCompletion([
      task("MANAGER", "SUBMITTED"),
      task("PEER", "SUBMITTED"),
      task("PEER", "IN_PROGRESS"),
      task("SUBORDINATE", "NOT_STARTED"),
      task("SELF", "SUBMITTED"),
    ]);

    expect(result.total).toMatchObject({ expected: 5, submitted: 3 });
    expect(result.total.rate?.toNumber()).toBeCloseTo(0.6, 12);

    expect(result.manager).toMatchObject({ expected: 1, submitted: 1 });
    expect(result.manager.rate?.toNumber()).toBe(1);

    expect(result.peer).toMatchObject({ expected: 2, submitted: 1 });
    expect(result.peer.rate?.toNumber()).toBeCloseTo(0.5, 12);

    expect(result.subordinate).toMatchObject({ expected: 1, submitted: 0 });
    expect(result.subordinate.rate?.toNumber()).toBe(0);

    expect(result.self.done).toBe(true);
  });

  it("仅 SUBMITTED 计为完成：IN_PROGRESS / NOT_STARTED / RETURNED 均不计", () => {
    const result = computeCompletion([
      task("MANAGER", "IN_PROGRESS"),
      task("MANAGER", "NOT_STARTED"),
      task("PEER", "RETURNED"),
      task("SELF", "RETURNED"),
    ]);
    expect(result.total.submitted).toBe(0);
    expect(result.total.rate?.toNumber()).toBe(0);
    expect(result.self.done).toBe(false);
  });

  it("某关系无任务 → rate = null（不产生除零）", () => {
    const result = computeCompletion([
      task("MANAGER", "SUBMITTED"),
      task("SELF", "SUBMITTED"),
    ]);
    expect(result.subordinate.expected).toBe(0);
    expect(result.subordinate.rate).toBeNull();
    expect(result.peer.rate).toBeNull();
    // 总完成率仍按全部任务计算
    expect(result.total.expected).toBe(2);
    expect(result.total.rate?.toNumber()).toBe(1);
  });

  it("空任务列表 → 全部为空统计", () => {
    const result = computeCompletion([]);
    expect(result.total).toMatchObject({ expected: 0, submitted: 0 });
    expect(result.total.rate).toBeNull();
    expect(result.self.done).toBe(false);
  });

  it("rate 保留完整精度（中间不舍入）", () => {
    const result = computeCompletion([
      task("PEER", "SUBMITTED"),
      task("PEER", "NOT_STARTED"),
      task("PEER", "NOT_STARTED"),
    ]);
    // 1/3 = 0.333...，Decimal 20 位精度
    expect(result.peer.rate?.toFixed(18)).toBe(
      new Decimal(1).div(3).toFixed(18),
    );
  });
});
