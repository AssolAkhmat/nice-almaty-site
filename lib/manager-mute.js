// Per-chat mute so the WhatsApp bot does not reply while a human manager is active.
//
// Sources of mute:
//   1. Bot handoff ([МЕНЕДЖЕР]) — muteChat(reason)
//   2. Human outbound from Wazzup UI / phone (isEcho / sentFromApp) — noteManagerActivity
//   3. Optional sheet tab «Молчит бот» (Phone [, Until]) — durable across isolates
//
// In-memory + /tmp are best-effort on warm serverless; the sheet tab is durable.

const fs = require("fs");
const path = require("path");

const MUTE_FILE = process.env.WA_MUTE_FILE || "/tmp/wa-manager-mute.json";
const DEFAULT_MUTE_MS = Number(process.env.WA_MANAGER_MUTE_MS || 12 * 60 * 60 * 1000);
const SHEET_REFRESH_MS = Number(process.env.WA_MUTE_SHEET_TTL_MS || 60_000);

const MEM = new Map(); // key -> untilMs
let sheetCache = { at: 0, untilByPhone: new Map() };

function chatKey(chatId, normalizePhone) {
  const n = typeof normalizePhone === "function" ? normalizePhone(chatId) : "";
  return n || String(chatId || "").trim();
}

function loadFile() {
  try {
    if (!fs.existsSync(MUTE_FILE)) return;
    const data = JSON.parse(fs.readFileSync(MUTE_FILE, "utf8"));
    const now = Date.now();
    for (const [k, until] of Object.entries(data || {})) {
      if (Number(until) > now) MEM.set(k, Number(until));
    }
  } catch (e) { /* ignore */ }
}

function saveFile() {
  try {
    const now = Date.now();
    const out = {};
    for (const [k, until] of MEM.entries()) {
      if (until > now) out[k] = until;
      else MEM.delete(k);
    }
    fs.mkdirSync(path.dirname(MUTE_FILE), { recursive: true });
    fs.writeFileSync(MUTE_FILE, JSON.stringify(out));
  } catch (e) { /* ignore */ }
}

loadFile();

function muteChat(chatId, reason, normalizePhone, muteMs) {
  const key = chatKey(chatId, normalizePhone);
  if (!key) return null;
  const ms = Number(muteMs) > 0 ? Number(muteMs) : DEFAULT_MUTE_MS;
  const until = Date.now() + ms;
  const prev = MEM.get(key) || 0;
  if (until > prev) MEM.set(key, until);
  saveFile();
  return { key, until, reason: reason || "mute" };
}

function isMuted(chatId, normalizePhone) {
  const key = chatKey(chatId, normalizePhone);
  if (!key) return false;
  const now = Date.now();
  const memUntil = MEM.get(key);
  if (memUntil) {
    if (memUntil > now) return true;
    MEM.delete(key);
    saveFile();
  }
  const sheetUntil = sheetCache.untilByPhone.get(key);
  if (sheetUntil && sheetUntil > now) return true;
  return false;
}

// Wazzup: isEcho=true → outbound not from our API (phone/iframe).
// sentFromApp=true → typed in Wazzup native chat UI.
function isHumanOutbound(m, isGroupFn) {
  if (!m || typeof m !== "object") return false;
  if (typeof isGroupFn === "function" && isGroupFn(m)) return false;
  if (m.isEcho === true) return true;
  if (m.sentFromApp === true) return true;
  return false;
}

function noteManagerActivity(messages, opts) {
  opts = opts || {};
  const extractChatId = opts.extractChatId;
  const normalizePhone = opts.normalizePhone;
  const isGroupFn = opts.isGroup;
  const muted = [];
  for (const m of messages || []) {
    if (!isHumanOutbound(m, isGroupFn)) continue;
    const id = typeof extractChatId === "function" ? extractChatId(m) : "";
    if (!id) continue;
    const row = muteChat(id, m.sentFromApp ? "wazzup_ui" : "human_echo", normalizePhone);
    if (row) muted.push(row);
  }
  return muted;
}

function parseUntil(raw, now) {
  const s = String(raw || "").trim();
  if (!s) return now + DEFAULT_MUTE_MS;
  // ISO / Date.parse-friendly first.
  let until = Date.parse(s);
  if (Number.isFinite(until)) return until;
  // Common spreadsheet forms: DD.MM.YYYY or DD/MM/YYYY (+ optional time).
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]) - 1;
    const yyyy = Number(m[3]);
    const hh = m[4] != null ? Number(m[4]) : 23;
    const mi = m[5] != null ? Number(m[5]) : 59;
    until = new Date(yyyy, mm, dd, hh, mi, 59).getTime();
    if (Number.isFinite(until)) return until;
  }
  // Bare year → mute until end of that year.
  if (/^\d{4}$/.test(s)) {
    until = new Date(Number(s), 11, 31, 23, 59, 59).getTime();
    if (Number.isFinite(until)) return until;
  }
  return now + DEFAULT_MUTE_MS;
}

/** Merge phones from sheet objects [{phone|Телефон, until|Until|До}, ...]. */
function setSheetMutes(rows, normalizePhone) {
  const map = new Map();
  const now = Date.now();
  for (const o of rows || []) {
    const raw = o.phone || o.Phone || o["Телефон"] || o["телефон"] || o["Номер"] || "";
    const key = chatKey(raw, normalizePhone);
    if (!key) continue;
    const until = parseUntil(o.until || o.Until || o["До"] || o["until"] || "", now);
    if (until > now) map.set(key, until);
  }
  sheetCache = { at: now, untilByPhone: map };
  return map.size;
}

/** Call after a failed sheet fetch so we don't hammer Google every message. */
function markSheetFetchAttempt() {
  sheetCache = { at: Date.now(), untilByPhone: sheetCache.untilByPhone };
}

function sheetCacheStale() {
  return Date.now() - sheetCache.at > SHEET_REFRESH_MS;
}

module.exports = {
  muteChat,
  isMuted,
  isHumanOutbound,
  noteManagerActivity,
  setSheetMutes,
  markSheetFetchAttempt,
  sheetCacheStale,
  parseUntil,
  chatKey,
  DEFAULT_MUTE_MS,
  _internals: { MEM, loadFile, saveFile, getSheetCache: () => sheetCache },
};
