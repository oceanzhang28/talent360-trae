/**
 * API 统一错误类型：携带 HTTP 状态码，由 withApi 包装层转换为响应。
 * 业务模块 / 权限中间件抛出，禁止在页面组件中直接 new Response。
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
