function driveDirect(url) {
  if (typeof url !== "string" || url.trim() === "") {
    return { webUrl: "", mediaUrl: "" };
  }

  const trimmed = url.trim();

  if (trimmed.includes("drive.google.com")) {
    const fileMatch = trimmed.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
    if (fileMatch) {
      const id = fileMatch[1];
      return {
        webUrl: "https://drive.google.com/thumbnail?id=" + id + "&sz=w1600",
        mediaUrl: "https://drive.google.com/uc?export=download&id=" + id,
      };
    }

    const paramMatch = trimmed.match(/[?&]id=([A-Za-z0-9_-]+)/);
    if (paramMatch) {
      const id = paramMatch[1];
      return {
        webUrl: "https://drive.google.com/thumbnail?id=" + id + "&sz=w1600",
        mediaUrl: "https://drive.google.com/uc?export=download&id=" + id,
      };
    }
  }

  return { webUrl: trimmed, mediaUrl: trimmed };
}

function stripPhotoMarkers(text) {
  if (typeof text !== "string") {
    return { text: "", houses: [] };
  }

  const markerRe = /\[\s*фото\s*:\s*([^\]]+?)\s*\]/gi;
  const houses = [];
  const seen = new Set();

  let m;
  const findRe = new RegExp(markerRe.source, markerRe.flags);
  while ((m = findRe.exec(text)) !== null) {
    const raw = m[1].trim();
    let house;
    if (/^\d+$/.test(raw)) {
      house = "Дом " + raw;
    } else if (/^дом\s+\d+$/i.test(raw)) {
      house = "Дом " + raw.match(/\d+/)[0];
    } else {
      house = raw;
    }
    if (!seen.has(house)) {
      seen.add(house);
      houses.push(house);
    }
  }

  const cleaned = text.replace(markerRe, "").trim();

  return { text: cleaned, houses: houses };
}

module.exports = { driveDirect: driveDirect, stripPhotoMarkers: stripPhotoMarkers };
