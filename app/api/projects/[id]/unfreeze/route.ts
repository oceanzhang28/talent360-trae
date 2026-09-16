import { lifecycleRoute } from "@/modules/projects/lifecycle-route";
import { unfreezeProject } from "@/modules/projects/service";

/** 解冻（FROZEN → CLOSED）：仅系统管理员 */
export const POST = lifecycleRoute(unfreezeProject);
