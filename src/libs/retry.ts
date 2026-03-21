export interface RetryOptions {
  fallbackDelayMs: number;
  getRetryDelay?: (err: unknown) => number | null;
  maxRetries: number;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  shouldRetry: (err: unknown) => boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxRetries, fallbackDelayMs, shouldRetry, getRetryDelay, onRetry } =
    options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < maxRetries && shouldRetry(err)) {
        const delay = getRetryDelay?.(err) ?? fallbackDelayMs * 2 ** attempt;
        onRetry?.(err, attempt + 1, delay);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }

  throw new Error("Unreachable: exhausted retries");
}
