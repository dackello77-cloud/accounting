/*
  Dodatak za Google Apps Script: poslednji setup za Obračun R/K kao JSON.

  Šta rešava:
  - Obračun R i Obračun K više ne moraju da čitaju poslednji PDF iz Drive-a.
  - Frontend šalje action=saveObracunSetup čim menjaš modal.
  - Kada se modal otvori, action=getLatestObracunSetup vraća poslednji JSON state.

  Gde se čuva:
  - U Script Properties, u chunkovima, tako nema oslanjanja na Drive PDF.

  Kako ubaciti:
  1. Prekopiraj ceo ovaj fajl u Apps Script projekat.
  2. U doGet(e), odmah posle čitanja action, dodaj:

     if (action === "getLatestObracunSetup") {
       return jsonOutput(getLatestObracunSetup_(e.parameter.type));
     }

  3. U doPost(e), odmah posle čitanja action, dodaj:

     if (action === "saveObracunSetup") {
       return jsonOutput(saveLatestObracunSetup_(e.parameter.type, e.parameter.setup, "autosave"));
     }

  4. U postojećim PDF/email akcijama možeš dodatno ostaviti ovo, posle uspešnog PDF-a:

     saveLatestObracunSetup_("R", e.parameter.setup || JSON.stringify({ data: JSON.parse(e.parameter.data || "{}") }), fileName);
     saveLatestObracunSetup_("K", e.parameter.setup || e.parameter.data, fileName);

  Ako već imaš jsonOutput(obj), nemoj duplirati ovu funkciju na dnu.
*/

const OBRACUN_SETUP_PROPERTY_PREFIX = "latestObracunSetup.";
const OBRACUN_SETUP_CHUNK_SIZE = 8000;

function normalizeObracunSetupType_(type) {
  const cleanType = String(type || "").toUpperCase().trim();
  if (cleanType !== "R" && cleanType !== "K") {
    throw new Error("Nepoznat tip obračuna.");
  }
  return cleanType;
}

function getObracunSetupBaseKey_(type) {
  return OBRACUN_SETUP_PROPERTY_PREFIX + normalizeObracunSetupType_(type);
}

function saveLargeProperty_(baseKey, value) {
  const props = PropertiesService.getScriptProperties();
  const existingCount = Number(props.getProperty(baseKey + ".chunkCount") || 0);

  for (let i = 0; i < existingCount; i++) {
    props.deleteProperty(baseKey + ".chunk." + i);
  }

  const text = String(value || "");
  const chunkCount = Math.max(1, Math.ceil(text.length / OBRACUN_SETUP_CHUNK_SIZE));

  for (let i = 0; i < chunkCount; i++) {
    props.setProperty(
      baseKey + ".chunk." + i,
      text.slice(i * OBRACUN_SETUP_CHUNK_SIZE, (i + 1) * OBRACUN_SETUP_CHUNK_SIZE)
    );
  }

  props.setProperty(baseKey + ".chunkCount", String(chunkCount));
}

function readLargeProperty_(baseKey) {
  const props = PropertiesService.getScriptProperties();
  const chunkCount = Number(props.getProperty(baseKey + ".chunkCount") || 0);

  if (!chunkCount) {
    const legacy = props.getProperty(baseKey);
    return legacy || "";
  }

  let text = "";
  for (let i = 0; i < chunkCount; i++) {
    text += props.getProperty(baseKey + ".chunk." + i) || "";
  }

  return text;
}

function saveLatestObracunSetup_(type, setup, sourceName) {
  const cleanType = normalizeObracunSetupType_(type);
  const setupText = String(setup || "").trim();

  if (!setupText) {
    return { success: false, message: "Setup JSON je prazan." };
  }

  const parsedSetup = JSON.parse(setupText);
  const envelope = {
    type: cleanType,
    setup: parsedSetup,
    sourceName: sourceName || "autosave",
    updatedAt: new Date().toISOString()
  };

  saveLargeProperty_(getObracunSetupBaseKey_(cleanType), JSON.stringify(envelope));

  return {
    success: true,
    type: cleanType,
    updatedAt: envelope.updatedAt
  };
}

function getLatestObracunSetup_(type) {
  const cleanType = normalizeObracunSetupType_(type);
  const raw = readLargeProperty_(getObracunSetupBaseKey_(cleanType));

  if (!raw) {
    return { success: false, message: "Nema sačuvanog setup-a." };
  }

  const envelope = JSON.parse(raw);
  const setup = envelope.setup || envelope;

  return {
    success: true,
    type: cleanType,
    data: setup,
    setup: JSON.stringify(setup),
    sourceName: envelope.sourceName || "",
    updatedAt: envelope.updatedAt || ""
  };
}

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
