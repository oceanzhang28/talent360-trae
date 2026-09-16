/**
 * 真实测试 —— 批量评价提交（走真实 HTTP API）。
 * 用法：PROJECT_ID=... node scripts/submit-bulk.mjs
 * 环境变量：
 *   PROJECT_ID 必填
 *   SKIP       逗号分隔的评价人工号，全部跳过（留给浏览器走查），默认 30010,30009
 *   BATCH_NO   逗号分隔，只填草稿并走批量提交，默认 30011
 * 每个量表/文本题都填，得分确定性取值；TEXT1 必填，TEXT3 自评不适用。
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const PROJECT_ID = process.env.PROJECT_ID;
if (!PROJECT_ID) {
  console.error("需设置 PROJECT_ID");
  process.exit(1);
}
const SKIP = new Set(
  (process.env.SKIP ?? "30010,30009").split(",").filter(Boolean),
);
const BATCH = new Set(
  (process.env.BATCH_NO ?? "30011").split(",").filter(Boolean),
);

const RATING_CODES = null;
let reviewerIdx = 0;

let cookie = "";
async function api(path, { method = "GET", data } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (data !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json };
}

async function login(no, name) {
  const r = await api("/api/auth/mock/login", {
    method: "POST",
    data: { employeeNo: no, name },
  });
  if (!r.ok) throw new Error(`登录 ${no} 失败 ${r.status}`);
}

/** 读取该评价人在本项目下的全部任务 */
async function myProjectTasks() {
  const r = await api("/api/my/tasks");
  if (!r.ok) throw new Error(`/api/my/tasks ${r.status}`);
  const groups = r.json.groups ?? [];
  return groups.flatMap((g) =>
    (g.tasks ?? []).filter((t) => t.project.id === PROJECT_ID),
  );
}

/** 读取一个任务的问卷结构并组装答案 */
async function buildAnswers(taskId) {
  const r = await api(`/api/tasks/${taskId}`);
  if (!r.ok) throw new Error(`/detail ${taskId} ${r.status}`);
  const detail = r.json;
  const questions = (detail.dimensions ?? []).flatMap((d) => [
    ...(d.questions ?? []),
    ...(d.children ?? []).flatMap((c) => c.questions ?? []),
  ]);
  const answers = [];
  for (const q of questions) {
    if (q.type === "RATING") {
      const score = 3 + 0.5 * ((reviewerIdx + answers.length) % 4); // 3.0 / 3.5 / 4.0 / 4.5
      answers.push({ questionId: q.id, score });
    } else {
      const qid = q.code ?? "";
      let textValue;
      if (qid === "TEXT1")
        textValue = "值得肯定：交付质量高、响应及时、协作主动。";
      else if (qid === "TEXT2")
        textValue = "建议：进一步加强跨部门沟通与信息同步。";
      else textValue = "是，具备培养为更高层级管理者的潜力。";
      answers.push({ questionId: q.id, textValue });
    }
  }
  return answers;
}

async function fillAndSubmit(taskId) {
  const answers = await buildAnswers(taskId);
  const d = await api(`/api/tasks/${taskId}/draft`, {
    method: "PUT",
    data: { answers },
  });
  if (!d.ok)
    throw new Error(`draft ${taskId} ${d.status}: ${JSON.stringify(d.json)}`);
  const s = await api(`/api/tasks/${taskId}/submit`, { method: "POST" });
  if (!s.ok)
    throw new Error(`submit ${taskId} ${s.status}: ${JSON.stringify(s.json)}`);
  return s.json;
}

(async () => {
  // EXTRA：额外处理的自评/被评人（"工号:姓名,工号:姓名"）
  const EXTRA = new Map(
    (process.env.EXTRA ?? "")
      .split(",")
      .filter(Boolean)
      .map((s) => s.split(":")),
  );
  const namesByNo = (no) => {
    if (EXTRA.has(no)) return EXTRA.get(no);
    return `评价人${no.slice(-2)}`;
  };
  const allReviewers = Array.from({ length: 20 }, (_, i) => String(30001 + i))
    .concat([...EXTRA.keys()])
    .filter((no) => !SKIP.has(no) && !BATCH.has(no));
  const results = { ok: 0, failed: [] };
  for (const no of allReviewers) {
    reviewerIdx = Number(no.replace(/^300/, "0")) || 0;
    await login(no, namesByNo(no));
    const tasks = await myProjectTasks();
    for (const t of tasks) {
      try {
        await fillAndSubmit(t.taskId);
        results.ok++;
      } catch (e) {
        results.failed.push({
          no,
          reviewee: t.reviewee?.name,
          err: String(e.message ?? e),
        });
      }
    }
  }

  // 批量提交演示：BATCH 组只填草稿，不逐人提交
  for (const no of BATCH) {
    reviewerIdx = Number(no) - 30001;
    await login(no, `评价人${no.slice(-2)}`);
    const tasks = await myProjectTasks();
    const ids = [];
    for (const t of tasks) {
      await api(`/api/tasks/${t.taskId}/draft`, {
        method: "PUT",
        data: { answers: await buildAnswers(t.taskId) },
      });
      ids.push(t.taskId);
    }
    const b = await api("/api/tasks/batch-submit", {
      method: "POST",
      data: { taskIds: ids },
    });
    results.ok += (b.json?.submitted ?? []).length;
    if ((b.json?.skipped ?? []).length)
      results.failed.push({ no, batchSkipped: b.json.skipped });
  }

  console.log("批量提交结果:", JSON.stringify(results, null, 2));
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
