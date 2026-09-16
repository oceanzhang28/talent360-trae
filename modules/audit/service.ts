import type { AuditAction, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * 审计日志（技术文档第 25 节）：仅关键操作。
 * projectId / actorUserId 不建外键：项目或用户删除后审计记录保留。
 */

export type AuditInput = {
  actorUserId: string;
  projectId: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

/** 写审计（事务内使用 tx；独立调用省略 tx） */
export async function writeAudit(
  input: AuditInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}
