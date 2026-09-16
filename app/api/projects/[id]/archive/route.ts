import { lifecycleRoute } from "@/modules/projects/lifecycle-route";
import { archiveProject } from "@/modules/projects/service";

/** 归档（FROZEN → ARCHIVED） */
export const POST = lifecycleRoute(archiveProject);
