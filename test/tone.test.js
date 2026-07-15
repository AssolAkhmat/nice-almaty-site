// Oracle tests for polite greeting enforcement in lib/bot.js
// Run: node test/tone.test.js

const bot = require("../lib/bot.js");

let pass = 0, fail = 0;
function eq(name, got, want) {
  if (got === want) { pass++; console.log("✅ " + name); }
  else { fail++; console.log("❌ " + name + "\n   got:  " + JSON.stringify(got) + "\n   want: " + JSON.stringify(want)); }
}
function has(name, s, re) {
  if (re.test(s)) { pass++; console.log("✅ " + name); }
  else { fail++; console.log("❌ " + name + "\n   got: " + JSON.stringify(s)); }
}
function lacks(name, s, re) {
  if (!re.test(s)) { pass++; console.log("✅ " + name); }
  else { fail++; console.log("❌ " + name + " still matched\n   got: " + JSON.stringify(s)); }
}

eq("Сәлем → Сәлеметсіз бе",
  bot.enforcePoliteGreeting("Сәлем! Жақын үй керек пе?"),
  "Сәлеметсіз бе! Жақын үй керек пе?");

eq("Салем latin-cyrillic mix → formal",
  bot.enforcePoliteGreeting("Салем! Қалайсыз?"),
  "Сәлеметсіз бе! Қалайсыз?");

eq("Привет → Здравствуйте",
  bot.enforcePoliteGreeting("Привет! Есть места?"),
  "Здравствуйте! Есть места?");

lacks("formal Сәлеметсіз бе kept (no bare Сәлем left)",
  bot.enforcePoliteGreeting("Сәлеметсіз бе! МУИТке жақын үй бар."),
  /(^|[^еЕ])Сәлем(?!ет)/u);

has("prompt forbids Сәлем",
  bot.buildSystemPrompt({ lang: "kz", channel: "whatsapp", booking: true }),
  /NEVER write «Сәлем»/);

has("prompt requires Сәлеметсіз бе",
  bot.buildSystemPrompt({ lang: "kz", channel: "whatsapp", booking: true }),
  /Сәлеметсіз бе/);

has("kz fallback is formal", bot.FALLBACK.kz, /^Сәлеметсіз бе/);
lacks("kz fallback has no bare Сәлем", bot.FALLBACK.kz, /(^|[^еЕ])Сәлем(?!ет)/u);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
