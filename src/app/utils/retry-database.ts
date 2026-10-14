const connectionErrorCodes = new Set([
  "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE",
  "P1001", "P1002", "P1017",
]);

const isConnectionError = (error: unknown): boolean => {
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    const current = error as { code?: string; message?: string; cause?: unknown };
    if (connectionErrorCodes.has(current.code ?? "") ||
        current.message === "Connection terminated due to connection timeout" ||
        current.message === "Connection terminated unexpectedly" ||
        current.message === "timeout exceeded when trying to connect") {
      return true;
    }
    error = current.cause;
  }
  return false;
};

// A disconnected query may have committed. Only use this for repeat-safe operations.
export const retryIdempotentDatabaseOperation = async <T>(
  operation: () => Promise<T>,
  retryDelayMs = 1000,
): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= 3 || !isConnectionError(error)) {
        throw error;
      }
      console.warn(`[Database] Connection failed; retrying (${attempt}/2)`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
  }
};
