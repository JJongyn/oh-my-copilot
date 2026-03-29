import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';

// ─── Session usage counters (reset when bridge restarts) ─────────────────────
let sessionRequests = 0;
let sessionOutputTokens = 0;

// ─── Copilot plan quota cache ─────────────────────────────────────────────────
interface QuotaEntry { used: number; limit: number | null }
interface CopilotQuota {
  chatMessages?: QuotaEntry;
  codeCompletions?: QuotaEntry;
  fetchedAt?: number;
}
let quotaCache: CopilotQuota = {};
const QUOTA_TTL_MS = 3 * 60 * 1000; // refresh every 3 minutes

function httpsGetJson(url: string, headers: Record<string, string>): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers },
      (res) => {
        let raw = '';
        res.on('data', (c: Buffer) => { raw += c.toString(); });
        res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode ?? 0, body: null }); }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function extractQuotaFromBody(body: unknown): Pick<CopilotQuota, 'chatMessages' | 'codeCompletions'> | null {
  if (!body || typeof body !== 'object') return null;
  const data = body as Record<string, unknown>;
  const quotas = data['limited_user_quotas'];
  if (!quotas || typeof quotas !== 'object') return null;
  const q = quotas as Record<string, QuotaEntry>;
  return {
    chatMessages: q['chat_messages'] ?? undefined,
    codeCompletions: q['code_completions'] ?? undefined,
  };
}

async function fetchCopilotQuota(): Promise<CopilotQuota> {
  const now = Date.now();
  if (quotaCache.fetchedAt && now - quotaCache.fetchedAt < QUOTA_TTL_MS) {
    return quotaCache;
  }

  // ── Approach 1: access GitHub.copilot extension exports directly ──────────
  try {
    const ext = vscode.extensions.getExtension('GitHub.copilot');
    if (ext?.isActive) {
      const exp = ext.exports as Record<string, unknown> | undefined;
      const possible = [
        (exp as any)?.status?.quotas,
        (exp as any)?.quotas,
        (exp as any)?.account?.quotas,
        (exp as any)?.limited_user_quotas,
      ];
      for (const q of possible) {
        if (q && typeof q === 'object') {
          const chat = (q as any)['chat_messages'] ?? (q as any)['chatMessages'];
          const code = (q as any)['code_completions'] ?? (q as any)['codeCompletions'];
          if (chat || code) {
            quotaCache = { chatMessages: chat, codeCompletions: code, fetchedAt: now };
            return quotaCache;
          }
        }
      }
    }
  } catch { /* extension API not available */ }

  // ── Approach 2: GitHub Copilot internal HTTP API ──────────────────────────
  try {
    const session = await vscode.authentication.getSession('github', ['read:user'], { silent: true });
    if (!session) {
      quotaCache = { fetchedAt: now };
      return quotaCache;
    }

    const vscVersion = vscode.version;
    const chatExt = vscode.extensions.getExtension('GitHub.copilot-chat');
    const copilotExt = vscode.extensions.getExtension('GitHub.copilot');
    const chatVer = chatExt?.packageJSON?.version ?? '0.22.4';
    const copilotVer = copilotExt?.packageJSON?.version ?? '1.199.0';

    const commonHeaders: Record<string, string> = {
      Authorization: `token ${session.accessToken}`,
      Accept: 'application/json',
      'Editor-Version': `vscode/${vscVersion}`,
      'Editor-Plugin-Version': `copilot-chat/${chatVer}`,
      'Copilot-Integration-Id': 'vscode-chat',
      'User-Agent': `GitHubCopilotChat/${chatVer}`,
    };

    // Try 1: copilot_internal/v2/token (contains limited_user_quotas for metered plans)
    const tokenRes = await httpsGetJson('https://api.github.com/copilot_internal/v2/token', commonHeaders);
    const fromToken = extractQuotaFromBody(tokenRes.body);
    if (tokenRes.status === 200 && fromToken) {
      quotaCache = { ...fromToken, fetchedAt: now };
      return quotaCache;
    }

    // Try 2: copilot_internal/user (alternative endpoint)
    const userRes = await httpsGetJson('https://api.github.com/copilot_internal/user', {
      ...commonHeaders,
      'Editor-Plugin-Version': `copilot/${copilotVer}`,
      'User-Agent': `GithubCopilot/${copilotVer}`,
    });
    const fromUser = extractQuotaFromBody(userRes.body);
    if (userRes.status === 200 && fromUser) {
      quotaCache = { ...fromUser, fetchedAt: now };
      return quotaCache;
    }

    // Try 3: user/copilot_billing (public API — requires billing scope, may 403)
    const billingRes = await httpsGetJson('https://api.github.com/user/copilot_billing', commonHeaders);
    if (billingRes.status === 200 && billingRes.body && typeof billingRes.body === 'object') {
      const b = billingRes.body as Record<string, unknown>;
      // billing API shape differs — extract what's available
      const seat = b['seat_management_setting'];
      const assigned = b['seat_breakdown'];
      if (seat || assigned) {
        // billing API doesn't give usage% — fall through
      }
    }
  } catch { /* network error — use stale or empty cache */ }

  quotaCache = { fetchedAt: now };
  return quotaCache;
}

export interface ServerOptions {
  port: number;
  token: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

interface ToolCallRequest {
  name: string;
  input?: Record<string, unknown>;
}

function serializeToolResultContent(
  parts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelPromptTsxPart | vscode.LanguageModelDataPart | unknown>,
): Array<{ type: string; text?: string; mimeType?: string }> {
  const safeStringify = (value: unknown): string => {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  return parts.map((part) => {
    if (part instanceof vscode.LanguageModelTextPart) {
      return { type: 'text', text: part.value };
    }
    if (part instanceof vscode.LanguageModelDataPart) {
      if (part.mimeType.includes('json')) {
        return { type: 'json', text: Buffer.from(part.data).toString('utf8'), mimeType: part.mimeType };
      }
      if (part.mimeType.startsWith('text/')) {
        return { type: 'data', text: Buffer.from(part.data).toString('utf8'), mimeType: part.mimeType };
      }
      return { type: 'data', text: `[binary data: ${part.mimeType}]`, mimeType: part.mimeType };
    }
    if (part instanceof vscode.LanguageModelPromptTsxPart) {
      return { type: 'unknown', text: safeStringify(part.value) };
    }
    return { type: 'unknown', text: typeof part === 'string' ? part : safeStringify(part) };
  });
}

function mapToVscodeMessages(messages: ChatMessage[]): vscode.LanguageModelChatMessage[] {
  const result: vscode.LanguageModelChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      // VS Code LM doesn't support system messages — prepend as user message
      result.push(vscode.LanguageModelChatMessage.User(`[System Instructions]\n${msg.content}`));
    } else if (msg.role === 'user') {
      result.push(vscode.LanguageModelChatMessage.User(msg.content));
    } else if (msg.role === 'assistant') {
      result.push(vscode.LanguageModelChatMessage.Assistant(msg.content));
    }
  }
  return result;
}

async function selectModel(modelId?: string): Promise<vscode.LanguageModelChat | null> {
  const config = vscode.workspace.getConfiguration('ohMyCopilotBridge');
  const defaultFamily = config.get<string>('defaultModel', 'gpt-5-mini');

  // Try exact match first
  if (modelId && modelId !== 'auto') {
    // Try by family name
    const byFamily = await vscode.lm.selectChatModels({ vendor: 'copilot', family: modelId });
    if (byFamily.length > 0) return byFamily[0];

    // Try by id
    const all = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    const byId = all.find(m => m.id === modelId || m.name === modelId);
    if (byId) return byId;
  }

  // Fall back to default family
  const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: defaultFamily });
  if (models.length > 0) return models[0];

  // Last resort: any copilot model
  const any = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  return any[0] ?? null;
}

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message, type: 'bridge_error' } }));
}

function checkAuth(req: http.IncomingMessage, token: string): boolean {
  const auth = req.headers['authorization'];
  if (!auth) return false;
  const parts = auth.split(' ');
  return parts.length === 2 && parts[0] === 'Bearer' && parts[1] === token;
}

export function createServer(options: ServerOptions): http.Server {
  const { token } = options;

  const server = http.createServer(async (req, res) => {
    // CORS headers for local access
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Auth check (skip for /health)
    if (req.url !== '/health' && !checkAuth(req, token)) {
      sendError(res, 401, 'Unauthorized — invalid or missing Bearer token');
      return;
    }

    // GET /health — no auth required
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', pid: process.pid }));
      return;
    }

    // GET /v1/models
    if (req.method === 'GET' && req.url === '/v1/models') {
      try {
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        const data = models.map(m => ({
          id: m.id,
          object: 'model',
          created: Date.now(),
          owned_by: 'copilot',
          name: m.name,
          family: m.family,
          vendor: m.vendor,
          version: m.version,
          maxInputTokens: m.maxInputTokens,
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data }));
      } catch (err) {
        sendError(res, 500, `Failed to list models: ${err}`);
      }
      return;
    }

    // GET /v1/tools
    if (req.method === 'GET' && req.url === '/v1/tools') {
      try {
        const data = vscode.lm.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          tags: [...tool.tags],
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data }));
      } catch (err) {
        sendError(res, 500, `Failed to list editor tools: ${err}`);
      }
      return;
    }

    // POST /v1/tools/call
    if (req.method === 'POST' && req.url === '/v1/tools/call') {
      let body: string;
      try {
        body = await parseBody(req);
      } catch {
        sendError(res, 400, 'Failed to read request body');
        return;
      }

      let toolReq: ToolCallRequest;
      try {
        toolReq = JSON.parse(body);
      } catch {
        sendError(res, 400, 'Invalid JSON in request body');
        return;
      }

      if (!toolReq.name || typeof toolReq.name !== 'string') {
        sendError(res, 400, 'tool name is required');
        return;
      }

      try {
        const result = await vscode.lm.invokeTool(toolReq.name, {
          toolInvocationToken: undefined,
          input: toolReq.input ?? {},
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          name: toolReq.name,
          content: serializeToolResultContent(result.content),
        }));
      } catch (err) {
        sendError(res, 500, `Failed to call editor tool "${toolReq.name}": ${err}`);
      }
      return;
    }

    // POST /v1/chat/completions
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body: string;
      try {
        body = await parseBody(req);
      } catch {
        sendError(res, 400, 'Failed to read request body');
        return;
      }

      let chatReq: ChatRequest;
      try {
        chatReq = JSON.parse(body);
      } catch {
        sendError(res, 400, 'Invalid JSON in request body');
        return;
      }

      if (!chatReq.messages || !Array.isArray(chatReq.messages) || chatReq.messages.length === 0) {
        sendError(res, 400, 'messages array is required and must not be empty');
        return;
      }

      const model = await selectModel(chatReq.model);
      if (!model) {
        sendError(res, 503, 'No Copilot model available. Ensure GitHub Copilot is active in this VS Code window.');
        return;
      }

      const vscodeMessages = mapToVscodeMessages(chatReq.messages);
      const cts = new vscode.CancellationTokenSource();

      // Handle client disconnect
      req.on('close', () => cts.cancel());

      const stream = chatReq.stream !== false; // default to streaming
      const requestId = `chatcmpl-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);

      try {
        const response = await model.sendRequest(vscodeMessages, {}, cts.token);
        sessionRequests++;

        if (stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
          });

          let inputTokens = 0;
          let outputTokens = 0;

          for await (const fragment of response.text) {
            outputTokens += Math.ceil(fragment.length / 4);
            const chunk = {
              id: requestId,
              object: 'chat.completion.chunk',
              created,
              model: model.id,
              choices: [{
                index: 0,
                delta: { role: 'assistant', content: fragment },
                finish_reason: null,
              }],
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          sessionOutputTokens += outputTokens;

          // Final chunk with finish_reason
          const finalChunk = {
            id: requestId,
            object: 'chat.completion.chunk',
            created,
            model: model.id,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: 'stop',
            }],
            usage: {
              prompt_tokens: inputTokens,
              completion_tokens: outputTokens,
              total_tokens: inputTokens + outputTokens,
            },
          };
          res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          // Non-streaming: collect all and return
          let fullContent = '';
          for await (const fragment of response.text) {
            fullContent += fragment;
          }
          const completion = {
            id: requestId,
            object: 'chat.completion',
            created,
            model: model.id,
            choices: [{
              index: 0,
              message: { role: 'assistant', content: fullContent },
              finish_reason: 'stop',
            }],
            usage: {
              prompt_tokens: 0,
              completion_tokens: Math.ceil(fullContent.length / 4),
              total_tokens: Math.ceil(fullContent.length / 4),
            },
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(completion));
        }
      } catch (err) {
        if (err instanceof vscode.LanguageModelError) {
          const status = err.code === 'NotFound' ? 404 : 500;
          sendError(res, status, `Copilot error [${err.code}]: ${err.message}`);
        } else {
          sendError(res, 500, `Request failed: ${err}`);
        }
      }
      return;
    }

    // GET /v1/copilot/usage — session stats + plan quota from GitHub
    if (req.method === 'GET' && req.url === '/v1/copilot/usage') {
      let user: string | undefined;
      try {
        const session = await vscode.authentication.getSession('github', ['read:user'], { silent: true });
        user = session?.account.label;
      } catch { /* not available — ignore */ }

      const quota = await fetchCopilotQuota();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        requests: sessionRequests,
        tokens: sessionOutputTokens,
        user,
        quota: {
          chatMessages: quota.chatMessages ?? null,
          codeCompletions: quota.codeCompletions ?? null,
        },
      }));
      return;
    }

    // GET /v1/copilot/quota-debug — raw responses from GitHub APIs for diagnostics
    if (req.method === 'GET' && req.url === '/v1/copilot/quota-debug') {
      try {
        const session = await vscode.authentication.getSession('github', ['read:user'], { silent: true });
        if (!session) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No GitHub session' }));
          return;
        }
        const vscVersion = vscode.version;
        const chatExt = vscode.extensions.getExtension('GitHub.copilot-chat');
        const chatVer = chatExt?.packageJSON?.version ?? '0.22.4';
        const headers: Record<string, string> = {
          Authorization: `token ${session.accessToken}`,
          Accept: 'application/json',
          'Editor-Version': `vscode/${vscVersion}`,
          'Editor-Plugin-Version': `copilot-chat/${chatVer}`,
          'Copilot-Integration-Id': 'vscode-chat',
          'User-Agent': `GitHubCopilotChat/${chatVer}`,
        };
        const [tokenRes, userRes] = await Promise.all([
          httpsGetJson('https://api.github.com/copilot_internal/v2/token', headers),
          httpsGetJson('https://api.github.com/copilot_internal/user', headers),
        ]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          vscodeVersion: vscVersion,
          chatExtVersion: chatVer,
          tokenEndpoint: { status: tokenRes.status, body: tokenRes.body },
          userEndpoint: { status: userRes.status, body: userRes.body },
        }, null, 2));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    // 404 for everything else
    sendError(res, 404, `Not found: ${req.method} ${req.url}`);
  });

  return server;
}
