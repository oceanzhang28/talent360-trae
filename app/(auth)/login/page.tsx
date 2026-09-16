import { AppShell } from "@/components/app-shell";
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
    <AppShell width="narrow">
      <div className="mx-auto w-full max-w-sm py-8 sm:py-14">
        <p className="text-primary text-sm font-medium tracking-widest">
          企业内部 · 360 度测评
        </p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">
          登录 Talent 360
        </h1>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          使用企业身份登录后查看测评任务，或管理你负责的测评项目。
        </p>
        <div className="mt-6">
          <LoginForm authMode={authMode} initialError={error ?? null} />
        </div>
      </div>
    </AppShell>
  );
}
