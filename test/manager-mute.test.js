const mute = require("../lib/manager-mute.js");
const pending = require("../lib/pending-reply.js");

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("✅", name); }
  else { fail++; console.log("❌", name); }
}

const normalize = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "8") return "7" + d.slice(1);
  if (d.length === 10) return "7" + d;
  return d;
};

ok("default mute is 1 hour", mute.DEFAULT_MUTE_MS === 60 * 60 * 1000);
ok("default grace is 5 minutes", mute.GRACE_MS === 5 * 60 * 1000);
ok("pending grace matches", pending.GRACE_MS === 5 * 60 * 1000);

ok("human echo is human outbound", mute.isHumanOutbound({ isEcho: true, chatId: "7701" }));
ok("phone isPhoneOutbound on isEcho", mute.isPhoneOutbound({ isEcho: true, chatId: "7701" }));
ok("wazzup UI is human but NOT phone", mute.isHumanOutbound({ sentFromApp: true, chatId: "7701" })
  && !mute.isPhoneOutbound({ sentFromApp: true, chatId: "7701" }));
ok("fromMe alone is NOT phone (ambiguous)", !mute.isPhoneOutbound({ fromMe: true, chatId: "7701" }));
ok("authorName alone is NOT phone without isEcho", !mute.isPhoneOutbound({ authorName: "Ассоль", chatId: "7701" }));
ok("plain inbound is not human outbound", !mute.isHumanOutbound({ isEcho: false, text: "hi" }));
ok("bot-like outbound without echo is not human", !mute.isHumanOutbound({ direction: "outbound", text: "hi" }));
ok("our bot crmMessageId is never phone/human",
  !mute.isPhoneOutbound({ isEcho: true, crmMessageId: "nice-bot-7701-abc", text: "bot" })
  && !mute.isHumanOutbound({ isEcho: true, crmMessageId: "nice-bot-7701-abc", text: "bot" }));
ok("isBotCrmMessage detects prefix", mute.isBotCrmMessage({ crmMessageId: "nice-bot-x" }));
ok("isBotCrmMessage rejects others", !mute.isBotCrmMessage({ crmMessageId: "crm-1" }));
ok("classify phone", mute.classifyOutbound({ isEcho: true, chatId: "1" }) === "phone");
ok("classify wazzup_ui", mute.classifyOutbound({ sentFromApp: true, chatId: "1" }) === "wazzup_ui");
ok("classify admin_api by crm id", mute.classifyOutbound({ crmMessageId: "nice-bot-1", direction: "outbound" }) === "admin_api");
ok("classify admin_api bare outbound", mute.classifyOutbound({ direction: "outbound", isEcho: false, text: "hi" }) === "admin_api");
ok("admin api outbound helper", mute.isAdminApiOutbound({ direction: "outbound", isEcho: false }));
ok("phone is not admin api", !mute.isAdminApiOutbound({ isEcho: true, text: "from phone" }));

mute.muteChat("87771112233", "test", normalize, 60_000);
ok("muted after muteChat", mute.isMuted("77771112233", normalize));
ok("muted with +7 format", mute.isMuted("+7 777 111 22 33", normalize));

mute.noteManagerActivity(
  [{ isEcho: true, chatId: "77009998877" }],
  { extractChatId: (m) => m.chatId, normalizePhone: normalize, isGroup: () => false }
);
ok("muted after human echo activity", mute.isMuted("77009998877", normalize));

mute.noteManagerActivity(
  [{ sentFromApp: true, chatId: "77005554433" }],
  { extractChatId: (m) => m.chatId, normalizePhone: normalize, isGroup: () => false }
);
ok("muted after wazzup UI activity", mute.isMuted("77005554433", normalize));

// Admin API outbound must NOT mute
mute.noteManagerActivity(
  [{ direction: "outbound", isEcho: false, chatId: "77004443322", crmMessageId: "nice-bot-x", text: "бот" }],
  { extractChatId: (m) => m.chatId, normalizePhone: normalize, isGroup: () => false }
);
ok("admin api does not mute", !mute.isMuted("77004443322", normalize));

mute.setSheetMutes([{ phone: "77001234567", until: "2099-01-01" }], normalize);
ok("muted from sheet tab", mute.isMuted("77001234567", normalize));

const dmy = mute.parseUntil("31.12.2099", Date.now());
ok("parseUntil DD.MM.YYYY", dmy > Date.now() && new Date(dmy).getFullYear() === 2099);

ok("API-like outbound without echo is NOT human",
  !mute.isHumanOutbound({ direction: "outbound", isEcho: false, sentFromApp: false, text: "бот" }));

(async () => {
  // In-memory pending (no blob token in unit test unless present)
  const key = "77001110001";
  await pending.cancel(key).catch(() => {});
  const row = await pending.schedule(key, [{ text: "привет", messageId: "m1" }], {
    chatId: key,
    graceMs: 60_000,
  });
  ok("scheduled pending", row && row.answerAfter > Date.now());
  const early = await pending.takeDue(Date.now());
  ok("not due immediately with long grace", early.length === 0);
  // Still in queue — finish with short grace
  await pending.schedule(key, [{ text: "ещё", messageId: "m2" }], { chatId: key, graceMs: 1 });
  await new Promise((r) => setTimeout(r, 20));
  const due = await pending.takeDue(Date.now() + 100);
  ok("due after grace", due.length === 1 && due[0].parts.some((p) => p.text === "ещё"));
  ok("queue empty after takeDue", !(await pending.listAll()).some((r) => r.chatKey === key));

  await pending.schedule(key, [{ text: "cancel-me" }], { chatId: key, graceMs: 60_000 });
  ok("cancel removes pending", await pending.cancel(key));
  ok("cancelled not listed", !(await pending.listAll()).some((r) => r.chatKey === key));

  // New message resets timer — second schedule has later answerAfter
  const a = await pending.schedule("77002220002", [{ text: "1" }], { graceMs: 10_000 });
  await new Promise((r) => setTimeout(r, 20));
  const b = await pending.schedule("77002220002", [{ text: "2" }], { graceMs: 10_000 });
  ok("new message resets grace", b.answerAfter > a.answerAfter);
  ok("parts merged", b.parts.length >= 2);
  await pending.cancel("77002220002");

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
