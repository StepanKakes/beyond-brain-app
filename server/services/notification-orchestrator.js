import webPush from 'web-push';

import { notificationPreferencesDb, pushSubscriptionsDb, sessionsDb } from '../modules/database/index.js';

const KIND_TO_PREF_KEY = {
  action_required: 'actionRequired',
  stop: 'stop',
  error: 'error'
};

const PROVIDER_LABELS = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  gemini: 'Gemini',
  system: 'System'
};

const recentEventKeys = new Map();
const DEDUPE_WINDOW_MS = 20000;

const cleanupOldEventKeys = () => {
  const now = Date.now();
  for (const [key, timestamp] of recentEventKeys.entries()) {
    if (now - timestamp > DEDUPE_WINDOW_MS) {
      recentEventKeys.delete(key);
    }
  }
};

function shouldSendPush(preferences, event) {
  const webPushEnabled = Boolean(preferences?.channels?.webPush);
  const prefEventKey = KIND_TO_PREF_KEY[event.kind];
  const eventEnabled = prefEventKey ? Boolean(preferences?.events?.[prefEventKey]) : true;

  return webPushEnabled && eventEnabled;
}

function isDuplicate(event) {
  cleanupOldEventKeys();
  const key = event.dedupeKey || `${event.provider}:${event.kind || 'info'}:${event.code || 'generic'}:${event.sessionId || 'none'}`;
  if (recentEventKeys.has(key)) {
    return true;
  }
  recentEventKeys.set(key, Date.now());
  return false;
}

function createNotificationEvent({
  provider,
  sessionId = null,
  kind = 'info',
  code = 'generic.info',
  meta = {},
  severity = 'info',
  dedupeKey = null,
  requiresUserAction = false
}) {
  return {
    provider,
    sessionId,
    kind,
    code,
    meta,
    severity,
    requiresUserAction,
    dedupeKey,
    createdAt: new Date().toISOString()
  };
}

function normalizeErrorMessage(error) {
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error.message === 'string') {
    return error.message;
  }

  if (error == null) {
    return 'Unknown error';
  }

  return String(error);
}

function normalizeSessionName(sessionName) {
  if (typeof sessionName !== 'string') {
    return null;
  }

  const normalized = sessionName.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function resolveSessionName(event) {
  const explicitSessionName = normalizeSessionName(event.meta?.sessionName);
  if (explicitSessionName) {
    return explicitSessionName;
  }

  if (!event.sessionId || !event.provider) {
    return null;
  }

  return normalizeSessionName(sessionsDb.getSessionName(event.sessionId, event.provider));
}

function buildPushBody(event) {
  const CODE_MAP = {
    'permission.required': event.meta?.toolName
      ? `Čeká na povolení: ${event.meta.toolName}`
      : 'Čeká na tvoje povolení',
    'run.stopped': event.meta?.stopReason || 'Hotovo, můžeš se podívat',
    'run.failed': event.meta?.error ? `Nepovedlo se: ${event.meta.error}` : 'Běh se nepovedl',
    'agent.notification': event.meta?.message ? String(event.meta.message) : 'Máš novou zprávu',
    'push.enabled': 'Notifikace jsou zapnuté'
  };
  const sessionName = resolveSessionName(event);
  const message = CODE_MAP[event.code] || 'Máš novou zprávu';

  return {
    title: sessionName || 'Beyond',
    body: message,
    data: {
      sessionId: event.sessionId || null,
      code: event.code,
      provider: event.provider || null,
      sessionName,
      // Klepnutí otevře chat, ze kterého notifikace přišla.
      url: event.sessionId ? `/m/chat/${event.sessionId}` : '/m',
      tag: `${event.provider || 'assistant'}:${event.sessionId || 'none'}:${event.code}`
    }
  };
}

// TTL a urgency: bez nich může Apple doručení na uspaný telefon odkládat.
const PUSH_OPTIONS = { TTL: 86400, urgency: 'high' };

async function deliver(subscriptions, payload) {
  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webPush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.keys_p256dh,
            auth: sub.keys_auth
          }
        },
        payload,
        PUSH_OPTIONS
      )
    )
  );

  // Clean up gone subscriptions (410 Gone or 404)
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const statusCode = result.reason?.statusCode;
      if (statusCode === 410 || statusCode === 404) {
        pushSubscriptionsDb.removeSubscription(subscriptions[index].endpoint);
      } else {
        console.warn('[push] doručení selhalo', statusCode, result.reason?.body || result.reason?.message);
      }
    }
  });
}

/**
 * Notifikace z úloh brainu. Klepnutí otevře `url`, takže konkrétní zprávu nebo
 * návrh. Nikdy nevyhazuje: výpadek pushe nesmí shodit úlohu, která ho posílá.
 */
async function pushMessage(getSubscriptions, { title, body, url = '/m', tag }) {
  try {
    const subscriptions = getSubscriptions();
    if (!subscriptions.length) return;
    await deliver(subscriptions, JSON.stringify({ title, body, data: { url, tag: tag || url } }));
  } catch (error) {
    console.warn('[push] selhalo', error?.message);
  }
}

const pushToUser = (userId, message) =>
  pushMessage(() => pushSubscriptionsDb.getSubscriptions(userId), message);

const pushToEveryone = (message) =>
  pushMessage(() => pushSubscriptionsDb.getAllSubscriptions(), message);

async function sendWebPush(userId, event) {
  const subscriptions = pushSubscriptionsDb.getSubscriptions(userId);
  if (!subscriptions.length) return;
  await deliver(subscriptions, JSON.stringify(buildPushBody(event)));
}

function notifyUserIfEnabled({ userId, event }) {
  if (!userId || !event) {
    return;
  }

  const preferences = notificationPreferencesDb.getPreferences(userId);
  if (!shouldSendPush(preferences, event)) {
    return;
  }
  if (isDuplicate(event)) {
    return;
  }

  sendWebPush(userId, event).catch((err) => {
    console.error('Web push send error:', err);
  });
}

function notifyRunStopped({ userId, provider, sessionId = null, stopReason = 'completed', sessionName = null }) {
  notifyUserIfEnabled({
    userId,
    event: createNotificationEvent({
      provider,
      sessionId,
      kind: 'stop',
      code: 'run.stopped',
      meta: { stopReason, sessionName },
      severity: 'info',
      dedupeKey: `${provider}:run:stop:${sessionId || 'none'}:${stopReason}`
    })
  });
}

function notifyRunFailed({ userId, provider, sessionId = null, error, sessionName = null }) {
  const errorMessage = normalizeErrorMessage(error);

  notifyUserIfEnabled({
    userId,
    event: createNotificationEvent({
      provider,
      sessionId,
      kind: 'error',
      code: 'run.failed',
      meta: { error: errorMessage, sessionName },
      severity: 'error',
      dedupeKey: `${provider}:run:error:${sessionId || 'none'}:${errorMessage}`
    })
  });
}

export {
  pushToUser,
  pushToEveryone,
  createNotificationEvent,
  notifyUserIfEnabled,
  notifyRunStopped,
  notifyRunFailed
};
