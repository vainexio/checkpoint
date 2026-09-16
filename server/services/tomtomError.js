/**
 * A failed TomTom response, turned into an error that says why it failed.
 *
 * TomTom answers most account problems with the same bare 403, and the only
 * place it says *which* problem is the JSON body: out of credits, a key that
 * is not authorised, a rate limit. Every call site used to throw just the
 * status, so the logs read "TomTom responded 403" for the whole time the
 * account had simply run out of credits — the one fact that mattered was being
 * thrown away.
 *
 * The message is built only from the status and the fields TomTom returns. The
 * request URL carries the API key, so it is never part of it.
 */

/* Account and key problems do not clear themselves in minutes, so there is no
   sense asking again every refresh. An hour keeps a real outage visible in the
   logs without spending a request every five minutes to rediscover it. */
const ACCOUNT_PAUSE_MS = 60 * 60 * 1000;

/* A rate limit is the one 4xx that does clear quickly. */
const RATE_LIMIT_PAUSE_MS = 60 * 1000;

/* Enough of a non-JSON body to be useful in a log line, and no more. */
const MAX_TEXT_DETAIL = 120;

export class TomTomError extends Error {
  constructor({ status, code = null, detail = null, pauseMs = 0 }) {
    const reason = [code, detail].filter(Boolean).join(': ');
    super(`TomTom responded ${status}${reason ? ` ${reason}` : ''}`);
    this.name = 'TomTomError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    /**
     * How long every further request is pointless for, in milliseconds.
     * Zero means this failure belongs to one request, not to the account, so
     * the next request is worth making.
     */
    this.pauseMs = pauseMs;
  }
}

/**
 * How long to stop asking after a failure with this status and code.
 *
 * Pure, so the classification can be tested without a network.
 */
export function pauseFor({ status, code = null, detail = null, retryAfterSeconds = null }) {
  // TomTom's rate-limit 403 ("Developer Over Qps") often arrives as plain text
  // rather than a code, so the detail has to be read as well. Loose enough to
  // catch it, tight enough that an unrelated word containing "rate" does not.
  const rateLimited =
    status === 429 || /\bqps\b|rate.?limit|over the rate/i.test(`${code ?? ''} ${detail ?? ''}`);
  if (rateLimited) {
    return Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : RATE_LIMIT_PAUSE_MS;
  }
  if (status === 401 || status === 403) return ACCOUNT_PAUSE_MS;
  return 0;
}

/** Build a TomTomError from a non-OK fetch Response, reading its body once. */
export async function tomtomErrorFrom(res) {
  let code = null;
  let detail = null;

  let text = '';
  try {
    text = await res.text();
  } catch {
    // An unreadable body still leaves the status, which is better than nothing.
  }

  try {
    const body = JSON.parse(text);
    code = body?.detailedError?.code ?? body?.error ?? null;
    detail = body?.detailedError?.message ?? body?.errorText ?? body?.message ?? null;
  } catch {
    // Some TomTom errors arrive as plain text, e.g. "Developer Inactive".
    const trimmed = text.trim();
    if (trimmed) detail = trimmed.slice(0, MAX_TEXT_DETAIL);
  }

  const retryAfterSeconds = Number(res.headers?.get?.('retry-after'));

  return new TomTomError({
    status: res.status,
    code,
    detail,
    pauseMs: pauseFor({ status: res.status, code, detail, retryAfterSeconds }),
  });
}
