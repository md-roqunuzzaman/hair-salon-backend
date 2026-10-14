import { Prisma } from "../../../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

import {
  IAuditLogQuery,
  ICreateAuditLogPayload,
} from "./auditLog.interface.js";

// =====================================================
// CREATE AUDIT LOG
// =====================================================

const createAuditLog = async (
  payload: ICreateAuditLogPayload,
  tx?: Prisma.TransactionClient,
) => {
  const db = tx ?? prisma;

  return db.auditLog.create({
    data: {
      userId: payload.userId ?? null,

      action: payload.action,

      entityType: payload.entityType,

      entityId: payload.entityId ?? null,

      metadata:
        payload.metadata !== undefined
          ? (payload.metadata as Prisma.InputJsonValue)
          : undefined,
    },
  });
};

// =====================================================
// GET AUDIT LOGS
// =====================================================

const getAuditLogs = async (query: IAuditLogQuery) => {
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 20);

  const skip = (page - 1) * limit;

  const where: Prisma.AuditLogWhereInput = {};

  // =====================================================
  // FILTER: USER
  // =====================================================

  if (query.userId) {
    where.userId = query.userId;
  }

  // =====================================================
  // FILTER: ACTION
  // =====================================================

  if (query.action) {
    where.action = query.action;
  }

  // =====================================================
  // FILTER: ENTITY TYPE
  // =====================================================

  if (query.entityType) {
    where.entityType = query.entityType;
  }

  // =====================================================
  // FILTER: ENTITY ID
  // =====================================================

  if (query.entityId) {
    where.entityId = query.entityId;
  }

  // =====================================================
  // FILTER: DATE RANGE
  // Hong Kong timezone (UTC+08:00)
  // =====================================================

  if (query.from || query.to) {
    where.createdAt = {};

    if (query.from) {
      where.createdAt.gte = new Date(`${query.from}T00:00:00+08:00`);
    }

    if (query.to) {
      where.createdAt.lte = new Date(`${query.to}T23:59:59.999+08:00`);
    }
  }

  // =====================================================
  // FETCH AUDIT LOGS + TOTAL COUNT
  // =====================================================

  const [logs, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,

      skip,
      take: limit,

      orderBy: {
        createdAt: "desc",
      },

      select: {
        id: true,

        userId: true,

        // Operator name
        user: {
          select: {
            name: true,
          },
        },

        action: true,

        entityType: true,

        entityId: true,

        createdAt: true,
      },
    }),

    prisma.auditLog.count({
      where,
    }),
  ]);

  // =====================================================
  // PAGINATION
  // =====================================================

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  // =====================================================
  // RESPONSE
  // =====================================================

  return {
    items: logs.map((log) => ({
      id: log.id,

      userId: log.userId,

      // =================================================
      // OPERATOR NAME
      // =================================================

      actorName: log.user?.name ?? null,

      action: log.action,

      entityType: log.entityType,

      entityId: log.entityId,

      createdAt: log.createdAt.toISOString(),
    })),

    pagination: {
      page,

      limit,

      total,

      totalPages,

      hasNextPage: page < totalPages,

      hasPreviousPage: page > 1,
    },
  };
};

// =====================================================
// EXPORT
// =====================================================

export const auditLogService = {
  createAuditLog,
  getAuditLogs,
};
