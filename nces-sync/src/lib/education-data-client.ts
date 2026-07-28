import type { Logger } from './logger';
import type { ApiPage } from './types';

export interface EducationDataClientOptions {
  baseUrl?: string;
  pageSize?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  /** Base wait for HTTP 429 / Cloudflare rate limits (ms). Grows exponentially. */
  rateLimitDelayMs?: number;
  /** Extra retries allowed specifically for 429 responses. */
  rateLimitMaxRetries?: number;
  requestTimeoutMs?: number;
  logger: Logger;
}

export class EducationDataClient {
  private readonly baseUrl: string;
  private readonly pageSize: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly rateLimitDelayMs: number;
  private readonly rateLimitMaxRetries: number;
  private readonly requestTimeoutMs: number;
  private readonly logger: Logger;

  constructor(options: EducationDataClientOptions) {
    this.baseUrl = (options.baseUrl ?? 'https://educationdata.urban.org/api/v1').replace(/\/$/, '');
    this.pageSize = options.pageSize ?? 1000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1500;
    // Cloudflare 1015 blocks need minutes, not seconds.
    this.rateLimitDelayMs = options.rateLimitDelayMs ?? 60_000;
    this.rateLimitMaxRetries = options.rateLimitMaxRetries ?? 6;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60000;
    this.logger = options.logger;
  }

  async fetchAllPages<T>(initialUrl: string): Promise<T[]> {
    const rows: T[] = [];
    let url: string | null = this.withPageSize(initialUrl);

    while (url) {
      const page: ApiPage<T> = await this.fetchPage<T>(url);
      rows.push(...page.results);
      url = page.next;
      this.logger.debug('Fetched page', { url, count: page.results.length, total: rows.length });
    }

    return rows;
  }

  private withPageSize(url: string): string {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('limit')) {
      parsed.searchParams.set('limit', String(this.pageSize));
    }
    return parsed.toString();
  }

  private async fetchPage<T>(url: string): Promise<ApiPage<T>> {
    let lastError: Error | null = null;
    let rateLimitHits = 0;
    const maxAttempts = this.maxRetries + this.rateLimitMaxRetries;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'PE-Dashboards-NCES-Sync/1.0 (Perkins Eastman; education-data-sync)',
          },
        });

        clearTimeout(timer);

        if (response.status === 429) {
          rateLimitHits += 1;
          const retryAfterSec = parseRetryAfterSeconds(response.headers.get('retry-after'));
          const waitMs = retryAfterSec != null
            ? retryAfterSec * 1000
            : this.rateLimitDelayMs * Math.pow(2, Math.min(rateLimitHits - 1, 4));
          const body = await response.text().catch(() => '');
          lastError = new Error(`HTTP 429 for ${url}: ${body.slice(0, 200)}`);
          this.logger.warn('Rate limited (429) — pausing before retry', {
            url,
            attempt,
            rateLimitHits,
            waitSec: Math.round(waitMs / 1000),
            error: lastError.message,
          });
          if (rateLimitHits >= this.rateLimitMaxRetries) break;
          await sleep(waitMs);
          continue;
        }

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`HTTP ${response.status} for ${url}: ${body.slice(0, 200)}`);
        }

        return (await response.json()) as ApiPage<T>;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isRateLimit = /HTTP 429|rate limit|Error 1015/i.test(lastError.message);
        if (isRateLimit) {
          // Thrown from non-429 path with rate-limit text — treat like 429.
          rateLimitHits += 1;
          const waitMs = this.rateLimitDelayMs * Math.pow(2, Math.min(rateLimitHits - 1, 4));
          this.logger.warn('Rate limited — pausing before retry', {
            url,
            attempt,
            rateLimitHits,
            waitSec: Math.round(waitMs / 1000),
            error: lastError.message,
          });
          if (rateLimitHits >= this.rateLimitMaxRetries) break;
          await sleep(waitMs);
          continue;
        }

        this.logger.warn(`Request failed (attempt ${attempt}/${this.maxRetries})`, {
          url,
          error: lastError.message,
        });
        const normalFailures = attempt - rateLimitHits;
        if (normalFailures < this.maxRetries) {
          await sleep(this.retryDelayMs * Math.max(1, normalFailures));
        } else {
          break;
        }
      }
    }

    throw lastError ?? new Error(`Failed to fetch ${url}`);
  }

  districtDirectoryUrl(year: number, leaid: string): string {
    return `${this.baseUrl}/school-districts/ccd/directory/${year}/?leaid=${leaid}`;
  }

  districtDirectoryByStateUrl(year: number, fips: number): string {
    return `${this.baseUrl}/school-districts/ccd/directory/${year}/?fips=${fips}`;
  }

  schoolDirectoryUrl(year: number, leaid: string): string {
    return `${this.baseUrl}/schools/ccd/directory/${year}/?leaid=${leaid}`;
  }

  schoolEnrollmentUrl(year: number, gradeSlug: string, leaid: string): string {
    return `${this.baseUrl}/schools/ccd/enrollment/${year}/${gradeSlug}/?leaid=${leaid}`;
  }

  districtEnrollmentUrl(year: number, gradeSlug: string, leaid: string): string {
    return `${this.baseUrl}/school-districts/ccd/enrollment/${year}/${gradeSlug}/?leaid=${leaid}`;
  }

  districtFinanceUrl(year: number, leaid: string): string {
    return `${this.baseUrl}/school-districts/ccd/finance/${year}/?leaid=${leaid}`;
  }
}

function parseRetryAfterSeconds(header: string | null): number | null {
  if (!header) return null;
  const asInt = Number(header);
  if (Number.isFinite(asInt) && asInt >= 0) return asInt;
  const when = Date.parse(header);
  if (!Number.isFinite(when)) return null;
  return Math.max(0, Math.ceil((when - Date.now()) / 1000));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
