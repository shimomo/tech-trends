export interface Http {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

export function realHttp(): Http {
  return {
    fetch: (input, init) => fetch(input, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export interface RetryOptions {
  retries: number;
  retryOn: (res: Response) => boolean;
}

const MAX_RETRY_AFTER_MS = 60_000;

function retryDelayMs(res: Response | undefined, attempt: number): number {
  const header = res?.headers.get("retry-after");
  const seconds =
    header === null || header === undefined ? Number.NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }
  return 2 ** attempt * 1000;
}

/**
 * retryOn が真、またはネットワーク例外のとき retries 回まで再試行する。
 * 使い切ったら最後の Response を返す（例外なら最後の例外を投げる）。
 */
export async function fetchWithRetry(
  http: Http,
  url: string,
  init: RequestInit,
  opts: RetryOptions,
): Promise<Response> {
  let lastError: unknown;
  let lastResponse: Response | undefined;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      lastResponse = await http.fetch(url, init);
      lastError = undefined;
      if (!opts.retryOn(lastResponse)) return lastResponse;
    } catch (e) {
      lastError = e;
      lastResponse = undefined;
    }
    if (attempt < opts.retries)
      await http.sleep(retryDelayMs(lastResponse, attempt));
  }
  if (lastResponse) return lastResponse;
  throw lastError;
}

/** 同時実行数を limit に抑えつつ、結果の順序を保つ */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i] as T);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
