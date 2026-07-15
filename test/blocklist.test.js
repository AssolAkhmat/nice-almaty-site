// Run: node test/blocklist.test.js

const sheets = require("../lib/sheets.js");
const { normalizePhone, mapIgnoredPhones, parseCSV, toObjects } = sheets._internals;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("✅ " + name); }
  else { fail++; console.log("❌ " + name + "\n   got:  " + g + "\n   want: " + w); }
}
function ok(name, cond) {
  if (cond) { pass++; console.log("✅ " + name); }
  else { fail++; console.log("❌ " + name); }
}

eq("normalize +7 spaced", normalizePhone("+7 777 073 99 90"), "77770739990");
eq("normalize leading 8", normalizePhone("87770739990"), "77770739990");
eq("normalize already 7", normalizePhone("77770739990"), "77770739990");
eq("normalize 10 digits", normalizePhone("7770739990"), "77770739990");

const csv = 'Телефон,Заметка\n+7 777 111 22 33,жилец\n87772223344,сотрудник\n77771112233,дубль формата\n';
const phones = mapIgnoredPhones(toObjects(parseCSV(csv)));
eq("mapIgnoredPhones unique normalized", phones, ["77771112233", "77772223344"]);

ok("isIgnoredPhone hit", sheets.isIgnoredPhone("8 777 111 22 33", phones));
ok("isIgnoredPhone miss", !sheets.isIgnoredPhone("77001112233", phones));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
