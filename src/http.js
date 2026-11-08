// Plain HTTP for public event pages: an honest User-Agent, a timeout that covers the body too, retries for failures
// that can recover, and requests to the same host started at least HOST_GAP_MS apart. A bot wall is reported as
// "blocked" and never worked around.

export const USER_AGENT = 'events-scraper/0.1 (+https://apify.com/m_ctim/events-scraper)';

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;
const HOST_GAP_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hostTurns = new Map();

/** Serializes requests per host, HOST_GAP_MS apart, while different hosts run in parallel. */
function waitForHost(host) {
    const previous = hostTurns.get(host) ?? Promise.resolve();
    hostTurns.set(host, previous.then(() => sleep(HOST_GAP_MS)).catch(() => {}));
    return previous;
}

const CHALLENGE_RE = /<title>\s*(just a moment\.\.\.|attention required! \| cloudflare|access denied|pardon our interruption|are you a robot|security check)|captcha-delivery\.com|px-captcha|_incapsula_resource|cf-browser-verification/i;

/** True when a page is a bot check rather than the page asked for. */
export function isChallenge(status, body) {
    return status !== 404 && CHALLENGE_RE.test(String(body ?? '').slice(0, 30_000));
}

export class BlockedError extends Error {
    constructor(host) {
        super(`${host} answered with a bot check instead of the page`);
        this.name = 'BlockedError';
    }
}

/**
 * GET a page as text. Throws on failure, after retries for timeouts, 429 and 5xx.
 * @returns {Promise<{ status: number, url: string, body: string }>} url is the final URL after redirects.
 */
export async function getText(url, { accept = 'text/html,application/xhtml+xml' } = {}) {
    const host = new URL(url).host;
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        await waitForHost(host);
        let status; // stays undefined for network errors and timeouts, which are always retried
        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'en' },
                redirect: 'follow',
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            // Read the body inside the same timeout: a server that sends headers and then stalls would otherwise hang.
            const body = await res.text();
            status = res.status;
            if (res.status === 403 || isChallenge(res.status, body)) throw new BlockedError(host);
            if (res.ok) return { status: res.status, url: res.url, body };
            lastError = new Error(`${host} answered HTTP ${res.status}`);
        } catch (err) {
            if (err instanceof BlockedError) throw err;
            status = undefined;
            lastError = err.name === 'TimeoutError' || err.name === 'AbortError'
                ? new Error(`${host} didn't answer within ${REQUEST_TIMEOUT_MS / 1000} s`)
                : err;
        }
        if (status !== undefined && !TRANSIENT_STATUSES.has(status)) throw lastError;
        if (attempt < MAX_ATTEMPTS) await sleep(1500 * 2 ** (attempt - 1));
    }
    throw lastError;
}

export async function getJson(url) {
    const { body } = await getText(url, { accept: 'application/json' });
    return JSON.parse(body);
}
