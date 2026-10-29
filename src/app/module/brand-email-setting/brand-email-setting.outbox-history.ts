import type { Prisma } from '../../../../generated/prisma/client.js';

// Call inside a transaction: state and history commit or roll back together.
export async function transitionOutbox(tx: Prisma.TransactionClient, where: Prisma.EmailOutboxWhereInput, data: Prisma.EmailOutboxUpdateManyMutationInput, code: string | null = null, actorId?: string) {
  const changed = await tx.emailOutbox.updateMany({ where, data });
  if (!changed.count) return false;
  const job = await tx.emailOutbox.findUniqueOrThrow({ where: { id: String(where.id) } });
  const sequence = await tx.emailOutboxHistory.count({ where: { outboxId: job.id } });
  await tx.emailOutboxHistory.create({ data: { outboxId: job.id, sequence, status: job.status, attempt: job.attempts, provider: job.provider, code, actorId } });
  return true;
}
