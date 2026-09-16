import { lifecycleRoute } from "@/modules/projects/lifecycle-route";
import { freezeProject } from "@/modules/projects/service";

/** 冻结结果（CLOSED → FROZEN；评分快照 Sprint 8 补充） */
export const POST = lifecycleRoute(freezeProject);
