// Vercel serverless function — WhatsApp bot via Wazzup24.
//
// Flow: Wazzup POSTs an incoming WhatsApp message here → we run it through the
// shared concierge core (lib/bot.js, booking enabled) → send the reply back
// through the Wazzup API. Website chat and WhatsApp share the same data + brain.
//
// SAFETY — this talks to real customers on WhatsApp. Two kill switches:
//   1. Instant, no redeploy: Vercel Edge Config flag `waBotEnabled=false`
//      (works if EDGE_CONFIG is set). Falls back to env WA_BOT_ENABLED.
//   2. Hard off at the source: disable the channel / remove the webhook in Wazzup.
//
// Required env:  WAZZUP_API_KEY, DEEPSEEK_API_KEY
// Optional env:  WAZZUP_CHANNEL_ID (default channel for replies),
//                WAZZUP_WEBHOOK_SECRET (shared secret in the webhook URL query),
//                WA_BOT_ENABLED ("false" to mute), WAZZUP_API_BASE,
//                EDGE_CONFIG (enables the instant kill switch)

const bot = require("../lib/bot.js");

const WAZZUP_BASE = process.env.WAZZUP_API_BASE || "https://api.wazzup24.com/v3";

// Best-effort import of Vercel's waitUntil so AI+send finish after we ack the
// webhook fast (Wazzup expects a quick 200). Falls back to inline await locally.
let waitUntil = null;
try { ({ waitUntil } = require("@vercel/functions")); } catch (e) { /* local dev */ }

// ── Kill switch ──────────────────────────────────────────────────────────────
// Instant toggle via Edge Config when available, else the env flag. Defaults ON.
async function isBotEnabled() {
  const conn = process.env.EDGE_CONFIG;
  if (conn) {
    try {
      // EDGE_CONFIG looks like: https://edge-config.vercel.com/ecfg_xxx?token=yyy
      const u = new URL(conn);
      const token = u.searchParams.get("token");
      const id = u.pathname.replace(/^\//, "");
      const r = await fetch(`https://edge-config.vercel.com/${id}/item/waBotEnabled?token=${token}`);
      if (r.ok) {
        const val = await r.json().catch(() => undefined);
        if (val === false) return false;
        if (val === true) return true;
      }
    } catch (e) { /* fall through to env */ }
  }
  return process.env.WA_BOT_ENABLED !== "false";
}

// ── Defensive field extraction (Wazzup v3 payload shape confirmed on 1st msg) ──
function extractText(m) {
  return (typeof m.text === "string" && m.text)
    || (typeof m.body === "string" && m.body)
    || (m.content && typeof m.content.text === "string" && m.content.text)
    || "";
}
function extractChatId(m) {
  return m.chatId || m.chatID || m.chat_id || (m.contact && m.contact.chatId) || "";
}
function isOutbound(m) {
  // Ignore anything we (the connected account) authored, or delivery statuses.
  return m.isEcho === true || m.fromMe === true || m.isFromCrm === true
    || m.inbound === false || m.direction === "outbound";
}
function isGroup(m) {
  const t = (m.chatType || "").toLowerCase();
  const id = extractChatId(m);
  return t.indexOf("group") !== -1 || (typeof id === "string" && id.indexOf("@g.us") !== -1);
}

// A message is actionable only if it's a real inbound text from a 1:1 chat.
function actionable(m) {
  if (!m || typeof m !== "object") return false;
  if (m.type && m.type !== "text") return false;   // skip images/audio/etc.
  if (isOutbound(m)) return false;
  if (isGroup(m)) return false;
  if (!extractChatId(m)) return false;
  return !!extractText(m);
}

async function sendReply(channelId, chatId, chatType, text) {
  const apiKey = process.env.WAZZUP_API_KEY;
  if (!apiKey) { console.error("wazzup: WAZZUP_API_KEY not set"); return; }
  const body = {
    channelId: channelId || process.env.WAZZUP_CHANNEL_ID,
    chatId,
    chatType: chatType || "whatsapp",
    text,
  };
  try {
    const r = await fetch(`${WAZZUP_BASE}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("wazzup send failed", r.status, detail.slice(0, 300));
    } else {
      console.log("wazzup: replied", JSON.stringify({ chatId, len: text.length }));
    }
  } catch (e) {
    console.error("wazzup send error", (e && e.name) || e);
  }
}

// Send an image via Wazzup (contentUri). On any failure, fall back to sending
// the URL as plain text so the customer still gets the photo link.
async function sendMedia(channelId, chatId, chatType, url, caption) {
  const apiKey = process.env.WAZZUP_API_KEY;
  if (!apiKey || !url) return;
  const body = {
    channelId: channelId || process.env.WAZZUP_CHANNEL_ID,
    chatId,
    chatType: chatType || "whatsapp",
    contentUri: url,
  };
  const linkFallback = () => sendReply(channelId, chatId, chatType, (caption ? caption + " " : "") + url);
  try {
    const r = await fetch(`${WAZZUP_BASE}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("wazzup media failed", r.status, detail.slice(0, 300));
      await linkFallback();
    } else {
      console.log("wazzup: sent media", JSON.stringify({ chatId }));
    }
  } catch (e) {
    console.error("wazzup media error", (e && e.name) || e);
    await linkFallback();
  }
}

// Short in-memory history per WhatsApp chat (best-effort on warm serverless
// instances). Stops the bot re-asking university/district after a prior reply.
const CHAT_HISTORY = new Map(); // chatId -> { at, turns:[{role,content}] }
const CHAT_HISTORY_TTL_MS = 45 * 60 * 1000;
const CHAT_HISTORY_MAX_TURNS = 8;

function historyFor(chatId) {
  const row = CHAT_HISTORY.get(chatId);
  if (!row) return [];
  if (Date.now() - row.at > CHAT_HISTORY_TTL_MS) {
    CHAT_HISTORY.delete(chatId);
    return [];
  }
  return row.turns.slice(-CHAT_HISTORY_MAX_TURNS);
}
function remember(chatId, userText, assistantText) {
  const prev = historyFor(chatId);
  const turns = prev.concat(
    { role: "user", content: userText },
    { role: "assistant", content: assistantText }
  ).slice(-CHAT_HISTORY_MAX_TURNS);
  CHAT_HISTORY.set(chatId, { at: Date.now(), turns });
}

// Group inbound messages by chat and answer ONCE per chat. Rapid double-sends
// ("Біз МУИТпіз" + "Жақын үй керек") used to trigger two conflicting replies.
function groupByChat(messages) {
  const order = [];
  const map = new Map();
  for (const m of messages) {
    const chatId = extractChatId(m);
    if (!map.has(chatId)) {
      map.set(chatId, []);
      order.push(chatId);
    }
    map.get(chatId).push(m);
  }
  return order.map((chatId) => ({ chatId, messages: map.get(chatId) }));
}

// Debounce per chat across separate webhook POSTs (common when the customer
// taps send twice quickly). Collect ~1.5s, then one combined reply.
const PENDING = new Map(); // chatId -> { messages, waiters, timer }
const DEBOUNCE_MS = 1500;

function enqueueChat(chatId, messages) {
  return new Promise((resolve) => {
    let slot = PENDING.get(chatId);
    if (!slot) {
      slot = { messages: [], waiters: [], timer: null };
      PENDING.set(chatId, slot);
    }
    slot.messages.push(...messages);
    slot.waiters.push(resolve);
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = setTimeout(() => {
      PENDING.delete(chatId);
      const batch = slot.messages;
      const waiters = slot.waiters;
      handleChat(chatId, batch)
        .catch((e) => console.error("wazzup: handleChat error", (e && e.name) || e))
        .finally(() => { for (const w of waiters) w(); });
    }, DEBOUNCE_MS);
  });
}

async function handleChat(chatId, messages) {
  const texts = messages.map(extractText).map((t) => t.trim()).filter(Boolean);
  if (!texts.length) return;
  const combined = texts.join("\n");
  const first = messages[0];
  const chatType = first.chatType || "whatsapp";
  const channelId = first.channelId || process.env.WAZZUP_CHANNEL_ID;
  console.log("wazzup: inbound", JSON.stringify({
    chatId,
    parts: texts.length,
    text: combined.slice(0, 300),
  }));

  // WhatsApp: language unknown → let the model mirror the customer. Booking on.
  const { reply, attachments } = await bot.ask({
    message: combined,
    history: historyFor(chatId),
    channel: "whatsapp",
    booking: true,
  });
  if (reply) {
    await sendReply(channelId, chatId, chatType, reply);
    remember(chatId, combined, reply);
  }
  for (const a of attachments || []) {
    await sendMedia(channelId, chatId, chatType, a.mediaUrl, a.caption);
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Shared-secret guard: keeps randoms from triggering DeepSeek cost / WhatsApp sends.
  const secret = process.env.WAZZUP_WEBHOOK_SECRET;
  if (secret) {
    const provided = (req.query && (req.query.secret || req.query.token)) || "";
    if (provided !== secret) return res.status(401).json({ error: "unauthorized" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  // Wazzup verifies a new webhook by POSTing {test:true} — must 200 quickly.
  if (body.test === true) return res.status(200).json({ ok: true });

  // Kill switch: ack but stay silent when disabled.
  if (!(await isBotEnabled())) {
    console.log("wazzup: bot disabled, ignoring");
    return res.status(200).json({ ok: true, muted: true });
  }

  const messages = Array.isArray(body.messages) ? body.messages.filter(actionable) : [];
  const chats = groupByChat(messages);

  // Ack fast so Wazzup doesn't retry; process AI + send in the background.
  res.status(200).json({ ok: true, accepted: messages.length, chats: chats.length });

  const work = Promise.all(chats.map(({ chatId, messages: ms }) => enqueueChat(chatId, ms)));
  if (waitUntil) { waitUntil(work); } else { await work; }
};
