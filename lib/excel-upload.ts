import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/permissions";

/** 从 multipart 请求中提取上传的 .xlsx 文件内容（问卷 / 关系导入共用） */
export async function readExcelUpload(req: NextRequest): Promise<Buffer> {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    throw new ApiError(400, "请上传 Excel 文件（multipart 字段名 file）");
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new ApiError(400, "只支持 .xlsx 文件");
  }
  return Buffer.from(await file.arrayBuffer());
}
