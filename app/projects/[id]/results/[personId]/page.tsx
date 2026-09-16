import { Fragment } from "react";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ProjectNav } from "@/components/project-nav";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getCurrentUser } from "@/modules/auth/service";
import { ApiError } from "@/lib/permissions";
import {
  getResultDetail,
  listReviewerDetails,
  RELATION_LABELS,
  type ResultDimensionNodeDTO,
  type ResultRelationDTO,
} from "@/modules/results/service";

export const metadata = {
  title: "结果下钻 · Talent 360",
};

const score = (value: number | null) =>
  value === null ? "—" : value.toFixed(2);

const pct = (rate: number | null) =>
  rate === null ? "—" : `${(rate * 100).toFixed(2)}%`;

/** 维度/题目树行（一级 → 二级 → 题目，缩进展示） */
function DimensionRows({
  dimensions,
}: {
  dimensions: ResultDimensionNodeDTO[];
}) {
  return (
    <>
      {dimensions.map((dim) => (
        <Fragment key={dim.dimensionId}>
          <TableRow>
            <TableCell className="font-medium">{dim.name}</TableCell>
            <TableCell>{dim.weight.toFixed(0)}%</TableCell>
            <TableCell>{score(dim.score)}</TableCell>
          </TableRow>
          {dim.children.map((child) => (
            <TableRow key={child.dimensionId}>
              <TableCell className="text-muted-foreground pl-6">
                └ {child.name}
              </TableCell>
              <TableCell>{child.weight.toFixed(0)}%</TableCell>
              <TableCell>{score(child.score)}</TableCell>
            </TableRow>
          ))}
          {dim.questions.map((q) => (
            <TableRow key={q.questionId}>
              <TableCell className="text-muted-foreground pl-6 text-sm">
                └ {q.code} {q.title}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                题目
              </TableCell>
              <TableCell>{score(q.score)}</TableCell>
            </TableRow>
          ))}
          {dim.children.map((child) =>
            child.questions.map((q) => (
              <TableRow key={q.questionId}>
                <TableCell className="text-muted-foreground pl-10 text-sm">
                  └ {q.code} {q.title}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  题目
                </TableCell>
                <TableCell>{score(q.score)}</TableCell>
              </TableRow>
            )),
          )}
        </Fragment>
      ))}
    </>
  );
}

function RelationSection({ relation }: { relation: ResultRelationDTO }) {
  const hasData = relation.dimensions.length > 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {RELATION_LABELS[relation.relation]}得分
          <span className="text-lg">{score(relation.score)}</span>
          {relation.score === null && (
            <Badge variant="secondary">无有效评价</Badge>
          )}
        </CardTitle>
        <CardDescription>
          一级维度 → 二级维度 → 题目得分（权重为归一化前的问卷配置值）
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>维度 / 题目</TableHead>
                  <TableHead>权重</TableHead>
                  <TableHead>得分</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <DimensionRows dimensions={relation.dimensions} />
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">该关系无可见维度</p>
        )}
      </CardContent>
    </Card>
  );
}

/** HR 结果下钻页（PRD 第 38 节）：维度/题目得分 + 评价人实名明细（仅 HR 端） */
export default async function ResultDetailPage({
  params,
}: {
  params: Promise<{ id: string; personId: string }>;
}) {
  const { id, personId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let detail: Awaited<ReturnType<typeof getResultDetail>>;
  let reviewerDetails: Awaited<ReturnType<typeof listReviewerDetails>>;
  try {
    detail = await getResultDetail(id, personId, user);
    reviewerDetails = await listReviewerDetails(id, personId, user);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404) notFound();
      redirect("/");
    }
    throw err;
  }

  const { reviewee } = detail;

  return (
    <AppShell user={user}>
      <ProjectNav projectId={id} />
      <PageHeader
        breadcrumbs={[
          { label: "项目列表", href: "/projects" },
          { label: "结果列表", href: `/projects/${id}/results` },
        ]}
        title={`${reviewee.name} 的测评结果`}
        description={
          <>
            {reviewee.employeeNo}
            {reviewee.department ? ` · ${reviewee.department}` : ""}
            {reviewee.position ? ` · ${reviewee.position}` : ""}
            {reviewee.grade ? ` · ${reviewee.grade}` : ""}
            {detail.frozenAt &&
              ` · 冻结于 ${new Date(detail.frozenAt).toLocaleString("zh-CN")}`}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(
          [
            ["360 总分", score(reviewee.totalScore)],
            ["自评", score(reviewee.selfScore)],
            ["上级", score(reviewee.managerScore)],
            ["平级", score(reviewee.peerScore)],
            ["下级", score(reviewee.subordinateScore)],
            [
              "完成率",
              `${reviewee.submittedCount}/${reviewee.expectedCount}（${pct(reviewee.completionRate)}）`,
            ],
          ] as const
        ).map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-xl">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      {!detail.frozen && (
        <p
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
          role="alert"
        >
          当前为<b>实时数据</b>
          （基于已提交评价动态计算，未锁定）；冻结后固化为正式快照
        </p>
      )}

      {reviewee.submittedCount < reviewee.expectedCount && (
        <p
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
          role="alert"
        >
          结果完整性不足：应评 {reviewee.expectedCount} 份，实际{" "}
          {reviewee.submittedCount} 份，未完成部分按评分引擎归一化规则计分
        </p>
      )}

      {detail.relations.map((relation) => (
        <RelationSection key={relation.relation} relation={relation} />
      ))}

      <Card>
        <CardHeader>
          <CardTitle>评价人实名明细</CardTitle>
          <CardDescription>
            仅 HR 端可见；正式报告不展示评价人姓名（PRD 第 39
            节）。展开查看每位评价人的逐题作答（含开放题原文）
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {reviewerDetails.reviewers.length === 0 && (
            <p className="text-muted-foreground text-sm">暂无已提交的评价</p>
          )}
          {reviewerDetails.reviewers.map((reviewer, i) => (
            <details
              key={`${reviewer.reviewer.employeeNo}-${reviewer.relationType}`}
              className="rounded-md border"
              data-testid={`reviewer-detail-${i}`}
            >
              <summary className="hover:bg-muted/50 cursor-pointer p-3 text-sm">
                <span className="font-medium">{reviewer.reviewer.name}</span>
                <span className="text-muted-foreground">
                  （{reviewer.reviewer.employeeNo}）·{" "}
                  {RELATION_LABELS[reviewer.relationType]} · 提交于{" "}
                  {new Date(reviewer.submittedAt).toLocaleString("zh-CN")}
                </span>
              </summary>
              <div className="overflow-x-auto px-3 pb-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>题目</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead>得分 / 原文</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reviewer.answers.map((answer) => (
                      <TableRow key={answer.questionId}>
                        <TableCell className="text-sm">
                          {answer.code} {answer.title}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {answer.type === "RATING" ? "量表" : "文本"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {answer.type === "RATING"
                            ? (answer.score?.toFixed(1) ?? "—")
                            : (answer.textValue ?? "—")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
          ))}
        </CardContent>
      </Card>
    </AppShell>
  );
}
