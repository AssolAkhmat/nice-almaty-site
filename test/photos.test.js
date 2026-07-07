// Oracle tests for lib/photos.js — the implementation must make ALL of these pass.
// Run: node test/photos.test.js   (exit code 0 = all green)
//
// lib/photos.js must export exactly two pure functions:
//   driveDirect(url)         -> { webUrl, mediaUrl }
//   stripPhotoMarkers(text)  -> { text, houses }
// See ../PHOTOS_SPEC.md for the full contract. No other behavior is required.

const photos = require("../lib/photos.js");

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("✅ " + name); }
  else { fail++; console.log("❌ " + name + "\n   got:  " + g + "\n   want: " + w); }
}

// ─────────── driveDirect ───────────
const ID = "1AbC_dEf-123";
const web = "https://drive.google.com/thumbnail?id=" + ID + "&sz=w1600";
const media = "https://drive.google.com/uc?export=download&id=" + ID;

eq("drive /file/d/ID/view",
  photos.driveDirect("https://drive.google.com/file/d/" + ID + "/view?usp=sharing"),
  { webUrl: web, mediaUrl: media });

eq("drive open?id=ID",
  photos.driveDirect("https://drive.google.com/open?id=" + ID),
  { webUrl: web, mediaUrl: media });

eq("drive uc?export=view&id=ID",
  photos.driveDirect("https://drive.google.com/uc?export=view&id=" + ID),
  { webUrl: web, mediaUrl: media });

eq("drive thumbnail?id=ID (already)",
  photos.driveDirect("https://drive.google.com/thumbnail?id=" + ID),
  { webUrl: web, mediaUrl: media });

eq("non-drive direct jpg stays as-is",
  photos.driveDirect("https://i.imgur.com/abc.jpg"),
  { webUrl: "https://i.imgur.com/abc.jpg", mediaUrl: "https://i.imgur.com/abc.jpg" });

eq("whitespace trimmed",
  photos.driveDirect("  https://i.imgur.com/x.png  "),
  { webUrl: "https://i.imgur.com/x.png", mediaUrl: "https://i.imgur.com/x.png" });

eq("empty string -> empty",
  photos.driveDirect(""),
  { webUrl: "", mediaUrl: "" });

eq("null -> empty",
  photos.driveDirect(null),
  { webUrl: "", mediaUrl: "" });

// ─────────── stripPhotoMarkers ───────────
eq("marker on its own trailing line",
  photos.stripPhotoMarkers("Вот наш дом!\n[ФОТО: Дом 2]"),
  { text: "Вот наш дом!", houses: ["Дом 2"] });

eq("bare number normalized to 'Дом N'",
  photos.stripPhotoMarkers("текст\n[ФОТО: 3]"),
  { text: "текст", houses: ["Дом 3"] });

eq("lowercase дом + inline marker",
  photos.stripPhotoMarkers("[ФОТО: дом 5] остальной текст"),
  { text: "остальной текст", houses: ["Дом 5"] });

eq("no marker -> text unchanged, empty houses",
  photos.stripPhotoMarkers("Обычный ответ без фото"),
  { text: "Обычный ответ без фото", houses: [] });

eq("two markers, order preserved",
  photos.stripPhotoMarkers("Смотрите:\n[ФОТО: Дом 1]\n[ФОТО: Дом 2]"),
  { text: "Смотрите:", houses: ["Дом 1", "Дом 2"] });

eq("duplicate house deduped",
  photos.stripPhotoMarkers("a [ФОТО: Дом 2] b [ФОТО: Дом 2]"),
  { text: "a  b", houses: ["Дом 2"] });

eq("case-insensitive marker keyword (фото)",
  photos.stripPhotoMarkers("hi\n[фото: Дом 4]"),
  { text: "hi", houses: ["Дом 4"] });

eq("non-string input safe",
  photos.stripPhotoMarkers(null),
  { text: "", houses: [] });

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
