import type { NextRequest } from "next/server";
import { ApiError, requireLogin, withApi } from "@/lib/permissions";
import { updateScaleLabels } from "@/modules/projects/service";

/** 批量更新评分档位文字说明（value 固定，只能改 label） */
export const PATCH = withApi<{ params: Promise<{ id: string }> }>(
  async (req: NextRequest, { params }) => {
    const user = await requireLogin();
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as {
      items?: unknown;
    } | null;
    if (!body || !Array.isArray(body.items)) {
      throw new ApiError(400, "参数错误：items 必须为数组");
    }
    return Response.json({
      scales: await updateScaleLabels(id, user, body.items),
    });
  },
);
