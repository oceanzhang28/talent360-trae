import { LoginForm } from "./login-form";

export const metadata = {
  title: "登录 · Talent 360",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // 飞书回调失败时通过 ?error= 展示原因（服务端读取，避免 effect 中 setState）
  const { error } = await searchParams;
  // 开发模式用 mock 登录；生产走飞书 OAuth（技术文档第 64 节）
  const authMode = process.env.AUTH_MODE === "feishu" ? "feishu" : "mock";
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">Talent 360</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          企业内部 360 测评平台
        </p>
      </div>
      <LoginForm authMode={authMode} initialError={error ?? null} />
    </main>
  );
}
