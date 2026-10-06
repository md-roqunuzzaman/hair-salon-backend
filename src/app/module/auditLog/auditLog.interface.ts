export interface IAuditLogQuery {
  page?: number;
  limit?: number;

  userId?: string;

  action?: string;

  entityType?: string;

  entityId?: string;

  from?: string;

  to?: string;
}

export interface ICreateAuditLogPayload {
  userId?: string | null;

  action: string;

  entityType: string;

  entityId?: string | null;

  metadata?: Record<string, unknown>;
}
