import { lifecycleRoute } from "@/modules/projects/lifecycle-route";
import { publishProject } from "@/modules/projects/service";

/** 发布项目（DRAFT → PUBLISHED/ACTIVE，含时间与权重校验） */
export const POST = lifecycleRoute(publishProject);
