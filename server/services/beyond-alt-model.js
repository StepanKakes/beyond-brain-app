/**
 * Beyond Brain — the cheap lane.
 *
 * The Max subscription is a weekly budget, and the jobs that eat it are the
 * mechanical ones: read a transcript, compare two files, summarise what came
 * in overnight. Those do not need the best model in the world, and every one
 * of them takes a bite out of the week that the chat then does not have.
 *
 * DeepSeek serves an Anthropic-shaped API, so the same Claude Code that runs
 * everything else can run a job against it by changing two environment
 * variables for that one spawn. Nothing else about the run changes: same
 * tools, same skills, same brain. Claude model names map on their side
 * (haiku/sonnet → deepseek-flash, opus → deepseek-v4-pro).
 *
 * Settings:
 *   BEYOND_ALT_KEY       the provider's API key (empty = the lane is closed)
 *   BEYOND_ALT_JOBS      which jobs take it, comma separated, `*` for all
 *   BEYOND_ALT_BASE_URL  defaults to DeepSeek's Anthropic endpoint
 */

const DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic';

/** Published DeepSeek prices per million tokens (peak). Used only to label cost. */
const ALT_PRICES = {
  'deepseek-flash': { input: 0.30, cacheRead: 0.006, cacheWrite: 0.30, output: 1.20 },
  'deepseek-v4-pro': { input: 1.32, cacheRead: 0.044, cacheWrite: 1.32, output: 3.96 },
};

export function altKey() {
  const v = process.env.BEYOND_ALT_KEY;
  return v && v.trim() ? v.trim() : null;
}

export function altBaseUrl() {
  const v = process.env.BEYOND_ALT_BASE_URL;
  return (v && v.trim()) || DEFAULT_BASE_URL;
}

/** The job names routed to the cheap lane. */
export function altJobs() {
  return String(process.env.BEYOND_ALT_JOBS || '')
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Does this job run on the other provider? */
export function usesAlt(jobName) {
  if (!altKey() || !jobName) return false;
  const list = altJobs();
  if (!list.length) return false;
  return list.includes('*') || list.includes(String(jobName).toLowerCase());
}

/**
 * The environment one spawn needs to talk to the other provider. Merged over
 * `process.env` by the caller, because the SDK replaces the environment
 * wholesale rather than adding to it.
 */
export function altEnv() {
  const key = altKey();
  if (!key) return null;
  return {
    ANTHROPIC_BASE_URL: altBaseUrl(),
    ANTHROPIC_API_KEY: key,
    ANTHROPIC_AUTH_TOKEN: key,
    // The subscription's own credentials must not leak into a run that is
    // deliberately not using the subscription.
    CLAUDE_CODE_USE_BEDROCK: '',
    CLAUDE_CODE_USE_VERTEX: '',
  };
}

/** What a run on the cheap lane cost, by the provider's own prices. */
export function altCost(model, usage = {}) {
  const key = Object.keys(ALT_PRICES).find((k) => String(model || '').includes(k)) || 'deepseek-flash';
  const p = ALT_PRICES[key];
  const m = (n) => (Number(n) || 0) / 1_000_000;
  return (
    m(usage.input_tokens) * p.input
    + m(usage.cache_read_input_tokens) * p.cacheRead
    + m(usage.cache_creation_input_tokens) * p.cacheWrite
    + m(usage.output_tokens) * p.output
  );
}
