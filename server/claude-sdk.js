/**
 * Claude SDK Integration
 *
 * This module provides SDK-based integration with Claude using the @anthropic-ai/claude-agent-sdk.
 * It mirrors the interface of claude-cli.js but uses the SDK internally for better performance
 * and maintainability.
 *
 * Key features:
 * - Direct SDK integration without child processes
 * - Session management with abort capability
 * - Options mapping between CLI and SDK formats
 * - WebSocket message streaming
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { CLAUDE_MODELS } from '../shared/modelConstants.js';
import { resolveClaudeCodeExecutablePath } from './shared/claude-cli-path.js';
import {
  createNotificationEvent,
  notifyRunFailed,
  notifyRunStopped,
  notifyUserIfEnabled
} from './services/notification-orchestrator.js';
import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { createNormalizedMessage } from './shared/utils.js';
import {
  listConnectors as listBeyondConnectors,
  updateConnector as updateBeyondConnector,
} from './services/beyond-mcp-connectors-store.js';
import { refreshIfNeeded as refreshBeyondConnectorToken } from './services/beyond-mcp-oauth.js';
import { resolveSpawnCwd } from './utils/brain-path.js';
import { buildBeyondToolsServer, BEYOND_TOOL_NAMES } from './services/beyond-agent-tools.js';
import { promptBlock as memoryPromptBlock } from './services/beyond-memory.js';
import { record as recordHistory, touchSession as touchHistorySession } from './services/beyond-history.js';

const activeSessions = new Map();
const pendingToolApprovals = new Map();

// Cached list of models the installed Claude Code actually offers (value +
// version-bearing displayName/description), fetched once via the SDK's
// `supportedModels()` control request. Lets the Beyond model picker show real
// version numbers ("Opus 4.7", "Sonnet 4.6") instead of bare aliases.
let cachedSupportedModels = null;

const TOOL_APPROVAL_TIMEOUT_MS = parseInt(process.env.CLAUDE_TOOL_APPROVAL_TIMEOUT_MS, 10) || 55000;

const TOOLS_REQUIRING_INTERACTION = new Set(['AskUserQuestion', 'ExitPlanMode']);

// Beyond Brain treats a chat as a 200k-token window by default even though
// Opus's raw context is 1M. The smaller cap keeps the per-turn cache cost
// bounded and makes long chats summarise themselves instead of growing ever
// heavier and slower. The UI chip and the SDK's auto-compact both key off
// these. Set from the Agent screen (tokenBudgetTotal(), e.g. 1000000
// for the whole window); read at call time so a change applies to the next
// chat without a restart.
function tokenBudgetTotal() {
  return parseInt(process.env.tokenBudgetTotal(), 10) || 200000;
}
function autoCompactThreshold() {
  return parseInt(process.env.autoCompactThreshold(), 10) || Math.floor(tokenBudgetTotal() * 0.8);
}

// ---------------------------------------------------------------------------
// Persistent streaming SDK sessions (Beyond Brain).
// ---------------------------------------------------------------------------
//
// In Beyond Brain we re-use the same claude.exe subprocess for every user
// turn of a given chat session, instead of spawning a fresh process per
// WebSocket message. That keeps Anthropic's prompt cache warm across turns
// (process churn would shift cache boundaries → cache_creation per turn),
// keeps MCP servers connected (no reconnect cycle invalidating the tools
// listing), and removes per-turn spawn latency.
//
// The SDK is told `prompt: <AsyncIterable<SDKUserMessage>>`. We control the
// iterable via `pushInput()`/`endInput()`. Each user message becomes one
// `{type:'user', message:{role:'user', content:...}}` yielded value.
//
// Session entries live in `beyondStreamSessions`, keyed by the SDK-assigned
// session UUID (or a temp key during the very first turn before the UUID is
// known). Entries die on WS disconnect or after `BEYOND_SESSION_IDLE_MS` of
// no activity.
const beyondStreamSessions = new Map();
const BEYOND_SESSION_IDLE_MS = parseInt(process.env.BEYOND_SESSION_IDLE_MS, 10) || 30 * 60 * 1000;
let beyondTempKeyCounter = 0;

function beyondChatKey(userId, sessionId) {
  return `${userId || 'anon'}::${sessionId}`;
}

/** Tiny manual AsyncIterable. `push` enqueues a value; `end` closes the
 *  iterator. Used to feed the streaming-input prompt of `query()` over the
 *  lifetime of a chat session. */
function createBeyondMessageQueue() {
  const queue = [];
  const resolvers = [];
  let closed = false;

  const queueObj = {
    push(value) {
      if (closed) return false;
      const resolver = resolvers.shift();
      if (resolver) {
        resolver({ value, done: false });
      } else {
        queue.push(value);
      }
      return true;
    },
    end() {
      if (closed) return;
      closed = true;
      while (resolvers.length) {
        resolvers.shift()({ value: undefined, done: true });
      }
    },
    get closed() {
      return closed;
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (queue.length) {
            return Promise.resolve({ value: queue.shift(), done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve) => resolvers.push(resolve));
        },
        return() {
          closed = true;
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
  return queueObj;
}

function createRequestId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function waitForToolApproval(requestId, options = {}) {
  const { timeoutMs = TOOL_APPROVAL_TIMEOUT_MS, signal, onCancel, metadata } = options;

  return new Promise(resolve => {
    let settled = false;

    const finalize = (decision) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(decision);
    };

    let timeout;

    const cleanup = () => {
      pendingToolApprovals.delete(requestId);
      if (timeout) clearTimeout(timeout);
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
    };

    // timeoutMs 0 = wait indefinitely (interactive tools)
    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        onCancel?.('timeout');
        finalize(null);
      }, timeoutMs);
    }

    const abortHandler = () => {
      onCancel?.('cancelled');
      finalize({ cancelled: true });
    };

    if (signal) {
      if (signal.aborted) {
        onCancel?.('cancelled');
        finalize({ cancelled: true });
        return;
      }
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    const resolver = (decision) => {
      finalize(decision);
    };
    // Attach metadata for getPendingApprovalsForSession lookup
    if (metadata) {
      Object.assign(resolver, metadata);
    }
    pendingToolApprovals.set(requestId, resolver);
  });
}

function resolveToolApproval(requestId, decision) {
  const resolver = pendingToolApprovals.get(requestId);
  if (resolver) {
    resolver(decision);
  }
}

// Match stored permission entries against a tool + input combo.
// This only supports exact tool names and the Bash(command:*) shorthand
// used by the UI; it intentionally does not implement full glob semantics,
// introduced to stay consistent with the UI's "Allow rule" format.
function matchesToolPermission(entry, toolName, input) {
  if (!entry || !toolName) {
    return false;
  }

  if (entry === toolName) {
    return true;
  }

  const bashMatch = entry.match(/^Bash\((.+):\*\)$/);
  if (toolName === 'Bash' && bashMatch) {
    const allowedPrefix = bashMatch[1];
    let command = '';

    if (typeof input === 'string') {
      command = input.trim();
    } else if (input && typeof input === 'object' && typeof input.command === 'string') {
      command = input.command.trim();
    }

    if (!command) {
      return false;
    }

    return command.startsWith(allowedPrefix);
  }

  return false;
}

/**
 * Maps CLI options to SDK-compatible options format
 * @param {Object} options - CLI options
 * @returns {Object} SDK-compatible options
 */
function mapCliOptionsToSDK(options = {}) {
  const { sessionId, cwd, toolsSettings, permissionMode } = options;

  const sdkOptions = {};

  // Forward all host env vars (e.g. ANTHROPIC_BASE_URL) to the subprocess.
  // Since SDK 0.2.113, options.env replaces process.env instead of overlaying it.
  sdkOptions.env = { ...process.env };

  // Resolve the executable eagerly on Windows because the SDK uses raw child_process.spawn,
  // which does not reliably follow npm's shell wrappers like cross-spawn does.
  sdkOptions.pathToClaudeCodeExecutable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);

  // Map working directory. If the requested cwd does not exist on disk (e.g. Beyond
  // Brain frontend hardcodes a macOS path from the upstream author), fall back to the
  // local brain repo via BEYOND_BRAIN_PATH so spawn does not fail with ENOENT and
  // surface as the misleading "native binary exists but failed to launch".
  const resolvedCwd = resolveSpawnCwd(cwd);
  if (resolvedCwd) {
    sdkOptions.cwd = resolvedCwd;
  }

  // Map permission mode
  if (permissionMode && permissionMode !== 'default') {
    sdkOptions.permissionMode = permissionMode;
  }

  // Map tool settings
  const settings = toolsSettings || {
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false
  };

  // Handle tool permissions
  if (settings.skipPermissions && permissionMode !== 'plan') {
    // When skipping permissions, use bypassPermissions mode
    sdkOptions.permissionMode = 'bypassPermissions';
  }

  let allowedTools = [...(settings.allowedTools || [])];

  // Add plan mode default tools
  if (permissionMode === 'plan') {
    const planModeTools = ['Read', 'Task', 'exit_plan_mode', 'TodoRead', 'TodoWrite', 'WebFetch', 'WebSearch'];
    for (const tool of planModeTools) {
      if (!allowedTools.includes(tool)) {
        allowedTools.push(tool);
      }
    }
  }

  sdkOptions.allowedTools = allowedTools;

  // Use the tools preset to make all default built-in tools available (including AskUserQuestion).
  // This was introduced in SDK 0.1.57. Omitting this preserves existing behavior (all tools available),
  // but being explicit ensures forward compatibility and clarity.
  sdkOptions.tools = { type: 'preset', preset: 'claude_code' };

  sdkOptions.disallowedTools = settings.disallowedTools || [];

  // Map model (default to sonnet)
  // Valid models: sonnet, opus, haiku, opusplan, sonnet[1m]
  sdkOptions.model = options.model || CLAUDE_MODELS.DEFAULT;
  // Model logged at query start below

  // Map system prompt configuration
  sdkOptions.systemPrompt = {
    type: 'preset',
    preset: 'claude_code'  // Required to use CLAUDE.md
  };

  // Map setting sources for CLAUDE.md loading
  // This loads CLAUDE.md from project, user (~/.config/claude/CLAUDE.md), and local directories
  sdkOptions.settingSources = ['project', 'user', 'local'];

  // Force auto-compact ON so long-running sessions automatically summarize the
  // conversation when the model's context fills up. Without this, the SDK
  // could either error or silently truncate; with it, Claude emits a
  // `compact_boundary` system message and continues seamlessly.
  // `BEYOND_AUTO_COMPACT=0` opts out (e.g. for debugging).
  //
  // We also override `autoCompactThreshold` to ~80% of the token budget
  // (default 200k → compact at 160k) instead of letting the SDK pick a
  // threshold based on the model's full context window (1M would compact at
  // ~800k, late for a chat that should stay snappy and predictable in cost).
  if (process.env.BEYOND_AUTO_COMPACT !== '0') {
    sdkOptions.settings = {
      ...(typeof sdkOptions.settings === 'object' && sdkOptions.settings ? sdkOptions.settings : {}),
      autoCompactEnabled: true,
      autoCompactThreshold: autoCompactThreshold(),
    };
  }

  // Map resume session
  if (sessionId) {
    sdkOptions.resume = sessionId;
  }

  // Stream raw content_block_delta events so the UI can render text as it's
  // produced (the Claude provider normalizer maps them to `stream_delta`).
  if (options.includePartialMessages !== false) {
    sdkOptions.includePartialMessages = true;
  }

  return sdkOptions;
}

/**
 * Adds a session to the active sessions map
 * @param {string} sessionId - Session identifier
 * @param {Object} queryInstance - SDK query instance
 * @param {Array<string>} tempImagePaths - Temp image file paths for cleanup
 * @param {string} tempDir - Temp directory for cleanup
 */
function addSession(sessionId, queryInstance, tempImagePaths = [], tempDir = null, writer = null) {
  activeSessions.set(sessionId, {
    instance: queryInstance,
    startTime: Date.now(),
    status: 'active',
    tempImagePaths,
    tempDir,
    writer
  });
}

/**
 * Removes a session from the active sessions map
 * @param {string} sessionId - Session identifier
 */
function removeSession(sessionId) {
  activeSessions.delete(sessionId);
}

/**
 * Gets a session from the active sessions map
 * @param {string} sessionId - Session identifier
 * @returns {Object|undefined} Session data or undefined
 */
function getSession(sessionId) {
  return activeSessions.get(sessionId);
}

/**
 * Gets all active session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getAllSessions() {
  return Array.from(activeSessions.keys());
}

/**
 * Transforms SDK messages to WebSocket format expected by frontend
 * @param {Object} sdkMessage - SDK message object
 * @returns {Object} Transformed message ready for WebSocket
 */
function transformMessage(sdkMessage) {
  // Extract parent_tool_use_id for subagent tool grouping
  if (sdkMessage.parent_tool_use_id) {
    return {
      ...sdkMessage,
      parentToolUseId: sdkMessage.parent_tool_use_id
    };
  }
  return sdkMessage;
}

/**
 * What the browser gets for one SDK message. With partial messages on, the
 * SDK wraps each API stream event as `{ type: 'stream_event', event }`; the
 * normalizer reads the inner event, so the text reaches the screen word by
 * word instead of only when the whole reply is done. Sub-agent output stays
 * out of the main bubble; it is summarised by its tool step.
 */
function normalizeForBrowser(message, sessionId) {
  const transformed = transformMessage(message);
  let raw = transformed;
  if (message.type === 'stream_event') {
    if (message.parent_tool_use_id) return [];
    raw = message.event;
    if (!raw || typeof raw !== 'object') return [];
  }
  const normalized = sessionsService.normalizeMessage('claude', raw, sessionId);
  for (const msg of normalized) {
    // Preserve parentToolUseId from the SDK wrapper for subagent tool grouping.
    if (transformed.parentToolUseId && !msg.parentToolUseId) {
      msg.parentToolUseId = transformed.parentToolUseId;
    }
  }
  return normalized;
}

/**
 * Extracts token usage from SDK result messages
 * @param {Object} resultMessage - SDK result message
 * @returns {Object|null} Token budget object or null
 */
function extractTokenBudget(resultMessage) {
  if (resultMessage.type !== 'result' || !resultMessage.modelUsage) {
    return null;
  }

  // Get the first model's usage data
  const modelKey = Object.keys(resultMessage.modelUsage)[0];
  const modelData = resultMessage.modelUsage[modelKey];

  if (!modelData) {
    return null;
  }

  // Use cumulative tokens if available (tracks total for the session)
  // Otherwise fall back to per-request tokens
  const inputTokens = modelData.cumulativeInputTokens || modelData.inputTokens || 0;
  const outputTokens = modelData.cumulativeOutputTokens || modelData.outputTokens || 0;
  const cacheReadTokens = modelData.cumulativeCacheReadInputTokens || modelData.cacheReadInputTokens || 0;
  const cacheCreationTokens = modelData.cumulativeCacheCreationInputTokens || modelData.cacheCreationInputTokens || 0;

  // Total used = input + output + cache tokens
  const totalUsed = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;

  return {
    used: totalUsed,
    total: tokenBudgetTotal(),
    autoCompactThreshold: autoCompactThreshold(),
    isAutoCompactEnabled: true,
  };
}

/**
 * Handles image processing for SDK queries
 * Saves base64 images to temporary files and returns modified prompt with file paths
 * @param {string} command - Original user prompt
 * @param {Array} images - Array of image objects with base64 data
 * @param {string} cwd - Working directory for temp file creation
 * @returns {Promise<Object>} {modifiedCommand, tempImagePaths, tempDir}
 */
async function handleImages(command, images, cwd) {
  const tempImagePaths = [];
  let tempDir = null;

  if (!images || images.length === 0) {
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }

  try {
    // Create temp directory in the project directory. Apply resolveSpawnCwd so that
    // a non-existent frontend-supplied cwd (e.g. the upstream macOS hardcode) does not
    // cause LocalSystem to materialize a phantom user folder under C:\Users\<authorname>.
    const workingDir = resolveSpawnCwd(cwd) || process.cwd();
    tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });

    // Save each image to a temp file
    for (const [index, image] of images.entries()) {
      // Extract base64 data and mime type
      const matches = image.data.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        console.error('Invalid image data format');
        continue;
      }

      const [, mimeType, base64Data] = matches;
      const extension = mimeType.split('/')[1] || 'png';
      const filename = `image_${index}.${extension}`;
      const filepath = path.join(tempDir, filename);

      // Write base64 data to file
      await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
      tempImagePaths.push(filepath);
    }

    // Include the full image paths in the prompt
    let modifiedCommand = command;
    if (tempImagePaths.length > 0 && command && command.trim()) {
      const imageNote = `\n\n[Images provided at the following paths:]\n${tempImagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
      modifiedCommand = command + imageNote;
    }

    // Images processed
    return { modifiedCommand, tempImagePaths, tempDir };
  } catch (error) {
    console.error('Error processing images for SDK:', error);
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }
}

/**
 * Cleans up temporary image files
 * @param {Array<string>} tempImagePaths - Array of temp file paths to delete
 * @param {string} tempDir - Temp directory to remove
 */
async function cleanupTempFiles(tempImagePaths, tempDir) {
  if (!tempImagePaths || tempImagePaths.length === 0) {
    return;
  }

  try {
    // Delete individual temp files
    for (const imagePath of tempImagePaths) {
      await fs.unlink(imagePath).catch(err =>
        console.error(`Failed to delete temp image ${imagePath}:`, err)
      );
    }

    // Delete temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(err =>
        console.error(`Failed to delete temp directory ${tempDir}:`, err)
      );
    }

    // Temp files cleaned
  } catch (error) {
    console.error('Error during temp file cleanup:', error);
  }
}

/**
 * Loads MCP server configurations from ~/.claude.json
 * @param {string} cwd - Current working directory for project-specific configs
 * @returns {Object|null} MCP servers object or null if none found
 */
async function loadMcpConfig(cwd) {
  try {
    // Normalize cwd through resolveSpawnCwd so the upstream-hardcoded macOS path
    // from BeyondChat.tsx still resolves to the real brain repo on disk; otherwise
    // projects[cwd] lookup and <cwd>/.mcp.json read would both miss and return 0 MCPs.
    cwd = resolveSpawnCwd(cwd) || cwd;
    const claudeConfigPath = path.join(os.homedir(), '.claude.json');

    // Check if config file exists
    try {
      await fs.access(claudeConfigPath);
    } catch (error) {
      // File doesn't exist, return null
      // No config file
      return null;
    }

    // Read and parse config file
    let claudeConfig;
    try {
      const configContent = await fs.readFile(claudeConfigPath, 'utf8');
      claudeConfig = JSON.parse(configContent);
    } catch (error) {
      console.error('Failed to parse ~/.claude.json:', error.message);
      return null;
    }

    // Extract MCP servers (merge global, per-project from ~/.claude.json,
    // and the project's own `.mcp.json` if present).
    let mcpServers = {};

    // Add global MCP servers
    if (claudeConfig.mcpServers && typeof claudeConfig.mcpServers === 'object') {
      mcpServers = { ...claudeConfig.mcpServers };
    }

    // Project-specific MCP servers under `projects[<cwd>].mcpServers` in
    // ~/.claude.json (upstream code looked under `claudeProjects` which does
    // not exist — the actual key is `projects`).
    if (cwd) {
      const projects = claudeConfig.projects || claudeConfig.claudeProjects;
      if (projects) {
        // Try the exact cwd first, then a normalized variant (forward slashes)
        // because Windows vs POSIX path styles are both used in the wild.
        const candidates = [cwd, cwd.replace(/\\/g, '/'), cwd.replace(/\//g, '\\')];
        for (const k of candidates) {
          const projectConfig = projects[k];
          if (projectConfig && projectConfig.mcpServers && typeof projectConfig.mcpServers === 'object') {
            mcpServers = { ...mcpServers, ...projectConfig.mcpServers };
            break;
          }
        }
      }
    }

    // Project's own `.mcp.json` (committed into the repo, shared via git)
    if (cwd) {
      try {
        const localMcpPath = path.join(cwd, '.mcp.json');
        const raw = await fs.readFile(localMcpPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.mcpServers && typeof parsed.mcpServers === 'object') {
          mcpServers = { ...mcpServers, ...parsed.mcpServers };
        }
      } catch {
        /* missing or unreadable .mcp.json is fine */
      }
    }

    // Merge Beyond-native connectors (the in-app "Konektory" panel). These live
    // in a dedicated store — NOT in ~/.claude.json — so OAuth tokens never touch
    // a config file. OAuth access tokens are refreshed here so every turn gets a
    // live `Authorization: Bearer`.
    mcpServers = await mergeBeyondConnectors(mcpServers);

    // Return null if no servers found
    if (Object.keys(mcpServers).length === 0) {
      return null;
    }
    return mcpServers;
  } catch (error) {
    console.error('Error loading MCP config:', error.message);
    return null;
  }
}

/**
 * Fingerprint the auth-bearing parts of an mcpServers map (URL + Authorization
 * header + stdio command/args, per server key). Changes when a token is
 * refreshed, a connector is (re)authorized, added, or removed — i.e. exactly
 * when a live session needs its MCP set re-injected. Order-independent.
 */
function mcpAuthFingerprint(servers) {
  if (!servers || typeof servers !== 'object') return '';
  return Object.keys(servers)
    .sort()
    .map((k) => {
      const s = servers[k] || {};
      const auth = s.headers?.Authorization || s.headers?.authorization || '';
      const cmd = s.command ? `${s.command} ${(s.args || []).join(' ')}` : '';
      return `${k}|${s.url || ''}|${auth}|${cmd}`;
    })
    .join('\n');
}

/**
 * Keep a LIVE streaming session's MCP tokens fresh. Streaming mode injects the
 * OAuth bearer once when claude.exe spawns and then reuses the process for the
 * whole chat — so a token that expires mid-session (or a connector the user
 * re-authorized in the Konektory panel) would otherwise keep failing with
 * "token expired" until a brand-new chat. Before each turn we rebuild the MCP
 * map (which refreshes OAuth tokens via `refreshIfNeeded`) and, only when the
 * auth fingerprint actually changed, re-inject it into the running session with
 * `setMcpServers`. No change → no reconnect churn.
 */
async function refreshLiveMcpIfNeeded(entry) {
  try {
    const inst = entry?.queryInstance;
    if (!inst || typeof inst.setMcpServers !== 'function') return;
    const servers = (await loadMcpConfig(entry.initialOptions?.cwd)) || {};
    const fp = mcpAuthFingerprint(servers);
    if (fp === entry.mcpAuthFingerprint) return; // tokens + server set unchanged
    await inst.setMcpServers(servers);
    entry.mcpAuthFingerprint = fp;
    console.log('[beyond-mcp] re-injected refreshed MCP tokens into live session:', entry.sdkSessionId || entry.chatKey);
  } catch (err) {
    // Best-effort: a failed refresh just means the turn runs with the previous
    // (possibly stale) token — no worse than before.
    console.warn('[beyond-mcp] live MCP refresh failed:', err?.message || err);
  }
}

/**
 * Slugify a connector display name into a stable MCP server key (which becomes
 * the `mcp__<key>__<tool>` tool prefix). Keeps it URL/identifier-safe and
 * avoids collisions with keys already in the map.
 */
function connectorKey(name, id, taken) {
  const base = String(name || 'connector')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'connector';
  if (!taken.has(base)) return base;
  return `${base}-${String(id).slice(0, 4)}`;
}

/**
 * Fold the enabled Beyond connectors into an mcpServers map, injecting fresh
 * OAuth bearer tokens. Best-effort per connector: one broken connector (e.g. an
 * OAuth token that can't refresh) is skipped and marked `needs_auth` rather than
 * failing the whole query.
 */
async function mergeBeyondConnectors(mcpServers) {
  let connectors;
  try {
    connectors = await listBeyondConnectors();
  } catch (err) {
    console.error('[beyond-mcp] failed to load connectors:', err?.message);
    return mcpServers;
  }

  const taken = new Set(Object.keys(mcpServers));
  for (const c of connectors) {
    if (!c.enabled) continue;
    try {
      let entry = null;
      if (c.transport === 'stdio') {
        if (!c.command) continue;
        entry = { type: 'stdio', command: c.command, args: c.args || [], env: c.env || {} };
      } else {
        if (!c.url) continue;
        const headers = { ...(c.headers || {}) };
        if (c.auth === 'oauth') {
          const token = await refreshBeyondConnectorToken(c).catch(() => null);
          if (!token) {
            await updateBeyondConnector(c.id, { status: 'needs_auth' }).catch(() => {});
            continue;
          }
          headers.Authorization = `Bearer ${token}`;
        }
        entry = { type: c.transport, url: c.url, headers };
      }
      if (!entry) continue;
      const key = connectorKey(c.name, c.id, taken);
      taken.add(key);
      mcpServers[key] = entry;
    } catch (err) {
      console.error(`[beyond-mcp] skipping connector "${c.name}":`, err?.message);
    }
  }
  return mcpServers;
}

/**
 * Top-level dispatcher: routes to streaming-input mode when possible (keeps
 * claude.exe alive across turns → cache stays warm, MCPs stay connected, no
 * spawn churn), otherwise falls through to the legacy one-shot path.
 *
 * Opt out of streaming with `BEYOND_STREAMING_INPUT=0` env var (e.g. for
 * debugging the legacy path or comparing token usage A/B).
 */
async function queryClaudeSDK(command, options = {}, ws) {
  if (process.env.BEYOND_STREAMING_INPUT === '0') {
    return queryClaudeSDKOneShot(command, options, ws);
  }
  return queryClaudeSDKStreaming(command, options, ws);
}

/**
 * Streaming-input mode: a single long-running `query()` per (user, sessionId)
 * chat. The first message spawns the process; subsequent messages push into
 * the iterable that the SDK consumes as the conversation, so the process
 * never restarts and Anthropic's prompt cache stays warm across turns.
 */
// How long to keep a streaming session (and its claude.exe) alive after the
// browser's WebSocket drops, so a backgrounded tab / flaky network doesn't kill
// an in-flight answer. The turn keeps running and persists to the transcript;
// when the browser reconnects it re-attaches (see reconnectSessionWriter) and
// reloads history. Override with BEYOND_WS_GRACE_MS.
const BEYOND_WS_GRACE_MS =
  process.env.BEYOND_WS_GRACE_MS !== undefined
    ? parseInt(process.env.BEYOND_WS_GRACE_MS, 10)
    : 5 * 60 * 1000;

// A turn with no message from the SDK for this long is treated as dead.
// Long tool calls send tool events, a retry sends api_retry, so silence of
// this length means the process is stuck.
const BEYOND_TURN_STALL_MS = parseInt(process.env.BEYOND_TURN_STALL_MS, 10) || 8 * 60 * 1000;

/** End a detached streaming session after the grace window, unless it
 *  reconnected or already finished in the meantime. */
function scheduleBeyondGraceEnd(entry) {
  if (entry.graceTimer) clearTimeout(entry.graceTimer);
  entry.graceTimer = setTimeout(() => {
    entry.graceTimer = null;
    if (!entry.wsAlive && !entry.ended) {
      console.log('[beyond-stream] grace expired, ending session:', entry.sdkSessionId || entry.chatKey);
      try { entry.inputQueue.end(); } catch { /* already ended */ }
    }
  }, BEYOND_WS_GRACE_MS);
  // Don't let the timer keep the process alive on shutdown.
  if (entry.graceTimer && typeof entry.graceTimer.unref === 'function') entry.graceTimer.unref();
}

/** Point a streaming session at a (new) browser WebSocket and (re)arm the
 *  detach-on-close grace. Used at spawn, on every turn, and on reconnect —
 *  so a dropped socket detaches (grace) instead of killing the turn. */
function attachWsToBeyondEntry(entry, ws) {
  entry.ws = ws || null;
  entry.wsAlive = Boolean(ws);
  if (entry.graceTimer) { clearTimeout(entry.graceTimer); entry.graceTimer = null; }
  if (ws && typeof ws.on === 'function') {
    ws.on('close', () => {
      // Only react if this exact socket is still the attached one (a later
      // reconnect may have already swapped in a fresh ws).
      if (entry.ws === ws) {
        entry.ws = null;
        entry.wsAlive = false;
        scheduleBeyondGraceEnd(entry);
      }
    });
  }
}

/** Is a Beyond streaming turn still in-flight for this (user, session)? Lets a
 *  reconnecting browser tell "answer still generating" from "already finished
 *  while I was away" so it clears its spinner correctly. */
function isBeyondTurnActive(sessionId, userId = null) {
  if (!sessionId) return false;
  const entry = beyondStreamSessions.get(beyondChatKey(userId, sessionId));
  return Boolean(entry && !entry.ended && entry.pendingTurnResolves.length > 0);
}

/** How many chat turns are in flight right now, across all people. A deploy
 *  asks this before restarting the service, so a restart never cuts a reply. */
/** The live streaming sessions, for /health and the diagnose workflow. */
function describeBeyondStreams() {
  const out = [];
  for (const entry of beyondStreamSessions.values()) {
    out.push({
      session: entry.sdkSessionId || entry.chatKey,
      turns: entry.pendingTurnResolves.length,
      ended: Boolean(entry.ended),
      wsAlive: Boolean(entry.wsAlive),
      idleSec: Math.round((Date.now() - (entry.lastMessageAt || entry.lastActivity || Date.now())) / 1000),
    });
  }
  return out;
}

function countActiveBeyondTurns() {
  let n = 0;
  for (const entry of beyondStreamSessions.values()) {
    if (!entry.ended && entry.pendingTurnResolves.length > 0) n += 1;
  }
  return n;
}

/** Re-attach a reconnected browser to its live streaming session, if any.
 *  Returns true when a Beyond stream entry was found and re-pointed. */
function reattachBeyondStream(sessionId, newWs) {
  if (!sessionId) return false;
  const key = beyondChatKey(newWs?.userId || null, sessionId);
  const entry = beyondStreamSessions.get(key);
  if (!entry || entry.ended) return false;
  attachWsToBeyondEntry(entry, newWs);
  if (newWs?.setSessionId && typeof newWs.setSessionId === 'function') {
    newWs.setSessionId(sessionId);
  }
  console.log('[beyond-stream] re-attached browser to live session:', sessionId);
  return true;
}

async function queryClaudeSDKStreaming(command, options = {}, ws) {
  const userId = ws?.userId || null;
  const { sessionId } = options;

  // If we have an existing streaming entry for this chat, push the new user
  // message to its iterable and await the next `result` event.
  if (sessionId) {
    const key = beyondChatKey(userId, sessionId);
    const existing = beyondStreamSessions.get(key);
    if (existing && !existing.ended && !existing.inputQueue.closed) {
      return runTurnOnBeyondStream(existing, command, options, ws);
    }
  }

  // Otherwise spawn a new streaming session — this becomes the long-running
  // process that subsequent turns of the same chat will reuse.
  return startNewBeyondStream(command, options, ws);
}

/**
 * Build the user-message payload that the SDK's streaming iterator consumes.
 * Also handles image attachments by writing them to a temp dir under the cwd
 * (legacy behavior); the resulting `tempImagePaths` are stashed on the entry
 * for later cleanup when the session ends.
 */
async function buildBeyondUserMessage(command, options, entry) {
  const imageResult = await handleImages(command, options.images, options.cwd);
  if (imageResult.tempImagePaths?.length) {
    entry.tempImagePaths.push(...imageResult.tempImagePaths);
  }
  if (imageResult.tempDir) {
    entry.tempDir = imageResult.tempDir;
  }
  return {
    type: 'user',
    message: {
      role: 'user',
      content: imageResult.modifiedCommand || command,
    },
  };
}

/**
 * Push a single user turn onto an already-running streaming session and
 * resolve when the SDK emits the `result` event marking the end of that turn.
 */
function runTurnOnBeyondStream(entry, command, options, ws) {
  return new Promise((resolve, reject) => {
    // Update the entry's ws reference — between turns the browser may have
    // reconnected, in which case hooks/canUseTool/sends should target the
    // newest writer. Same for sessionSummary in case the chat was renamed.
    attachWsToBeyondEntry(entry, ws);
    entry.lastActivity = Date.now();
    if (options.sessionSummary) entry.sessionSummary = options.sessionSummary;

    // Track this turn's completion. The background iteration loop will pop
    // and resolve from `pendingTurnResolves` when the next `result` arrives.
    entry.pendingTurnResolves.push(resolve);

    // If the bg loop already exited (process died), reject this turn so
    // queryClaudeSDK falls back instead of hanging the WS.
    if (entry.ended) {
      entry.pendingTurnResolves = entry.pendingTurnResolves.filter((r) => r !== resolve);
      reject(new Error('Beyond stream session ended before turn ran'));
      return;
    }

    // Push the actual message. The async builder may resolve after we set up
    // the resolver above, which is fine — order to the SDK is preserved by
    // the inputQueue, not by call order. First refresh MCP OAuth tokens so a
    // long-lived session never sends an expired bearer (BEO/Notion/etc.).
    refreshLiveMcpIfNeeded(entry)
      .then(() => buildBeyondUserMessage(command, options, entry))
      .then((msg) => {
        if (entry.sdkSessionId) recordSdkMessage(entry.sdkSessionId, msg);
        else entry.pendingHistoryUser?.push(msg);
        if (!entry.inputQueue.push(msg)) {
          entry.pendingTurnResolves = entry.pendingTurnResolves.filter((r) => r !== resolve);
          reject(new Error('Beyond stream input queue closed mid-turn'));
        }
      })
      .catch((err) => {
        entry.pendingTurnResolves = entry.pendingTurnResolves.filter((r) => r !== resolve);
        reject(err);
      });
  });
}

/* ------------------------------------------------------------------ */
/* Beyond layer: app tools, agent memory, searchable history           */
/* ------------------------------------------------------------------ */

/**
 * Give a run the tools it has over the app itself (schedule, history, memory,
 * skill proposals) and its own notes in the system prompt. Same for chat,
 * Telegram and scheduled runs; the context says who is asking and what they
 * may do. The memory block is read once here, so it is frozen for the session
 * and the prompt prefix stays cacheable.
 */
async function attachBeyondLayer(sdkOptions, ctx = {}) {
  let jobsApi = null;
  try {
    const mod = await import('./services/beyond-scheduler.js');
    jobsApi = mod.jobsApi();
  } catch (err) {
    console.warn('[beyond] jobsApi není k dispozici:', err?.message || err);
  }
  try {
    const server = buildBeyondToolsServer({ ...ctx, jobsApi });
    sdkOptions.mcpServers = { ...(sdkOptions.mcpServers || {}), beyond: server };
  } catch (err) {
    console.warn('[beyond] nástroje agenta se nepodařilo připojit:', err?.message || err);
  }
  let block = '';
  try {
    block = memoryPromptBlock();
  } catch (err) {
    console.warn('[beyond] paměť agenta se nedá načíst:', err?.message || err);
  }
  const extra = [ctx.systemPromptAppend, block].filter(Boolean).join('\n\n');
  if (extra) {
    const base = sdkOptions.systemPrompt && typeof sdkOptions.systemPrompt === 'object'
      ? sdkOptions.systemPrompt
      : { type: 'preset', preset: 'claude_code' };
    sdkOptions.systemPrompt = { ...base, append: [base.append, extra].filter(Boolean).join('\n\n') };
  }
  // Our own tools never need a permission prompt; they are the app talking to itself.
  const allowed = Array.isArray(sdkOptions.allowedTools) ? sdkOptions.allowedTools : [];
  for (const name of BEYOND_TOOL_NAMES) if (!allowed.includes(name)) allowed.push(name);
  sdkOptions.allowedTools = allowed;
}

/** Put one SDK message into the searchable history. Never throws. */
function recordSdkMessage(sessionId, message) {
  if (!sessionId || !message) return;
  try {
    if (message.type === 'assistant' && Array.isArray(message.message?.content)) {
      for (const block of message.message.content) {
        if (block.type === 'text' && block.text?.trim()) {
          recordHistory({ sessionId, role: 'assistant', content: block.text });
        } else if (block.type === 'tool_use' && block.name) {
          const input = block.input ? JSON.stringify(block.input).slice(0, 600) : '';
          recordHistory({ sessionId, role: 'tool', content: `${block.name} ${input}`.trim(), toolName: block.name });
        }
      }
    } else if (message.type === 'user' && message.message) {
      const c = message.message.content;
      if (typeof c === 'string') recordHistory({ sessionId, role: 'user', content: c });
      else if (Array.isArray(c)) {
        for (const block of c) {
          if (block.type === 'text' && block.text?.trim()) recordHistory({ sessionId, role: 'user', content: block.text });
        }
      }
    }
  } catch (err) {
    console.warn('[beyond] historie: zápis selhal', err?.message || err);
  }
}

/**
 * Start a brand-new streaming session for a chat. Spawns claude.exe via the
 * SDK in streaming-input mode, sets up hooks/canUseTool that close over the
 * entry (so they can reach the latest ws on every turn), and runs the SDK
 * message-iteration loop in the background until the iterator is closed.
 *
 * Returns a promise that resolves when the FIRST turn finishes (so the WS
 * `claude-command` handler unblocks at the same point as in legacy mode).
 */
async function startNewBeyondStream(command, options, ws) {
  const userId = ws?.userId || null;
  const tempKey = `temp:${++beyondTempKeyCounter}:${Date.now()}`;

  const entry = {
    chatKey: options.sessionId ? beyondChatKey(userId, options.sessionId) : tempKey,
    userId,
    inputQueue: createBeyondMessageQueue(),
    queryInstance: null,
    sdkSessionId: options.sessionId || null,
    sessionCreatedSent: Boolean(options.sessionId), // suppress dup `session_created` on resume
    sessionSummary: options.sessionSummary,
    ws,
    initialOptions: options,
    ended: false,
    lastActivity: Date.now(),
    tempImagePaths: [],
    tempDir: null,
    pendingTurnResolves: [],
    sdkOptions: null,
    iterationDone: null,
  };
  beyondStreamSessions.set(entry.chatKey, entry);

  // Build sdkOptions. Hooks + canUseTool close over `entry` so they always
  // read the latest ws / sdkSessionId on each invocation.
  const sdkOptions = mapCliOptionsToSDK(options);
  entry.sdkOptions = sdkOptions;

  // MCP config + strict mode (same as one-shot path)
  const mcpServers = await loadMcpConfig(options.cwd);
  if (mcpServers) {
    sdkOptions.mcpServers = mcpServers;
  }
  // Remember what we injected so later turns only reconnect when a token was
  // refreshed / a connector re-authorized (see refreshLiveMcpIfNeeded).
  entry.mcpAuthFingerprint = mcpAuthFingerprint(mcpServers || {});
  if (process.env.BEYOND_STRICT_MCP !== '0') {
    sdkOptions.strictMcpConfig = true;
  }
  await attachBeyondLayer(sdkOptions, {
    source: 'chat',
    actor: ws?.username || ws?.userId || 'chat',
    label: options.sessionSummary || null,
  });
  entry.historyUser = ws?.username || null;
  entry.pendingHistoryUser = [];

  sdkOptions.hooks = {
    Notification: [{
      matcher: '',
      hooks: [async (input) => {
        const message = typeof input?.message === 'string' ? input.message : 'Claude requires your attention.';
        notifyUserIfEnabled({
          userId: entry.ws?.userId || null,
          writer: entry.ws,
          event: createNotificationEvent({
            provider: 'claude',
            sessionId: entry.sdkSessionId,
            kind: 'action_required',
            code: 'agent.notification',
            meta: { message, sessionName: entry.sessionSummary },
            severity: 'warning',
            requiresUserAction: true,
            dedupeKey: `claude:hook:notification:${entry.sdkSessionId || 'none'}:${message}`,
          }),
        });
        return {};
      }],
    }],
  };

  sdkOptions.canUseTool = async (toolName, input, context) => {
    const requiresInteraction = TOOLS_REQUIRING_INTERACTION.has(toolName);
    if (!requiresInteraction) {
      if (sdkOptions.permissionMode === 'bypassPermissions') {
        return { behavior: 'allow', updatedInput: input };
      }
      const isDisallowed = (sdkOptions.disallowedTools || []).some((e) =>
        matchesToolPermission(e, toolName, input),
      );
      if (isDisallowed) return { behavior: 'deny', message: 'Tool disallowed by settings' };
      const isAllowed = (sdkOptions.allowedTools || []).some((e) =>
        matchesToolPermission(e, toolName, input),
      );
      if (isAllowed) return { behavior: 'allow', updatedInput: input };
    }
    const requestId = createRequestId();
    entry.ws?.send(createNormalizedMessage({
      kind: 'permission_request',
      requestId,
      toolName,
      input,
      sessionId: entry.sdkSessionId,
      provider: 'claude',
    }));
    const decision = await waitForToolApproval(requestId, {
      timeoutMs: requiresInteraction ? 0 : undefined,
      signal: context?.signal,
      onCancel: (reason) => {
        entry.ws?.send(createNormalizedMessage({
          kind: 'permission_cancelled',
          requestId,
          reason,
          sessionId: entry.sdkSessionId,
          provider: 'claude',
        }));
      },
    });
    if (!decision) return { behavior: 'deny', message: 'Permission request timed out' };
    if (decision.cancelled) return { behavior: 'deny', message: 'Permission request cancelled' };
    if (decision.allow) {
      if (decision.rememberEntry && typeof decision.rememberEntry === 'string') {
        if (!sdkOptions.allowedTools.includes(decision.rememberEntry)) {
          sdkOptions.allowedTools.push(decision.rememberEntry);
        }
        if (Array.isArray(sdkOptions.disallowedTools)) {
          sdkOptions.disallowedTools = sdkOptions.disallowedTools.filter((e) => e !== decision.rememberEntry);
        }
      }
      return { behavior: 'allow', updatedInput: decision.updatedInput ?? input };
    }
    return { behavior: 'deny', message: decision.message ?? 'User denied tool use' };
  };

  // Push the initial user message before spawning so the iterator yields
  // it on first read.
  const firstUserMsg = await buildBeyondUserMessage(command, options, entry);
  entry.pendingHistoryUser.push(firstUserMsg);
  entry.inputQueue.push(firstUserMsg);

  // Spawn the SDK in streaming-input mode by passing the iterable as prompt.
  const prevStreamTimeout = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
  process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000';
  try {
    entry.queryInstance = query({ prompt: entry.inputQueue, options: sdkOptions });
  } catch (err) {
    console.warn('[beyond-stream] query() init failed, retrying without hooks:', err?.message || err);
    delete sdkOptions.hooks;
    entry.queryInstance = query({ prompt: entry.inputQueue, options: sdkOptions });
  } finally {
    if (prevStreamTimeout !== undefined) {
      process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = prevStreamTimeout;
    } else {
      delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    }
  }

  // Register in activeSessions so existing abort code (`abort-session` WS
  // message → abortClaudeSDKSession) still finds it.
  if (entry.sdkSessionId) {
    addSession(entry.sdkSessionId, entry.queryInstance, entry.tempImagePaths, entry.tempDir, ws);
  }

  // Attach the browser ws with a detach-on-close GRACE window: a dropped socket
  // (backgrounded tab, flaky network) no longer kills the in-flight turn — the
  // answer keeps generating + persisting, and a reconnect re-attaches. The
  // session is only torn down if nobody reconnects within BEYOND_WS_GRACE_MS.
  attachWsToBeyondEntry(entry, ws);

  // The first turn's promise — resolves when SDK emits the first `result`.
  const firstTurnPromise = new Promise((resolve, reject) => {
    entry.pendingTurnResolves.push(resolve);
    entry.firstTurnReject = reject;
  });

  // A turn that stays silent for too long is over, whatever the process
  // thinks: tell the person, resolve the turn, and end this entry so the next
  // message starts a fresh process instead of queueing behind a stuck one.
  entry.lastMessageAt = Date.now();
  entry.stallTimer = setInterval(() => {
    if (entry.ended || entry.pendingTurnResolves.length === 0) return;
    if (Date.now() - entry.lastMessageAt < BEYOND_TURN_STALL_MS) return;
    console.warn('[beyond-stream] turn stalled, ending session:', entry.sdkSessionId || entry.chatKey);
    try {
      entry.ws?.send(createNormalizedMessage({
        kind: 'error',
        content: `Model ${Math.round(BEYOND_TURN_STALL_MS / 60000)} minut nic neposlal, odpověď ukončuji. Pošli zprávu znovu.`,
        sessionId: entry.sdkSessionId,
        provider: 'claude',
      }));
    } catch { /* ws gone */ }
    const pending = entry.pendingTurnResolves.splice(0);
    pending.forEach((res) => res(undefined));
    try { entry.inputQueue.end(); } catch { /* already ended */ }
    entry.queryInstance?.interrupt?.().catch?.(() => {});
  }, 15_000);
  if (typeof entry.stallTimer.unref === 'function') entry.stallTimer.unref();

  // Background iteration loop — runs for the lifetime of the chat session.
  entry.iterationDone = (async () => {
    console.log('[beyond-stream] starting iteration for session:', entry.sdkSessionId || tempKey);
    try {
      for await (const message of entry.queryInstance) {
        await handleBeyondStreamMessage(entry, message);
      }
    } catch (err) {
      console.error('[beyond-stream] iteration error:', err);
      try {
        entry.ws?.send(createNormalizedMessage({
          kind: 'error',
          content: err?.message || 'Streaming session error',
          sessionId: entry.sdkSessionId,
          provider: 'claude',
        }));
      } catch { /* ws may be gone */ }
      // Reject any pending turn so the caller doesn't hang.
      const pending = entry.pendingTurnResolves.splice(0);
      const turnErr = err instanceof Error ? err : new Error(String(err));
      pending.forEach((res) => res(undefined)); // resolve undefined so WS handler unblocks
      void turnErr;
    } finally {
      entry.ended = true;
      if (entry.stallTimer) { clearInterval(entry.stallTimer); entry.stallTimer = null; }
      if (entry.graceTimer) { clearTimeout(entry.graceTimer); entry.graceTimer = null; }
      beyondStreamSessions.delete(entry.chatKey);
      if (entry.sdkSessionId) removeSession(entry.sdkSessionId);
      await cleanupTempFiles(entry.tempImagePaths, entry.tempDir);
      console.log('[beyond-stream] iteration ended for session:', entry.sdkSessionId || tempKey);
    }
  })();

  return firstTurnPromise;
}

/** What to tell the person when the model side failed, in their words. */
const SDK_ERROR_TEXT = {
  rate_limit: 'Účet Claude na stroji narazil na limit (rate limit). Zkus to za chvíli.',
  billing_error: 'Účet Claude hlásí problém s platbou nebo vyčerpaný limit.',
  authentication_failed: 'Přihlášení Claude na stroji vypršelo, je potřeba se znovu přihlásit (claude login).',
  oauth_org_not_allowed: 'Účet Claude na stroji nemá k tomuto modelu přístup.',
  server_error: 'Server Anthropic vrátil chybu. Pošli zprávu znovu.',
  max_output_tokens: 'Odpověď byla delší než povolený výstup, zkus ji rozdělit.',
  invalid_request: 'Server Anthropic požadavek odmítl (invalid request).',
  unknown: 'Model neodpověděl, důvod neznámý. Pošli zprávu znovu.',
};

/**
 * The messages that mean "nothing is coming, and here is why", turned into
 * something the person sees instead of a spinner that ends in silence:
 * a retry the CLI is doing on its own, an assistant turn that failed at
 * the API, or a result that carries an error (a spent session limit).
 * Returns the normalized messages to send, possibly none.
 */
function explainSdkTrouble(message, sessionId) {
  if (message.type === 'system' && message.subtype === 'api_retry') {
    const secs = Math.max(1, Math.round((message.retry_delay_ms || 0) / 1000));
    const what = message.error_status ? `API vrátila ${message.error_status}` : 'spojení k API selhalo';
    return [createNormalizedMessage({
      kind: 'status',
      text: 'api_retry',
      content: `${what}, pokus ${message.attempt} z ${message.max_retries}, znovu za ${secs} s`,
      sessionId,
      provider: 'claude',
    })];
  }
  if (message.type === 'assistant' && message.error) {
    return [createNormalizedMessage({
      kind: 'error',
      content: SDK_ERROR_TEXT[message.error] || `${SDK_ERROR_TEXT.unknown} (${message.error})`,
      sessionId,
      provider: 'claude',
    })];
  }
  if (message.type === 'result' && message.is_error) {
    const detail = Array.isArray(message.errors) && message.errors.length
      ? message.errors.join('; ')
      : typeof message.result === 'string' ? message.result : message.subtype || 'chyba';
    return [createNormalizedMessage({
      kind: 'error',
      content: detail,
      sessionId,
      provider: 'claude',
    })];
  }
  return [];
}

/**
 * Handle one SDK message in the background iteration loop of a streaming
 * session. Mirrors the message handling that the legacy one-shot path does
 * inside its `for await` loop, but with the extra plumbing for resolving
 * per-turn promises when `result` arrives.
 */
async function handleBeyondStreamMessage(entry, message) {
  // Capture SDK-assigned session UUID on first sight; emit session_created.
  if (message.session_id && !entry.sdkSessionId) {
    entry.sdkSessionId = message.session_id;
    // Re-key the registry under the SDK UUID (was a temp key).
    const newKey = beyondChatKey(entry.userId, entry.sdkSessionId);
    if (newKey !== entry.chatKey) {
      beyondStreamSessions.delete(entry.chatKey);
      entry.chatKey = newKey;
      beyondStreamSessions.set(newKey, entry);
    }
    addSession(entry.sdkSessionId, entry.queryInstance, entry.tempImagePaths, entry.tempDir, entry.ws);
    if (entry.ws?.setSessionId && typeof entry.ws.setSessionId === 'function') {
      entry.ws.setSessionId(entry.sdkSessionId);
    }
    if (!entry.sessionCreatedSent) {
      entry.sessionCreatedSent = true;
      entry.ws?.send(createNormalizedMessage({
        kind: 'session_created',
        newSessionId: entry.sdkSessionId,
        sessionId: entry.sdkSessionId,
        provider: 'claude',
      }));
    }
  }
  if (entry.sdkSessionId && !entry.historyTouched) {
    entry.historyTouched = true;
    try {
      touchHistorySession({ id: entry.sdkSessionId, source: 'chat', label: entry.sessionSummary || null, user: entry.historyUser });
    } catch { /* derived data, never fatal */ }
    for (const m of entry.pendingHistoryUser?.splice(0) || []) recordSdkMessage(entry.sdkSessionId, m);
  }
  if (message.type === 'assistant') recordSdkMessage(entry.sdkSessionId, message);

  entry.lastMessageAt = Date.now();

  // Normalize + forward to client.
  for (const msg of [...normalizeForBrowser(message, entry.sdkSessionId), ...explainSdkTrouble(message, entry.sdkSessionId)]) {
    try {
      entry.ws?.send(msg);
    } catch { /* ws gone */ }
  }

  // On turn end: live context usage + resolve the oldest pending turn.
  if (message.type === 'result') {
    let liveCtx = null;
    try {
      if (typeof entry.queryInstance?.getContextUsage === 'function') {
        const usage = await entry.queryInstance.getContextUsage();
        if (usage && typeof usage.totalTokens === 'number') {
          liveCtx = {
            used: usage.totalTokens,
            // Pin the displayed total to our Beyond budget rather than the
            // model's raw maxTokens — the UI chip needs the same denominator
            // as autoCompactThreshold so the percentage is meaningful.
            total: tokenBudgetTotal(),
            autoCompactThreshold: autoCompactThreshold(),
            isAutoCompactEnabled: Boolean(usage.isAutoCompactEnabled),
          };
        }
      }
    } catch (e) {
      console.warn('[beyond-stream] getContextUsage failed:', e?.message || e);
    }
    const payload = liveCtx || extractTokenBudget(message);
    if (payload) {
      entry.ws?.send(createNormalizedMessage({
        kind: 'status',
        text: 'token_budget',
        tokenBudget: payload,
        sessionId: entry.sdkSessionId,
        provider: 'claude',
      }));
    }
    // Tell the SDK to flush before we return — `complete` is sent so the UI
    // can stop the spinner exactly like in one-shot mode.
    entry.ws?.send(createNormalizedMessage({
      kind: 'complete',
      exitCode: 0,
      isNewSession: false,
      sessionId: entry.sdkSessionId,
      provider: 'claude',
    }));
    notifyRunStopped({
      userId: entry.ws?.userId || null,
      provider: 'claude',
      sessionId: entry.sdkSessionId,
      sessionName: entry.sessionSummary,
      stopReason: 'completed',
    });
    // Resolve the oldest pending turn — the corresponding WS handler can return.
    const resolver = entry.pendingTurnResolves.shift();
    if (resolver) resolver();
  }
}

/**
 * Legacy one-shot mode: each call spawns its own claude.exe, iterates to
 * completion, and cleans up. Kept as fallback under `BEYOND_STREAMING_INPUT=0`.
 */
async function queryClaudeSDKOneShot(command, options = {}, ws) {
  const { sessionId, sessionSummary } = options;
  let capturedSessionId = sessionId;
  let sessionCreatedSent = false;
  let tempImagePaths = [];
  let tempDir = null;

  const emitNotification = (event) => {
    notifyUserIfEnabled({
      userId: ws?.userId || null,
      writer: ws,
      event
    });
  };

  try {
    // Map CLI options to SDK format
    const sdkOptions = mapCliOptionsToSDK(options);

    // Load MCP configuration
    const mcpServers = await loadMcpConfig(options.cwd);
    if (mcpServers) {
      sdkOptions.mcpServers = mcpServers;
    }

    // Without `strictMcpConfig`, the SDK auto-loads every MCP server the user
    // has ever connected via claude.ai (Gmail, Drive, Notion, Supabase, Vercel,
    // Tally, Miro, Wix, Todoist, n8n MCP, …). Each one dumps a multi-KB tool
    // schema + instructions into the system prompt → tens of thousands of
    // tokens **every turn**, which Vlast hits as "session limit reached after
    // a few messages". With strict mode on, only the servers we explicitly
    // pass via `mcpServers` above (per-project user + .mcp.json) are loaded.
    // Opt out with `BEYOND_STRICT_MCP=0` if you ever need the full set back.
    if (process.env.BEYOND_STRICT_MCP !== '0') {
      sdkOptions.strictMcpConfig = true;
    }

    // Handle images - save to temp files and modify prompt
    const imageResult = await handleImages(command, options.images, options.cwd);
    const finalCommand = imageResult.modifiedCommand;
    tempImagePaths = imageResult.tempImagePaths;
    tempDir = imageResult.tempDir;

    sdkOptions.hooks = {
      Notification: [{
        matcher: '',
        hooks: [async (input) => {
          const message = typeof input?.message === 'string' ? input.message : 'Claude requires your attention.';
          emitNotification(createNotificationEvent({
            provider: 'claude',
            sessionId: capturedSessionId || sessionId || null,
            kind: 'action_required',
            code: 'agent.notification',
            meta: { message, sessionName: sessionSummary },
            severity: 'warning',
            requiresUserAction: true,
            dedupeKey: `claude:hook:notification:${capturedSessionId || sessionId || 'none'}:${message}`
          }));
          return {};
        }]
      }]
    };

    // Caveat: in 'auto' and 'bypassPermissions' modes the SDK resolves approval
    // at the permission-mode step and skips this callback, so interactive tools
    // (AskUserQuestion, ExitPlanMode) won't reach the UI — the classifier/bypass
    // auto-approves them and the model acts on a generated answer. Move these
    // tools to a PreToolUse hook (runs before the mode check) if we need them
    // to work in those modes.
    sdkOptions.canUseTool = async (toolName, input, context) => {
      const requiresInteraction = TOOLS_REQUIRING_INTERACTION.has(toolName);

      if (!requiresInteraction) {
        if (sdkOptions.permissionMode === 'bypassPermissions') {
          return { behavior: 'allow', updatedInput: input };
        }

        const isDisallowed = (sdkOptions.disallowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isDisallowed) {
          return { behavior: 'deny', message: 'Tool disallowed by settings' };
        }

        const isAllowed = (sdkOptions.allowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isAllowed) {
          return { behavior: 'allow', updatedInput: input };
        }
      }

      const requestId = createRequestId();
      ws.send(createNormalizedMessage({ kind: 'permission_request', requestId, toolName, input, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
      emitNotification(createNotificationEvent({
        provider: 'claude',
        sessionId: capturedSessionId || sessionId || null,
        kind: 'action_required',
        code: 'permission.required',
        meta: { toolName, sessionName: sessionSummary },
        severity: 'warning',
        requiresUserAction: true,
        dedupeKey: `claude:permission:${capturedSessionId || sessionId || 'none'}:${requestId}`
      }));

      const decision = await waitForToolApproval(requestId, {
        timeoutMs: requiresInteraction ? 0 : undefined,
        signal: context?.signal,
        metadata: {
          _sessionId: capturedSessionId || sessionId || null,
          _toolName: toolName,
          _input: input,
          _receivedAt: new Date(),
        },
        onCancel: (reason) => {
          ws.send(createNormalizedMessage({ kind: 'permission_cancelled', requestId, reason, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        }
      });
      if (!decision) {
        return { behavior: 'deny', message: 'Permission request timed out' };
      }

      if (decision.cancelled) {
        return { behavior: 'deny', message: 'Permission request cancelled' };
      }

      if (decision.allow) {
        if (decision.rememberEntry && typeof decision.rememberEntry === 'string') {
          if (!sdkOptions.allowedTools.includes(decision.rememberEntry)) {
            sdkOptions.allowedTools.push(decision.rememberEntry);
          }
          if (Array.isArray(sdkOptions.disallowedTools)) {
            sdkOptions.disallowedTools = sdkOptions.disallowedTools.filter(entry => entry !== decision.rememberEntry);
          }
        }
        return { behavior: 'allow', updatedInput: decision.updatedInput ?? input };
      }

      return { behavior: 'deny', message: decision.message ?? 'User denied tool use' };
    };

    // Set stream-close timeout for interactive tools (Query constructor reads it synchronously). Claude Agent SDK has a default of 5s and this overrides it
    const prevStreamTimeout = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000';

    let queryInstance;
    try {
      queryInstance = query({
        prompt: finalCommand,
        options: sdkOptions
      });
    } catch (hookError) {
      // Older/newer SDK versions may not accept hook shapes yet.
      // Keep notification behavior operational via runtime events even if hook registration fails.
      console.warn('Failed to initialize Claude query with hooks, retrying without hooks:', hookError?.message || hookError);
      delete sdkOptions.hooks;
      queryInstance = query({
        prompt: finalCommand,
        options: sdkOptions
      });
    }

    // Restore immediately — Query constructor already captured the value
    if (prevStreamTimeout !== undefined) {
      process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = prevStreamTimeout;
    } else {
      delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    }

    // Track the query instance for abort capability
    if (capturedSessionId) {
      addSession(capturedSessionId, queryInstance, tempImagePaths, tempDir, ws);
    }

    // Process streaming messages
    console.log('Starting async generator loop for session:', capturedSessionId || 'NEW');
    for await (const message of queryInstance) {
      // Capture session ID from first message
      if (message.session_id && !capturedSessionId) {

        capturedSessionId = message.session_id;
        addSession(capturedSessionId, queryInstance, tempImagePaths, tempDir, ws);

        // Set session ID on writer
        if (ws.setSessionId && typeof ws.setSessionId === 'function') {
          ws.setSessionId(capturedSessionId);
        }

        // Send session-created event only once for new sessions
        if (!sessionId && !sessionCreatedSent) {
          sessionCreatedSent = true;
          ws.send(createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'claude' }));
        }
      } else {
        // session_id already captured
      }

      // Transform and normalize message via adapter
      const sid = capturedSessionId || sessionId || null;
      for (const msg of [...normalizeForBrowser(message, sid), ...explainSdkTrouble(message, sid)]) {
        ws.send(msg);
      }

      // After each turn finishes, ask the SDK for live context size — this is
      // what auto-compact actually thresholds against, not the cumulative
      // input+output sum from result.modelUsage (which double-counts every
      // resumed turn). Falls back to extractTokenBudget if the SDK doesn't
      // expose getContextUsage (older versions, non-streaming mode, etc).
      if (message.type === 'result') {
        let liveCtx = null;
        try {
          if (typeof queryInstance?.getContextUsage === 'function') {
            const usage = await queryInstance.getContextUsage();
            if (usage && typeof usage.totalTokens === 'number') {
              liveCtx = {
                used: usage.totalTokens,
                total: tokenBudgetTotal(),
                autoCompactThreshold: autoCompactThreshold(),
                isAutoCompactEnabled: Boolean(usage.isAutoCompactEnabled),
              };
            }
          }
        } catch (e) {
          console.warn('[claude-sdk] getContextUsage failed, falling back to result.modelUsage', e?.message || e);
        }
        const payload = liveCtx || extractTokenBudget(message);
        if (payload) {
          ws.send(createNormalizedMessage({
            kind: 'status',
            text: 'token_budget',
            tokenBudget: payload,
            sessionId: capturedSessionId || sessionId || null,
            provider: 'claude',
          }));
        }
      }
    }

    // Clean up session on completion
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    // Clean up temporary image files
    await cleanupTempFiles(tempImagePaths, tempDir);

    // Send completion event
    ws.send(createNormalizedMessage({ kind: 'complete', exitCode: 0, isNewSession: !sessionId && !!command, sessionId: capturedSessionId, provider: 'claude' }));
    notifyRunStopped({
      userId: ws?.userId || null,
      provider: 'claude',
      sessionId: capturedSessionId || sessionId || null,
      sessionName: sessionSummary,
      stopReason: 'completed'
    });
    // Complete

  } catch (error) {
    console.error('SDK query error:', error);

    // Clean up session on error
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    // Clean up temporary image files on error
    await cleanupTempFiles(tempImagePaths, tempDir);

    // Auto-fallback: some session transcripts (e.g. those with queue-operation
    // entries at the head, written by interactive `claude` runs) cause the SDK
    // to throw `No conversation found with session ID: <uuid>` on resume even
    // though the file is intact and resumable via direct CLI. Retry once
    // without `resume`, so the user's prompt at least lands in a fresh session
    // instead of dead-ending with an error.
    const isResumeLookupFailure =
      sessionId &&
      !options._beyondFallbackTried &&
      typeof error?.message === 'string' &&
      /No conversation found with session ID:/i.test(error.message);
    if (isResumeLookupFailure) {
      console.warn(`[claude-sdk] resume failed for ${sessionId} — retrying as a fresh session`);
      ws.send(createNormalizedMessage({
        kind: 'status',
        text: 'session_lookup_failed_fallback',
        sessionId,
        provider: 'claude',
      }));
      const retryOptions = { ...options, _beyondFallbackTried: true };
      delete retryOptions.sessionId;
      // queueing on next tick so error-cleanup state above settles first
      await new Promise((resolve) => setImmediate(resolve));
      // Stay in the one-shot path for the retry — we're already inside it
      // and avoid re-dispatching back through the streaming router.
      return queryClaudeSDKOneShot(command, retryOptions, ws);
    }

    // Check if Claude CLI is installed for a clearer error message
    const installed = await providerAuthService.isProviderInstalled('claude');
    const errorContent = !installed
      ? 'Claude Code is not installed. Please install it first: https://docs.anthropic.com/en/docs/claude-code'
      : error.message;

    // Send error to WebSocket
    ws.send(createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
    notifyRunFailed({
      userId: ws?.userId || null,
      provider: 'claude',
      sessionId: capturedSessionId || sessionId || null,
      sessionName: sessionSummary,
      error
    });
  }
}

/**
 * Aborts an active SDK session
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session was aborted, false if not found
 */
async function abortClaudeSDKSession(sessionId) {
  const session = getSession(sessionId);

  if (!session) {
    console.log(`Session ${sessionId} not found`);
    return false;
  }

  try {
    console.log(`Aborting SDK session: ${sessionId}`);

    // Call interrupt() on the query instance
    await session.instance.interrupt();

    // Update session status
    session.status = 'aborted';

    // Clean up temporary image files
    await cleanupTempFiles(session.tempImagePaths, session.tempDir);

    // Clean up session
    removeSession(sessionId);

    return true;
  } catch (error) {
    console.error(`Error aborting session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Switch the model of a live SDK session in place. The Beyond chat reuses one
 * long-running claude.exe per session, so a model picked mid-thread would
 * otherwise only take effect on the next fresh process; `query.setModel` lets
 * the running session swap models without losing context.
 * @param {string} sessionId - Session identifier
 * @param {string} model - SDK model id (e.g. 'opus', 'sonnet', 'haiku')
 * @returns {Promise<boolean>} True if applied to a live session
 */
async function setClaudeSDKSessionModel(sessionId, model) {
  const session = getSession(sessionId);
  if (!session?.instance || typeof session.instance.setModel !== 'function') {
    return false;
  }
  try {
    await session.instance.setModel(model);
    return true;
  } catch (error) {
    console.error(`Error setting model for session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Apply the current MCP server set to a LIVE SDK session in place. Beyond reuses
 * one long-running claude.exe per session, so a connector added mid-thread would
 * otherwise only load on the next fresh process — forcing the user to start a new
 * chat and lose their context. `query.setMcpServers` connects the new servers
 * into the running session instead.
 * @param {string} sessionId - Session identifier
 * @param {string} cwd - Working directory (resolves project-scoped MCP config)
 * @returns {Promise<Object|null>} { added, removed, errors }, or null if the
 *   session isn't live (caller should fall back to "applies in a new chat")
 */
async function setClaudeSDKSessionMcpServers(sessionId, cwd) {
  const session = getSession(sessionId);
  if (!session?.instance || typeof session.instance.setMcpServers !== 'function') {
    return null;
  }
  // Send the FULL map a fresh spawn would get: setMcpServers *replaces* the
  // whole dynamic set, so passing only the new connector would disconnect the
  // ones already attached to this session.
  // Resolve the cwd the same way a fresh spawn would, so a caller passing a
  // stale or foreign path still reads the brain repo's .mcp.json instead of
  // silently finding nothing and detaching every connector.
  const servers = (await loadMcpConfig(resolveSpawnCwd(cwd))) || {};
  const result = await session.instance.setMcpServers(servers);
  return {
    added: result?.added || [],
    removed: result?.removed || [],
    errors: result?.errors || {},
  };
}

function normalizeModelInfos(models) {
  if (!Array.isArray(models)) return [];
  return models
    .filter((m) => m && typeof m.value === 'string')
    .map((m) => ({
      value: m.value,
      displayName: typeof m.displayName === 'string' ? m.displayName : m.value,
      description: typeof m.description === 'string' ? m.description : '',
    }));
}

/**
 * List the models the installed Claude Code offers, with their version-bearing
 * display names / descriptions (e.g. "Opus 4.7 with 1M context"). Cached after
 * the first successful fetch. Prefers an already-initialized session's query
 * instance; falls back to a short-lived throwaway spawn if none is active.
 * @returns {Promise<Array<{value: string, displayName: string, description: string}>>}
 */
async function getSupportedModels() {
  if (cachedSupportedModels) return cachedSupportedModels;

  // Reuse a live session if one exists — avoids spawning a throwaway process.
  for (const session of activeSessions.values()) {
    if (typeof session?.instance?.supportedModels === 'function') {
      try {
        const models = normalizeModelInfos(await session.instance.supportedModels());
        if (models.length) {
          cachedSupportedModels = models;
          return cachedSupportedModels;
        }
      } catch {
        /* fall through to a throwaway spawn */
      }
    }
  }

  // No live session — spawn a minimal query just to read the model list.
  const queue = createBeyondMessageQueue();
  let q;
  try {
    q = query({ prompt: queue, options: {} });
    const models = normalizeModelInfos(
      await Promise.race([
        q.supportedModels(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('supportedModels timeout')), 20000),
        ),
      ]),
    );
    if (models.length) {
      cachedSupportedModels = models;
      return cachedSupportedModels;
    }
    return [];
  } catch (err) {
    console.warn('[beyond] getSupportedModels failed:', err?.message || err);
    return [];
  } finally {
    try { queue.end(); } catch { /* ignore */ }
    try { await q?.interrupt?.(); } catch { /* ignore */ }
  }
}

/**
 * Checks if an SDK session is currently active
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session is active
 */
function isClaudeSDKSessionActive(sessionId) {
  const session = getSession(sessionId);
  return session && session.status === 'active';
}

/**
 * Gets all active SDK session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getActiveClaudeSDKSessions() {
  return getAllSessions();
}

/**
 * Get pending tool approvals for a specific session.
 * @param {string} sessionId - The session ID
 * @returns {Array} Array of pending permission request objects
 */
function getPendingApprovalsForSession(sessionId) {
  const pending = [];
  for (const [requestId, resolver] of pendingToolApprovals.entries()) {
    if (resolver._sessionId === sessionId) {
      pending.push({
        requestId,
        toolName: resolver._toolName || 'UnknownTool',
        input: resolver._input,
        context: resolver._context,
        sessionId,
        receivedAt: resolver._receivedAt || new Date(),
      });
    }
  }
  return pending;
}

/**
 * Reconnect a session's WebSocketWriter to a new raw WebSocket.
 * Called when client reconnects (e.g. page refresh) while SDK is still running.
 * @param {string} sessionId - The session ID
 * @param {Object} newRawWs - The new raw WebSocket connection
 * @returns {boolean} True if writer was successfully reconnected
 */
function reconnectSessionWriter(sessionId, newRawWs) {
  // Beyond streaming sessions send via `entry.ws` (not the legacy writer), so
  // re-point that first — this is what makes a reconnected browser resume
  // receiving a live answer after a socket drop.
  const beyondReattached = reattachBeyondStream(sessionId, newRawWs);

  const session = getSession(sessionId);
  if (session?.writer?.updateWebSocket) {
    session.writer.updateWebSocket(newRawWs);
    console.log(`[RECONNECT] Writer swapped for session ${sessionId}`);
    return true;
  }
  return beyondReattached;
}

/**
 * Single-shot Claude SDK invocation for non-interactive callers (Telegram
 * agent, scheduled briefs, future API consumers).
 *
 * Unlike `queryClaudeSDK`, this does not stream messages over a WebSocket —
 * it iterates the SDK output to completion, accumulates assistant text, and
 * resolves with a final `{text, sessionId, durationMs}`. Tool calls still
 * run inside the SDK (filesystem, web, etc.); only the conversation surface
 * is non-streaming. Bypass permissions is intended for trusted callers.
 *
 * @param {Object} params
 * @param {string} params.command - User prompt.
 * @param {string} [params.sessionId] - Resume a previous SDK session UUID.
 * @param {string} [params.cwd] - Working directory; falls back to BEYOND_BRAIN_PATH via resolveSpawnCwd.
 * @param {string} [params.model] - Override model (defaults to CLAUDE_MODELS.DEFAULT).
 * @param {string[]} [params.allowedTools] - Optional allow-list.
 * @param {string[]} [params.disallowedTools]
 * @param {boolean} [params.skipPermissions=true] - When true, runs in bypassPermissions mode (no human-in-loop prompts).
 * @param {AbortSignal} [params.signal] - External abort.
 * @param {Object} [params.onProgress] - Optional progress callbacks. Methods:
 *   `start()`, `toolUse(name, input)`. Called best-effort during the run so
 *   callers can stream status to Telegram, websockets, etc.
 * @returns {Promise<{text: string, sessionId: string|null, durationMs: number, model: string, finishReason: string|null, raw: object|null}>}
 */
async function runSdkOneShot({
  command,
  sessionId,
  cwd,
  model,
  allowedTools = [],
  disallowedTools = [],
  skipPermissions = true,
  signal,
  onProgress,
  loadMcp = true,
  beyond = null,
} = {}) {
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('runSdkOneShot: `command` is required.');
  }

  const resolvedCwd = resolveSpawnCwd(cwd);
  const resolvedExe = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);

  const sdkOptions = {
    env: { ...process.env },
    pathToClaudeCodeExecutable: resolvedExe,
    model: model || CLAUDE_MODELS.DEFAULT,
    tools: { type: 'preset', preset: 'claude_code' },
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    settingSources: ['project', 'user', 'local'],
    allowedTools,
    disallowedTools,
    includePartialMessages: false,
  };
  // Match the streaming path: enable auto-compact so long Telegram threads
  // summarize themselves at ~200k instead of erroring out on context overflow.
  // `BEYOND_AUTO_COMPACT=0` opts out (same env as streaming).
  if (process.env.BEYOND_AUTO_COMPACT !== '0') {
    sdkOptions.settings = { autoCompactEnabled: true };
  }
  if (resolvedCwd) sdkOptions.cwd = resolvedCwd;
  if (sessionId) sdkOptions.resume = sessionId;
  if (skipPermissions) sdkOptions.permissionMode = 'bypassPermissions';

  // MCP config — same loader as the streaming path. Without this, Telegram
  // queries land in the brain repo with zero MCP tools available. Callers that
  // don't need tools (e.g. generating a short chat title) pass `loadMcp:false`
  // to skip the connector startup cost entirely.
  const mcpServers = loadMcp ? await loadMcpConfig(resolvedCwd) : null;
  if (mcpServers) {
    sdkOptions.mcpServers = mcpServers;
    if (process.env.BEYOND_STRICT_MCP !== '0') {
      sdkOptions.strictMcpConfig = true;
    }
  }

  // The Beyond layer: app tools + agent memory + history. Callers that only
  // want a bare model turn (a chat title) pass nothing and get nothing.
  if (beyond) await attachBeyondLayer(sdkOptions, beyond);

  const startedAt = Date.now();
  let capturedSessionId = sessionId || null;
  let textChunks = [];
  let finishReason = null;
  let resultRaw = null;
  let historyOpen = false;
  const remember = (message) => {
    if (!beyond || !capturedSessionId) return;
    if (!historyOpen) {
      historyOpen = true;
      try {
        touchHistorySession({ id: capturedSessionId, source: beyond.source || 'job', label: beyond.label || null, user: beyond.actor || null });
      } catch { /* derived data */ }
      recordHistory({ sessionId: capturedSessionId, role: 'user', content: command });
    }
    if (message) recordSdkMessage(capturedSessionId, message);
  };

  const queryInstance = query({ prompt: command, options: sdkOptions });

  // Fire the progress "start" event right away — callers (Telegram emitter)
  // can immediately tell the user we're on it, well before the first SDK
  // message arrives.
  try {
    onProgress?.start?.();
  } catch (err) {
    console.warn('[runSdkOneShot] onProgress.start failed', err);
  }

  const abortHandler = () => {
    try {
      queryInstance.interrupt?.();
    } catch {
      /* ignore */
    }
  };
  if (signal) {
    if (signal.aborted) abortHandler();
    else signal.addEventListener('abort', abortHandler, { once: true });
  }

  try {
    for await (const message of queryInstance) {
      if (message.session_id && !capturedSessionId) {
        capturedSessionId = message.session_id;
      }
      if (message.type === 'assistant') remember(message);
      // SDK 0.2.x emits `assistant` messages with a content array of blocks
      // (text + tool_use). Collect text blocks; surface tool_use as a
      // progress event so streaming callers can show what Claude is doing.
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            textChunks.push(block.text);
          } else if (block.type === 'tool_use' && block.name) {
            try {
              onProgress?.toolUse?.(block.name, block.input);
            } catch (err) {
              console.warn('[runSdkOneShot] onProgress.toolUse failed', err);
            }
          }
        }
      }
      if (message.type === 'result') {
        resultRaw = message;
        if (typeof message.stop_reason === 'string') finishReason = message.stop_reason;
        else if (typeof message.subtype === 'string') finishReason = message.subtype;
        // result is terminal — the loop will exit naturally on the next iteration
      }
    }
  } finally {
    if (signal) signal.removeEventListener('abort', abortHandler);
  }

  return {
    text: textChunks.join('').trim(),
    sessionId: capturedSessionId,
    durationMs: Date.now() - startedAt,
    model: sdkOptions.model,
    finishReason,
    raw: resultRaw,
  };
}

// Export public API
export {
  queryClaudeSDK,
  abortClaudeSDKSession,
  setClaudeSDKSessionModel,
  setClaudeSDKSessionMcpServers,
  getSupportedModels,
  isClaudeSDKSessionActive,
  getActiveClaudeSDKSessions,
  resolveToolApproval,
  getPendingApprovalsForSession,
  reconnectSessionWriter,
  isBeyondTurnActive,
  countActiveBeyondTurns,
  describeBeyondStreams,
  runSdkOneShot,
  resolveSpawnCwd,
};
