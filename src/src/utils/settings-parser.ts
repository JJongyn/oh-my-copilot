/**
 * settings-parser.ts
 * Pure utility: parse natural language into settings changes.
 * No LLM — uses fuzzy string matching + Levenshtein distance.
 */

export interface ParsedSettings {
  agent?: string;
  model?: string;
  mode?: 'ask' | 'plan' | 'agent' | 'ultrawork';
  ambiguities?: Array<{ field: string; query: string; options: string[] }>;
}

const KNOWN_AGENTS = [
  'sisyphus',
  'oracle',
  'explore',
  'metis',
  'momus',
  'librarian',
  'atlas',
  'hephaestus',
  'prometheus',
];

const KNOWN_MODES = ['ask', 'plan', 'agent', 'ultrawork'] as const;

const MODEL_KEYWORDS = ['gpt', 'gemini', 'o1', 'o3', 'mini', 'turbo'];

// ─── Levenshtein distance ─────────────────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

// ─── Agent matching ───────────────────────────────────────────────────────────
function matchAgent(tokens: string[]): { matched: string[] } {
  const matched = new Set<string>();
  for (const token of tokens) {
    for (const agent of KNOWN_AGENTS) {
      // substring match in either direction
      if (token.includes(agent) || agent.includes(token)) {
        matched.add(agent);
        continue;
      }
      // edit distance ≤ 2 for typo tolerance
      if (levenshtein(token, agent) <= 2) {
        matched.add(agent);
      }
    }
  }
  return { matched: Array.from(matched) };
}

// ─── Model matching ───────────────────────────────────────────────────────────
function matchModel(tokens: string[], availableModels: string[]): string | undefined {
  for (const token of tokens) {
    // Check against known model keywords
    if (MODEL_KEYWORDS.some(kw => token.includes(kw))) {
      // Try to find an exact match in availableModels first
      const exact = availableModels.find(m => m.toLowerCase() === token);
      if (exact) return exact;

      // Partial match in availableModels
      const partial = availableModels.find(m => m.toLowerCase().includes(token) || token.includes(m.toLowerCase()));
      if (partial) return partial;

      // Return the token as-is (user knows their model name)
      return token;
    }
    // Partial match against known models list
    const partial = availableModels.find(m => {
      const ml = m.toLowerCase();
      return ml.includes(token) || token.includes(ml);
    });
    if (partial) return partial;
  }
  return undefined;
}

// ─── Mode matching ────────────────────────────────────────────────────────────
function matchMode(tokens: string[]): (typeof KNOWN_MODES)[number] | undefined {
  for (const token of tokens) {
    // Exact match
    if ((KNOWN_MODES as readonly string[]).includes(token)) {
      return token as (typeof KNOWN_MODES)[number];
    }
    // Substring: "ultra" → "ultrawork", "agen" → "agent"
    const found = KNOWN_MODES.find(m => m.startsWith(token) || token.startsWith(m));
    if (found) return found;
  }
  return undefined;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function parseSettingsIntent(input: string, availableModels: string[]): ParsedSettings {
  const normalized = input.toLowerCase().trim();
  // Tokenize: split on spaces, commas, semicolons, pipes
  const tokens = normalized.split(/[\s,;|]+/).filter(t => t.length > 0);

  const result: ParsedSettings = {};
  const ambiguities: ParsedSettings['ambiguities'] = [];

  // Agent
  const { matched: agentMatches } = matchAgent(tokens);
  if (agentMatches.length === 1) {
    result.agent = agentMatches[0];
  } else if (agentMatches.length > 1) {
    // Find the query token that triggered these matches
    const queryToken = tokens.find(t =>
      agentMatches.some(a => a.includes(t) || t.includes(a) || levenshtein(t, a) <= 2),
    ) ?? normalized;
    ambiguities.push({ field: 'agent', query: queryToken, options: agentMatches });
  }

  // Model
  const modelMatch = matchModel(tokens, availableModels);
  if (modelMatch) {
    result.model = modelMatch;
  }

  // Mode
  const modeMatch = matchMode(tokens);
  if (modeMatch) {
    result.mode = modeMatch;
  }

  if (ambiguities.length > 0) {
    result.ambiguities = ambiguities;
  }

  return result;
}
