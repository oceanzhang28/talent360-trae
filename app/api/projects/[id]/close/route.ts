import { lifecycleRoute } from "@/modules/projects/lifecycle-route";
import { closeProject } from "@/modules/projects/service";

/** 提前结束（ACTIVE → CLOSED，截止时间改为当前时刻） */
export const POST = lifecycleRoute(closeProject);
