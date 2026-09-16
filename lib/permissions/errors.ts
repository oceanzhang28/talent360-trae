/**
 * API 统一错误类型：携带 HTTP 状态码，由 withApi 包装层转换为响应。
 * 业务模块 / 权限中间件抛出，禁止在页面组件中直接 new Response。
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** 可选结构化明细（如 Excel 导入的逐行错误报告），随响应 JSON 一起返回 */
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
