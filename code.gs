const SHEET_ID = "11r3yv3-wAVTEKlpwk67LoByemHROLHuSxh_l__BCi7I";

const TRANSACTION_FOLDER_ID = "1vvcAJIUAYc5DsuSHnmNAcD4tJf2uej6g";
const CARD_FOLDER_ID = "1wB6-Chc8W8T_B5LR8GZCXj_QKGkyfNWS";
const RECEIPTS_FOLDER_ID = "1rXRbES0OKCVhXFW6Da0Ybb6omBUZ05gX";
const TRANSACTION_RECEIPTS_FOLDER_ID = "1cfKqzIraphOF7JNf0J7YE8dpHfTfFciD";
const LOGO_FILE_ID = "1RpK8rwrjPIpMNUvDHBPZst_nWmb4r-wU";
const GITHUB_LOGO_URL = "https://mm-eldsupport.com/wp-content/uploads/2024/09/MM-SAFETY.png";
const OBRACUN_R_FOLDER_ID = "1nJMpx2QCgg1baho7eZboWaIv5zrWkgGH";
const OBRACUN_K_FOLDER_ID = "1-vkM_gYA-Dc83HhaUvvNAv2mc39j6OFA";
const INVOICE_FOLDER_ID = "1CeUQO1vYkxREPpa4jt2-p5PT0N0IsCvR";

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const action = e.parameter.action;

  try {
    if (action === "login") return login(e);
    if (action === "addEntity") return addEntity(e);
    if (action === "updateEntity") return updateEntity(e);
    if (action === "getEntities") return getEntities(e);
    if (action === "addTransaction") return addTransaction(e);
    if (action === "getDashboard") return getDashboard();
    if (action === "getTransactions") return getTransactions(e);
    if (action === "getCard") return getCard(e);
    if (action === "storno") return stornoTransaction(e);
    if (action === "saveDocument") return saveDocument(e);
    if (action === "uploadReceipt") return uploadReceipt(e);
    if (action === "getReceiptFiles") return getReceiptFiles(e);
    if (action === "getReceiptFileData") return getReceiptFileData(e);
    if (action === "moveReceiptToTransaction") return moveReceiptToTransaction(e);
    if (action === "saveObracunRPdf") return saveObracunRPdf(e);
    if (action === "sendObracunREmail") return sendObracunREmail(e);
    if (action === "saveObracunKPdf") return saveObracunKPdf(e);
    if (action === "sendObracunKEmail") return sendObracunKEmail(e);
    if (action === "getLatestObracunSetup") return json(getLatestObracunSetup_(e.parameter.type));
    if (action === "saveObracunSetup") return json(saveLatestObracunSetup_(e.parameter.type, e.parameter.setup, "autosave"));
    if (action === "getEmails") return getEmails(e);
    if (action === "addEmail") return addEmail(e);
    if (action === "sendInvoiceEmail") return sendInvoiceEmail(e);
    if (action === "saveInvoicePdf") return saveInvoicePdf(e);
    if (action === "getInvoiceArticles") return getInvoiceArticles(e);
    if (action === "getInvoiceCompanies") return getInvoiceCompanies(e);
    if (action === "getNextInvoiceNumber") return getNextInvoiceNumber(e);
    if (action === "getNotes") return getNotes(e);
    if (action === "addNote") return addNote(e);
    if (action === "updateNote") return updateNote(e);
    if (action === "deleteNote") return deleteNote(e);
    if (action === "getReminderAlerts") return getReminderAlerts(e);

    return json({ success: false, message: "Nepoznata akcija" });
  } catch (err) {
    return json({ success: false, message: err.toString() });
  }
}

function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

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
    return props.getProperty(baseKey) || "";
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

function rememberObracunSetupFromRequest_(type, e, sourceName) {
  let setup = e.parameter.setup || "";

  if (!setup && e.parameter.data) {
    if (String(type).toUpperCase() === "R") {
      setup = JSON.stringify({
        data: JSON.parse(e.parameter.data || "{}"),
        month: e.parameter.month || "",
        year: e.parameter.year || "",
        rate: e.parameter.kurs || ""
      });
    } else {
      setup = e.parameter.data;
    }
  }

  if (!setup) return;

  try {
    saveLatestObracunSetup_(type, setup, sourceName);
  } catch (err) {
    console.log("Obračun setup nije sačuvan: " + err);
  }
}

function ss() {
  return SpreadsheetApp.openById(SHEET_ID);
}



/* NOTES / PODSETNIK */
function notesSheet() {
  return getOrCreateSheet("Notes", ["ID", "TIMESTAMP", "TYPE", "TITLE", "TEXT", "REMINDER_AT", "STATUS"]);
}

function noteToObject(row) {
  const reminder = row[5];
  let reminderDate = reminder instanceof Date ? reminder : (reminder ? new Date(reminder) : null);
  const reminderAt = reminderDate && !isNaN(reminderDate.getTime()) ? reminderDate.toISOString() : "";
  const reminderAtInput = reminderDate && !isNaN(reminderDate.getTime()) ? Utilities.formatDate(reminderDate, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm") : "";
  return {
    id: row[0],
    timestamp: row[1],
    type: row[2] || "NOTE",
    title: row[3] || "",
    text: row[4] || "",
    reminderAt: reminderAt,
    reminderAtInput: reminderAtInput,
    status: row[6] || "ACTIVE"
  };
}

function getNotes(e) {
  const sheet = notesSheet();
  const data = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][6] !== "ACTIVE") continue;
    out.push(noteToObject(data[i]));
  }
  out.sort(function(a,b){ return String(b.timestamp).localeCompare(String(a.timestamp)); });
  return json({ success: true, data: out });
}

function addNote(e) {
  const sheet = notesSheet();
  const id = Utilities.getUuid();
  const type = e.parameter.type || "NOTE";
  const title = e.parameter.title || "";
  const text = e.parameter.text || "";
  const reminderAt = e.parameter.reminderAt ? new Date(e.parameter.reminderAt) : "";
  sheet.appendRow([id, new Date(), type, title, text, reminderAt, "ACTIVE"]);
  return json({ success: true, id: id });
}

function updateNote(e) {
  const id = e.parameter.id || "";
  if (!id) return json({ success: false, message: "Nedostaje ID" });
  const sheet = notesSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.getRange(i + 1, 3).setValue(e.parameter.type || "NOTE");
      sheet.getRange(i + 1, 4).setValue(e.parameter.title || "");
      sheet.getRange(i + 1, 5).setValue(e.parameter.text || "");
      sheet.getRange(i + 1, 6).setValue(e.parameter.reminderAt ? new Date(e.parameter.reminderAt) : "");
      return json({ success: true });
    }
  }
  return json({ success: false, message: "Unos nije pronađen" });
}

function deleteNote(e) {
  const id = e.parameter.id || "";
  if (!id) return json({ success: false, message: "Nedostaje ID" });
  const sheet = notesSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.getRange(i + 1, 7).setValue("DELETED");
      return json({ success: true });
    }
  }
  return json({ success: false, message: "Unos nije pronađen" });
}

function getReminderAlerts(e) {
  const sheet = notesSheet();
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  const plus24 = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][6] !== "ACTIVE") continue;
    if (data[i][2] !== "REMINDER") continue;
    const reminder = data[i][5] instanceof Date ? data[i][5] : new Date(data[i][5]);
    if (isNaN(reminder.getTime())) continue;
    if (reminder <= plus24) {
      const obj = noteToObject(data[i]);
      out.push(obj);
    }
  }
  out.sort(function(a,b){ return new Date(a.reminderAt).getTime() - new Date(b.reminderAt).getTime(); });
  return json({ success: true, data: out });
}

function getSheetOrCreate(name, headers) {
  const book = ss();
  let sheet = book.getSheetByName(name);

  if (!sheet) {
    sheet = book.insertSheet(name);
  }

  if (headers && headers.length > 0 && sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }

  return sheet;
}

/* LOGIN */

function login(e) {
  const username = e.parameter.username;
  const password = e.parameter.password;

  const sheet = ss().getSheetByName("Login");
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(username) && String(data[i][1]) === String(password)) {
      return json({ success: true });
    }
  }

  return json({ success: false, message: "Pogresan username ili password" });
}

/* DODAJ */

function addEntity(e) {
  const tip = e.parameter.tip;
  const ime = e.parameter.ime;
  const adresa = e.parameter.adresa;
  const ziro = e.parameter.ziro;

  if (!tip) return json({ success: false, message: "Tip nije poslat" });

  if (tip === "Artikli") {
    const sheet = getSheetOrCreate("Artikli", ["Naziv", "Cena"]);
    sheet.appendRow([ime, adresa]);
    return json({ success: true, message: "Artikal je sacuvan" });
  }

  const sheet = getSheetOrCreate(tip, ["Ime", "Adresa", "Ziro racun"]);
  sheet.appendRow([ime, adresa, ziro]);

  return json({ success: true, message: "Sacuvano" });
}

function updateEntity(e) {
  const tip = e.parameter.tip;
  const originalIme = e.parameter.originalIme;
  const ime = e.parameter.ime;
  const adresa = e.parameter.adresa;
  const ziro = e.parameter.ziro;

  if (!tip) return json({ success: false, message: "Tip nije poslat" });
  if (!originalIme) return json({ success: false, message: "Nije izabran unos za izmenu" });
  if (!ime) return json({ success: false, message: "Naziv nije poslat" });

  const sheet = ss().getSheetByName(tip);
  if (!sheet) return json({ success: false, message: "Grupa nije pronađena" });

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(originalIme)) {
      if (tip === "Artikli") {
        sheet.getRange(i + 1, 1, 1, 2).setValues([[ime, adresa]]);
      } else {
        sheet.getRange(i + 1, 1, 1, 3).setValues([[ime, adresa, ziro]]);
      }

      return json({ success: true, message: "Izmenjeno" });
    }
  }

  return json({ success: false, message: "Unos nije pronađen" });
}

/* UCITAJ LISTU */

function getEntities(e) {
  const tip = e.parameter.tip;
  const sheet = ss().getSheetByName(tip);
  const data = sheet.getDataRange().getValues();

  const result = [];

  for (let i = 1; i < data.length; i++) {
    result.push({
      ime: data[i][0],
      adresa: data[i][1],
      ziro: data[i][2]
    });
  }

  return json({ success: true, data: result });
}

/* DODAJ TRANSAKCIJU */

function addTransaction(e) {
  const id = new Date().getTime();
  const datum = new Date();

  const tip = e.parameter.tip;
  const ime = e.parameter.ime;
  const adresa = e.parameter.adresa;
  const ziro = e.parameter.ziro;
  const brojFakture = e.parameter.brojFakture;
  const iznos = Number(e.parameter.iznos);
  const notes = e.parameter.notes || "";

  const sheet = ss().getSheetByName("Transakcije");

  sheet.appendRow([
    id,
    datum,
    tip,
    ime,
    adresa,
    ziro,
    brojFakture,
    iznos,
    notes,
    "ACTIVE"
  ]);

  return json({ success: true, message: "Transakcija sacuvana", id: id });
}

/* DASHBOARD */

function getDashboard() {
  const sheet = ss().getSheetByName("Transakcije");
  const data = sheet.getDataRange().getValues();

  let ulaz = 0;
  let izlaz = 0;
  let poslednje = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[9] !== "ACTIVE") continue;

    const tip = row[2];
    const iznos = Number(row[7]);

    if (tip === "Ulaz") {
      ulaz += iznos;
    } else {
      izlaz += iznos;
    }

    poslednje.push({
      id: row[0],
      datum: row[1],
      tip: row[2],
      ime: row[3],
      brojFakture: row[6],
      iznos: row[7],
      notes: row[8]
    });
  }

  poslednje = poslednje.reverse().slice(0, 20);

  return json({
    success: true,
    stanje: ulaz - izlaz,
    ulaz: ulaz,
    izlaz: izlaz,
    poslednje: poslednje
  });
}


function parseDateFlexible(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "string") {
    const clean = value.trim();

    const serbianDate = clean.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\.?$/);
    if (serbianDate) {
      return new Date(
        Number(serbianDate[3]),
        Number(serbianDate[2]) - 1,
        Number(serbianDate[1])
      );
    }

    const isoDateOnly = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoDateOnly) {
      return new Date(
        Number(isoDateOnly[1]),
        Number(isoDateOnly[2]) - 1,
        Number(isoDateOnly[3])
      );
    }
  }

  const d = new Date(value);
  return d;
}

/* PREGLED TRANSAKCIJA */

function getTransactions(e) {
  const from = e.parameter.from ? new Date(e.parameter.from + "T00:00:00") : null;
  const to = e.parameter.to ? new Date(e.parameter.to + "T23:59:59") : null;

  const sheet = ss().getSheetByName("Transakcije");
  const data = sheet.getDataRange().getValues();

  const result = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const datum = parseDateFlexible(row[1]);

    if (isNaN(datum.getTime())) continue;
    if (from && datum < from) continue;
    if (to && datum > to) continue;

    result.push({
      id: row[0],
      datum: row[1],
      tip: row[2],
      ime: row[3],
      adresa: row[4],
      ziro: row[5],
      brojFakture: row[6],
      iznos: row[7],
      notes: row[8],
      status: row[9]
    });
  }

  result.reverse();

  return json({ success: true, data: result });
}

/* KARTICA */

function getCard(e) {
  const tip = String(e.parameter.tip || "").trim();
  const ime = String(e.parameter.ime || "").trim();
  const normalizedIme = normalizeCardText_(ime);
  const from = e.parameter.from ? new Date(e.parameter.from + "T00:00:00") : null;
  const to = e.parameter.to ? new Date(e.parameter.to + "T23:59:59") : null;
  const view = e.parameter.view || "single";

  const sheet = ss().getSheetByName("Transakcije");
  const data = sheet.getDataRange().getValues();

  const filtered = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    const datum = parseDateFlexible(row[1]);
    if (isNaN(datum.getTime())) continue;
    const rowTip = String(row[2] || "").trim();
    const rowIme = String(row[3] || "").trim();
    const status = String(row[9] || "").trim().toUpperCase();

    if (status === "STORNO" || status === "DELETED") continue;
    if (!normalizedIme && tip && rowTip !== tip) continue;
    if (normalizedIme && !cardNameMatches_(rowIme, normalizedIme)) continue;
    if (from && datum < from) continue;
    if (to && datum > to) continue;

    filtered.push({
      id: row[0],
      datum: row[1],
      tip: row[2],
      ime: row[3],
      adresa: row[4],
      ziro: row[5],
      brojFakture: row[6],
      iznos: Number(row[7]),
      notes: row[8],
      status: row[9]
    });
  }

  if (view === "single") {
    filtered.reverse();
    return json({ success: true, view: "single", data: filtered });
  }

  const grouped = {};

  filtered.forEach(t => {
    const d = parseDateFlexible(t.datum);
    let key = "";

    if (view === "monthly") {
      key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    }

    if (view === "yearly") {
      key = String(d.getFullYear());
    }

    if (!grouped[key]) grouped[key] = 0;
    grouped[key] += t.iznos;
  });

  const result = Object.keys(grouped).map(key => ({
    period: key,
    iznos: grouped[key]
  }));

  result.sort((a, b) => b.period.localeCompare(a.period));

  return json({ success: true, view: view, data: result });
}

function normalizeCardText_(value) {
  return String(value || "")
    .trim()
    .replace(/[.,;:()\-_/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function cardNameMatches_(rowIme, normalizedSearch) {
  const normalizedRowIme = normalizeCardText_(rowIme);
  if (!normalizedRowIme || !normalizedSearch) return false;
  return normalizedRowIme === normalizedSearch ||
    normalizedRowIme.indexOf(normalizedSearch) !== -1 ||
    normalizedSearch.indexOf(normalizedRowIme) !== -1;
}

/* STORNO */

function stornoTransaction(e) {
  const id = e.parameter.id;

  const sheet = ss().getSheetByName("Transakcije");
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.getRange(i + 1, 10).setValue("STORNO");

      return json({ success: true, message: "Transakcija stornirana" });
    }
  }

  return json({ success: false, message: "Transakcija nije pronadjena" });
}

/* SAVE PDF TO GOOGLE DRIVE */

function saveDocument(e) {
  const docType = e.parameter.docType;
  let html = e.parameter.html;
  const datum = e.parameter.datum || "";
  const ime = e.parameter.ime || "Dokument";
  const brojFakture = e.parameter.brojFakture || "BEZ-FAKTURE";

  if (!html) {
    return json({ success: false, message: "HTML dokument nije poslat" });
  }

  html = injectLogoIntoHtml(html);

  let folderId = "";

  if (docType === "transaction") {
    folderId = TRANSACTION_FOLDER_ID;
  } else if (docType === "card") {
    folderId = CARD_FOLDER_ID;
  } else {
    return json({ success: false, message: "Nepoznat tip dokumenta" });
  }

  const fileName = buildPdfFileName(datum, ime, brojFakture);
  const folder = DriveApp.getFolderById(folderId);

  const htmlBlob = Utilities.newBlob(html, "text/html", fileName + ".html");
  const pdfBlob = htmlBlob.getAs(MimeType.PDF).setName(fileName + ".pdf");

  const file = folder.createFile(pdfBlob);

  return json({
    success: true,
    fileName: file.getName(),
    url: file.getUrl()
  });
}

function buildPdfFileName(datum, ime, brojFakture) {
  const cleanDate = formatFileDate(datum);
  const cleanIme = getFirstWord(ime);
  const cleanInvoice = sanitizeFileName(brojFakture || "BEZ-FAKTURE");

  return cleanDate + " - " + cleanIme + " - " + cleanInvoice;
}

function formatFileDate(value) {
  let d = value ? new Date(value) : new Date();

  if (isNaN(d.getTime())) {
    d = new Date();
  }

  return Utilities.formatDate(d, Session.getScriptTimeZone(), "MM-dd-yyyy");
}

function getFirstWord(value) {
  const text = String(value || "Dokument").trim();
  const first = text.split(/\s+/)[0] || "Dokument";
  return sanitizeFileName(first);
}

function sanitizeFileName(value) {
  return String(value || "")
    .replace(/[\\\/\?%\*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}


function getPdfLogoHtml() {
  return `<svg version="1.0" xmlns="http://www.w3.org/2000/svg" width="600.000000pt" height="169.000000pt" viewBox="0 0 600.000000 169.000000" preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,169.000000) scale(0.100000,-0.100000)" stroke="none">
<path fill="#ff0000" d="M715 1676 c-17 -7 -43 -27 -57 -45 -81 -95 -12 -251 111 -251 22 0 41 2 41 5 0 3 -12 24 -26 46 -14 23 -24 43 -21 45 2 2 38 -35 79 -82 l76 -85 -15 -37 c-10 -24 -14 -57 -11 -98 7 -112 80 -184 188 -184 132 0 218 115 189 251 -14 66 -75 132 -137 148 -46 13 -112 5 -112 -13 0 -6 16 -38 35 -71 l35 -60 -71 75 c-116 123 -120 130 -107 172 22 72 -18 155 -89 184 -40 17 -69 17 -108 0z"/>
<path d="M1699 888 c-1 -315 -2 -584 -3 -597 0 -13 5 -26 12 -28 9 -4 12 120 12 596 0 394 -3 601 -10 601 -7 0 -10 -198 -11 -572z"/>
<path fill="#ff0000" d="M385 1324 c-42 -21 -81 -61 -100 -99 -17 -37 -21 -150 -5 -160 6 -4 32 9 58 28 81 58 80 54 -17 -51 l-93 -101 -58 6 c-74 7 -119 -17 -150 -83 -57 -118 48 -252 169 -215 53 15 98 68 106 125 9 58 1 72 -31 52 -13 -9 -36 -24 -51 -33 -16 -10 10 24 57 75 59 65 89 91 100 86 44 -18 87 -25 119 -19 148 27 214 187 132 317 -49 77 -161 111 -236 72z"/>
<path d="M3785 1180 c-52 -26 -75 -65 -75 -129 0 -64 29 -99 120 -144 71 -35 90 -68 54 -94 -36 -26 -116 -4 -129 37 -15 48 -44 2 -45 -72 0 -22 96 -43 157 -34 89 12 130 52 139 134 8 76 -15 109 -111 157 -81 40 -98 62 -75 90 7 9 29 15 50 15 32 0 43 -6 64 -32 29 -38 41 -32 51 28 l6 41 -45 12 c-66 16 -116 14 -161 -9z"/>
<path d="M4179 1105 c-18 -49 -56 -147 -86 -217 -29 -70 -53 -130 -53 -133 0 -3 17 -5 38 -5 36 0 38 2 50 45 l12 46 72 -3 71 -3 15 -42 14 -43 78 0 79 0 -26 58 c-31 70 -93 234 -122 322 l-21 65 -45 0 -44 0 -32 -90z m80 -202 c1 -9 -15 -13 -49 -13 -27 0 -50 2 -50 5 0 2 8 26 18 52 11 26 22 57 26 68 7 16 12 9 32 -40 12 -33 23 -66 23 -72z"/>
<path d="M1885 1143 c-13 -105 -38 -261 -51 -318 -7 -33 -14 -63 -14 -67 0 -5 18 -8 40 -8 38 0 40 2 40 31 0 54 23 219 31 219 4 0 29 -55 56 -122 49 -122 49 -123 82 -123 31 0 34 3 56 60 42 113 78 194 85 190 4 -3 10 -37 14 -77 4 -40 9 -97 12 -125 l6 -53 73 0 73 0 -8 33 c-8 29 -30 193 -45 345 l-7 62 -58 0 c-54 0 -58 -2 -64 -26 -11 -44 -88 -224 -96 -224 -8 0 -84 177 -95 223 -7 26 -10 27 -65 27 l-59 0 -6 -47z"/>
<path d="M2575 1176 c-63 -28 -83 -73 -60 -137 14 -43 14 -44 -8 -59 -55 -37 -77 -71 -77 -119 0 -55 20 -88 66 -107 46 -19 95 -18 156 6 46 17 54 18 68 5 11 -10 39 -15 89 -15 l73 0 -45 52 -45 52 40 47 c39 47 39 47 23 78 -8 17 -19 31 -23 31 -4 0 -18 -24 -32 -52 -14 -28 -30 -53 -36 -55 -6 -2 -31 20 -55 48 -33 39 -40 54 -29 57 8 3 27 18 42 33 80 80 -34 185 -147 135z m103 -72 c2 -20 -4 -36 -17 -48 -18 -17 -20 -16 -35 6 -17 23 -21 60 -9 72 4 4 19 6 33 4 20 -2 26 -9 28 -34z m-60 -216 c28 -35 48 -66 45 -70 -2 -5 -18 -8 -34 -8 -43 0 -89 48 -89 93 0 66 15 63 78 -15z"/>
<path d="M2976 1148 c-19 -154 -30 -224 -47 -303 -10 -49 -19 -90 -19 -92 0 -2 17 -3 39 -3 l38 0 7 81 c10 117 18 169 26 169 4 0 30 -55 57 -122 49 -122 50 -123 81 -123 32 0 33 1 84 127 28 70 54 125 58 123 4 -3 11 -40 14 -82 4 -43 9 -99 12 -125 l6 -48 73 0 73 0 -8 38 c-9 36 -32 213 -45 340 l-7 62 -56 0 -57 0 -48 -125 c-27 -69 -52 -125 -56 -125 -9 0 -85 176 -96 223 -7 26 -10 27 -65 27 l-59 0 -5 -42z"/>
<path d="M4525 970 l0 -220 72 0 71 0 -5 100 -6 100 72 0 71 0 0 30 0 30 -70 0 -70 0 0 60 0 60 75 0 75 0 0 30 0 30 -142 0 -143 0 0 -220z"/>
<path d="M4880 970 l0 -220 145 0 145 0 0 30 0 30 -75 0 -75 0 0 70 0 70 75 0 75 0 0 30 0 30 -75 0 -75 0 0 61 0 61 75 -4 75 -3 0 33 0 32 -145 0 -145 0 0 -220z"/>
<path d="M5210 1155 l0 -35 55 6 56 7 -3 -192 -3 -191 73 0 72 0 0 191 0 191 55 -7 55 -6 0 35 0 36 -180 0 -180 0 0 -35z"/>
<path d="M5600 1185 c0 -3 29 -58 65 -123 l65 -117 0 -97 0 -98 70 0 70 0 0 103 0 102 64 118 64 117 -43 0 c-40 0 -44 -3 -54 -32 -20 -58 -56 -138 -62 -138 -4 0 -23 38 -44 85 l-38 85 -79 0 c-43 0 -78 -2 -78 -5z"/>
<path fill="#ff0000" d="M1360 1031 c-52 -27 -80 -74 -80 -132 0 -27 3 -49 6 -49 3 0 26 14 52 32 l47 31 -31 -34 c-17 -19 -54 -59 -83 -91 l-53 -56 -34 14 c-147 61 -305 -81 -264 -237 42 -158 217 -208 326 -94 31 32 45 57 53 94 11 50 6 107 -10 117 -5 3 -37 -14 -71 -37 l-63 -43 99 107 c83 90 101 105 116 97 30 -16 93 -11 128 10 101 62 96 220 -8 272 -45 23 -87 23 -130 -1z"/>
<path fill="#ff0000" d="M401 678 c-52 -25 -96 -89 -105 -151 -18 -118 82 -239 196 -236 69 1 71 7 28 84 l-40 70 70 -75 c115 -122 122 -133 109 -166 -16 -44 -2 -110 32 -149 55 -62 138 -70 200 -18 59 50 73 117 39 190 -24 53 -70 83 -128 83 l-44 0 27 -46 c15 -25 25 -47 23 -50 -3 -2 -39 35 -80 82 l-76 85 14 34 c42 100 -13 238 -109 274 -45 17 -108 13 -156 -11z"/>
<path d="M3603 649 c-34 -13 -30 -50 8 -72 36 -20 34 -42 -5 -42 -31 1 -30 -19 2 -23 28 -4 60 42 42 63 -6 8 -20 17 -31 20 -11 4 -19 15 -19 27 0 16 5 19 25 16 14 -3 25 -2 25 2 0 13 -24 18 -47 9z"/>
<path d="M2548 643 c20 -4 22 -10 22 -64 0 -33 4 -59 10 -59 6 0 10 26 10 59 0 54 2 60 23 64 12 2 -3 4 -33 4 -30 0 -45 -2 -32 -4z"/>
<path d="M2650 585 c0 -37 4 -65 10 -65 6 0 10 15 10 33 l1 32 28 -35 c16 -19 33 -32 37 -27 4 4 -3 18 -16 32 -20 21 -21 25 -7 31 21 8 30 34 16 50 -6 8 -27 14 -45 14 l-34 0 0 -65z m65 45 c8 -13 -13 -40 -31 -40 -8 0 -14 10 -14 25 0 18 5 25 19 25 11 0 23 -5 26 -10z"/>
<path d="M2785 589 c-15 -33 -24 -63 -21 -66 3 -3 10 6 15 21 14 34 47 35 63 1 14 -31 32 -33 22 -2 -11 35 -43 107 -47 107 -2 0 -17 -27 -32 -61z m33 -8 c-15 -5 -21 7 -13 26 7 17 8 17 15 -2 4 -11 3 -22 -2 -24z"/>
<path d="M2895 626 c-22 -34 -15 -75 17 -99 27 -20 78 -18 78 4 0 6 -7 6 -20 -1 -44 -24 -85 34 -61 87 10 21 17 25 46 21 19 -2 35 0 35 4 0 4 -18 8 -40 8 -31 0 -43 -5 -55 -24z"/>
<path d="M3020 601 c0 -27 -3 -56 -6 -65 -4 -11 -1 -16 10 -16 11 0 16 9 16 28 l1 27 22 -27 c13 -16 29 -28 37 -28 10 0 8 6 -7 23 -36 40 -37 47 -7 78 15 16 23 29 18 29 -6 0 -21 -11 -34 -25 -13 -14 -27 -25 -32 -25 -5 0 -6 11 -2 25 4 15 2 25 -5 25 -7 0 -11 -20 -11 -49z"/>
<path d="M3130 586 c0 -36 5 -68 10 -71 6 -4 10 20 10 64 0 41 -4 71 -10 71 -6 0 -10 -28 -10 -64z"/>
<path d="M3190 610 c0 -25 -3 -55 -6 -67 -4 -14 -2 -23 5 -23 6 0 11 19 11 48 l1 47 42 -47 c24 -27 46 -48 50 -48 4 0 7 29 7 65 0 36 -4 65 -9 65 -5 0 -6 -20 -3 -45 2 -25 1 -45 -4 -45 -4 0 -27 21 -51 48 l-42 47 -1 -45z"/>
<path d="M3346 631 c-12 -13 -16 -32 -14 -57 2 -31 9 -42 31 -52 16 -8 40 -11 57 -7 25 5 30 12 30 36 0 16 -4 29 -10 29 -5 0 -10 -11 -10 -24 0 -29 -31 -39 -59 -19 -14 9 -21 25 -21 47 0 43 21 60 65 53 19 -3 35 -2 35 4 0 18 -86 10 -104 -10z"/>
<path d="M3695 585 c-16 -36 -25 -68 -22 -72 4 -3 12 8 18 25 14 41 54 45 63 7 6 -24 26 -36 26 -15 0 13 -48 120 -53 120 -3 0 -17 -29 -32 -65z m33 -4 c-15 -5 -19 4 -11 24 6 18 7 18 13 -1 4 -10 3 -21 -2 -23z"/>
<path d="M3808 585 c-2 -47 0 -65 10 -65 7 0 12 13 12 30 0 23 4 30 20 30 11 0 20 4 20 9 0 5 -9 7 -20 4 -16 -4 -20 0 -20 20 0 20 6 27 28 30 22 3 21 4 -10 6 l-36 1 -4 -65z"/>
<path d="M3900 585 l0 -65 38 1 c30 2 32 3 10 6 -22 3 -28 10 -28 28 0 18 6 25 28 28 l27 4 -27 2 c-23 1 -28 6 -28 25 0 19 6 26 28 29 22 3 20 4 -10 6 l-38 1 0 -65z"/>
<path d="M3998 643 c20 -4 22 -10 22 -64 0 -33 4 -59 10 -59 6 0 10 26 10 59 0 54 2 60 23 64 12 2 -3 4 -33 4 -30 0 -45 -2 -32 -4z"/>
<path d="M4109 614 c12 -19 21 -48 21 -64 0 -16 5 -32 10 -35 6 -4 10 7 10 26 0 17 10 47 21 66 12 19 19 36 16 39 -3 3 -13 -9 -22 -27 l-17 -32 -20 31 c-28 44 -45 40 -19 -4z"/>
<path d="M4293 623 c-6 -16 -18 -45 -27 -65 -9 -21 -12 -38 -7 -38 5 0 12 11 15 25 5 18 13 25 31 25 18 0 26 -7 31 -25 3 -14 12 -25 19 -25 10 0 6 18 -13 65 -14 36 -28 65 -31 65 -4 0 -12 -12 -18 -27z m27 -35 c0 -5 -7 -8 -15 -8 -17 0 -18 2 -9 25 5 13 8 14 15 3 5 -7 9 -16 9 -20z"/>
<path d="M4390 583 c0 -36 3 -63 7 -59 4 4 6 25 4 46 -1 22 0 40 4 40 4 0 26 -21 50 -47 l44 -48 -1 70 c-1 66 -2 67 -7 21 l-6 -49 -43 47 c-23 25 -45 46 -47 46 -3 0 -5 -30 -5 -67z"/>
<path d="M4540 585 l0 -65 44 0 c48 0 76 24 76 65 0 41 -28 65 -76 65 l-44 0 0 -65z m91 31 c18 -40 -1 -80 -39 -84 l-32 -3 0 55 c0 56 0 56 30 56 22 0 33 -6 41 -24z"/>
<path d="M4747 640 c-12 -36 -17 -120 -7 -120 5 0 10 21 10 48 l1 47 26 -50 25 -49 23 43 c17 34 23 40 28 27 4 -10 7 -29 7 -42 0 -13 5 -24 10 -24 11 0 12 25 1 90 l-7 45 -29 -52 -30 -52 -27 52 c-17 33 -28 47 -31 37z"/>
<path d="M4916 634 c-20 -19 -21 -87 -3 -103 69 -57 162 24 111 97 -18 27 -84 31 -108 6z m94 -13 c16 -30 12 -59 -10 -81 -24 -24 -43 -25 -64 -4 -19 18 -21 75 -4 92 19 19 66 15 78 -7z"/>
<path d="M5060 586 c0 -36 5 -68 10 -71 6 -4 10 9 10 32 l1 38 33 -39 c18 -21 36 -34 39 -29 4 6 -2 18 -13 28 -24 22 -26 41 -4 49 9 3 14 15 12 28 -2 19 -10 24 -45 26 l-43 3 0 -65z m67 38 c6 -16 -12 -34 -34 -34 -7 0 -13 11 -13 25 0 18 5 25 20 25 11 0 23 -7 27 -16z"/>
<path d="M5180 582 l0 -68 30 1 c38 2 52 15 17 15 -22 0 -27 5 -27 24 0 19 6 26 28 29 l27 4 -27 2 c-23 1 -28 6 -28 25 0 19 6 26 28 29 22 3 20 4 -10 6 l-38 1 0 -68z"/>
<path d="M3480 531 c0 -5 -3 -18 -6 -28 -5 -16 -4 -16 10 1 18 23 20 36 6 36 -5 0 -10 -4 -10 -9z"/>
</g>
</svg>`.replace('<svg ', '<svg style="width:150px;height:auto;display:block;" ');
}

function injectLogoIntoHtml(html) {
  const htmlLogo = '<div class="logo" style="width:150px;height:auto;display:block;">' + getPdfLogoHtml() + '</div>';
  let output = String(html || "");

  const logoRegex = /<img[^>]*(class=["'][^"']*logo[^"']*["']|alt=["']logo["']|src=["'][^"']*logo[^"']*["'])[^>]*>/gi;

  if (logoRegex.test(output)) {
    output = output.replace(logoRegex, htmlLogo);
  } else {
    output = output.replace(
      /<body([^>]*)>/i,
      '<body$1><div style="margin-bottom:12px;">' + htmlLogo + '</div>'
    );
  }

  output = output.replace(/\.logo\s*\{[^}]*\}/gi, '.logo{width:150px;height:auto;display:block;}');
  output = output.replace(/width:\s*1(?:30|40|45)px/gi, 'width:150px');
  return output;
}


/* UPLOAD RECEIPT TO GOOGLE DRIVE */

function uploadReceipt(e) {
  const fileName = e.parameter.fileName || "racun";
  const mimeType = e.parameter.mimeType || "application/octet-stream";
  const fileData = e.parameter.fileData;
  const note = e.parameter.note || "";

  if (!fileData) {
    return json({ success: false, message: "Fajl nije poslat" });
  }

  const folder = DriveApp.getFolderById(RECEIPTS_FOLDER_ID);
  const bytes = Utilities.base64Decode(fileData);
  const safeOriginalName = sanitizeFileName(fileName);
  const savedName = buildReceiptFileName(safeOriginalName, note);
  const blob = Utilities.newBlob(bytes, mimeType, savedName);
  const file = folder.createFile(blob);

  return json({
    success: true,
    message: "Račun je sačuvan",
    fileName: file.getName(),
    url: file.getUrl()
  });
}

function buildReceiptFileName(originalName, note) {
  const date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd-MM-yyyy");
  const cleanNote = sanitizeFileName(note || "Racun");
  const firstNote = getFirstWord(cleanNote || "Racun");
  const cleanOriginal = sanitizeFileName(originalName || "racun");
  return date + " - " + firstNote + " - " + cleanOriginal;
}


/* RECEIPT FILES FOR TRANSACTION */

function getReceiptFiles(e) {
  const folder = DriveApp.getFolderById(RECEIPTS_FOLDER_ID);
  const files = folder.getFiles();
  const result = [];

  while (files.hasNext()) {
    const file = files.next();

    result.push({
      id: file.getId(),
      name: file.getName(),
      mimeType: file.getMimeType(),
      url: file.getUrl(),
      previewUrl: "https://drive.google.com/file/d/" + file.getId() + "/preview",
      directViewUrl: "https://drive.google.com/uc?export=view&id=" + file.getId(),
      downloadUrl: "https://drive.google.com/uc?export=download&id=" + file.getId()
    });
  }

  result.sort(function(a, b) {
    return String(a.name).localeCompare(String(b.name));
  });

  return json({
    success: true,
    data: result
  });
}

function getReceiptFileData(e) {
  const fileId = e.parameter.fileId;

  if (!fileId) {
    return json({ success: false, message: "Fajl nije izabran" });
  }

  const file = DriveApp.getFileById(fileId);
  const blob = file.getBlob();
  const mimeType = blob.getContentType() || file.getMimeType() || "application/octet-stream";
  const base64 = Utilities.base64Encode(blob.getBytes());

  return json({
    success: true,
    fileName: file.getName(),
    mimeType: mimeType,
    dataUrl: "data:" + mimeType + ";base64," + base64,
    url: file.getUrl(),
    previewUrl: "https://drive.google.com/file/d/" + file.getId() + "/preview",
    directViewUrl: "https://drive.google.com/uc?export=view&id=" + file.getId()
  });
}

function moveReceiptToTransaction(e) {
  const fileId = e.parameter.fileId;
  const datum = e.parameter.datum || new Date();
  const ime = e.parameter.ime || "Dokument";
  const brojFakture = e.parameter.brojFakture || "BEZ-FAKTURE";

  if (!fileId) {
    return json({ success: false, message: "Račun nije izabran" });
  }

  const file = DriveApp.getFileById(fileId);
  const destination = DriveApp.getFolderById(TRANSACTION_RECEIPTS_FOLDER_ID);
  const baseName = buildPdfFileName(datum, ime, brojFakture);
  const extension = getFileExtension(file.getName());
  const newName = extension ? baseName + "." + extension : baseName;

  file.setName(newName);
  file.moveTo(destination);

  return json({
    success: true,
    fileName: file.getName(),
    url: file.getUrl(),
    previewUrl: "https://drive.google.com/file/d/" + file.getId() + "/preview",
    directViewUrl: "https://drive.google.com/uc?export=view&id=" + file.getId()
  });
}

function getFileExtension(name) {
  const clean = String(name || "").trim();
  const lastDot = clean.lastIndexOf(".");

  if (lastDot <= 0 || lastDot === clean.length - 1) {
    return "";
  }

  return sanitizeFileName(clean.substring(lastDot + 1)).toLowerCase();
}


/* OBRACUN - R */

function getEmails(e) {
  const sheet = getOrCreateSheet("Email", ["NAZIV", "ADRESA"]);
  const data = sheet.getDataRange().getValues();
  const result = [];

  for (let i = 1; i < data.length; i++) {
    const naziv = data[i][0];
    const adresa = data[i][1];
    if (!adresa) continue;
    result.push({ naziv: naziv || adresa, adresa: adresa });
  }

  return json({ success: true, data: result });
}

function addEmail(e) {
  const naziv = e.parameter.naziv || "";
  const adresa = e.parameter.adresa || "";

  if (!naziv || !adresa) {
    return json({ success: false, message: "Unesite naziv i email adresu" });
  }

  const sheet = getOrCreateSheet("Email", ["NAZIV", "ADRESA"]);
  sheet.appendRow([naziv, adresa]);

  return json({ success: true, message: "Email je sačuvan" });
}

function saveObracunRPdf(e) {
  const html = e.parameter.html;
  const month = e.parameter.month || "Mesec";
  const year = e.parameter.year || new Date().getFullYear();
  const kurs = e.parameter.kurs || "";
  const data = e.parameter.data || "";

  if (!html) {
    return json({ success: false, message: "HTML dokument nije poslat" });
  }

  const result = createObracunRPdfFile(html, month, year);
  saveObracunRData(month, year, kurs, data, result.url, result.fileName);
  rememberObracunSetupFromRequest_("R", e, result.fileName);

  return json({
    success: true,
    fileName: result.fileName,
    url: result.url
  });
}

function sendObracunREmail(e) {
  const to = e.parameter.to || "";
  const html = e.parameter.html;
  const emailHtml = e.parameter.emailHtml || "";
  const month = e.parameter.month || "Mesec";
  const year = e.parameter.year || new Date().getFullYear();
  const kurs = e.parameter.kurs || "";
  const data = e.parameter.data || "";
  const message = e.parameter.message || "";

  if (!to) {
    return json({ success: false, message: "Nije izabran primalac" });
  }

  if (!html) {
    return json({ success: false, message: "HTML dokument nije poslat" });
  }

  const result = createObracunRPdfFile(html, month, year);
  saveObracunRData(month, year, kurs, data, result.url, result.fileName);
  rememberObracunSetupFromRequest_("R", e, result.fileName);

  const file = DriveApp.getFileById(result.fileId);
  const subject = "OBRAČUN - R " + month + " " + year;

  const plainBody = "Poštovani,\n\nU prilogu se nalazi obračun - R za " + month + " " + year + ".\n\n" + message + "\n\nM&M Safety";

  MailApp.sendEmail({
    to: to,
    subject: subject,
    body: plainBody,
    htmlBody: emailHtml ? injectLogoIntoHtml(emailHtml) : plainBody.replace(/\n/g, "<br>"),
    attachments: [file.getBlob()]
  });

  return json({
    success: true,
    message: "Email je poslat",
    fileName: result.fileName,
    url: result.url
  });
}

function createObracunRPdfFile(html, month, year) {
  const finalHtml = injectLogoIntoHtml(html);
  const fileName = "OBRAČUN - R - " + sanitizeFileName(month) + " " + sanitizeFileName(year) + ".pdf";
  const folder = DriveApp.getFolderById(OBRACUN_R_FOLDER_ID);
  const htmlBlob = Utilities.newBlob(finalHtml, "text/html", fileName.replace(/\.pdf$/i, ".html"));
  const pdfBlob = htmlBlob.getAs(MimeType.PDF).setName(fileName);
  const file = folder.createFile(pdfBlob);

  return {
    fileId: file.getId(),
    fileName: file.getName(),
    url: file.getUrl()
  };
}

function saveObracunRData(month, year, kurs, data, pdfUrl, fileName) {
  const sheet = getOrCreateSheet("ObracunR", ["TIMESTAMP", "ID", "MESEC", "GODINA", "KURS", "DATA_JSON", "PDF_URL", "FILE_NAME"]);
  const id = new Date().getTime();
  sheet.appendRow([new Date(), id, month, year, kurs, data, pdfUrl, fileName]);
}

function getOrCreateSheet(name, headers) {
  const book = ss();
  let sheet = book.getSheetByName(name);

  if (!sheet) {
    sheet = book.insertSheet(name);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  } else {
    const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    const empty = firstRow.every(function(v) { return v === ""; });
    if (empty) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }

  return sheet;
}

function authorizeDrive(){
  DriveApp.getFileById(LOGO_FILE_ID).getBlob();
  const folder1 = DriveApp.getFolderById(TRANSACTION_FOLDER_ID);
  const folder2 = DriveApp.getFolderById(CARD_FOLDER_ID);
  const folder3 = DriveApp.getFolderById(RECEIPTS_FOLDER_ID);
  const folder4 = DriveApp.getFolderById(TRANSACTION_RECEIPTS_FOLDER_ID);
  const folder5 = DriveApp.getFolderById(OBRACUN_R_FOLDER_ID);
  const folder6 = DriveApp.getFolderById(OBRACUN_K_FOLDER_ID);
  folder1.createFile("authorization-test-transactions.txt", "authorization test");
  folder2.createFile("authorization-test-cards.txt", "authorization test");
  folder3.createFile("authorization-test-receipts.txt", "authorization test");
  folder4.createFile("authorization-test-transaction-receipts.txt", "authorization test");
  folder5.createFile("authorization-test-obracun-r.txt", "authorization test");
  folder6.createFile("authorization-test-obracun-k.txt", "authorization test");
}


/* OBRACUN - K */

function saveObracunKPdf(e) {
  const html = e.parameter.html || "";
  const month = e.parameter.month || "";
  const year = e.parameter.year || "";
  const data = e.parameter.data || "";

  const result = createObracunKPdfFile(html, month, year);
  saveObracunKData(month, year, data, result.url, result.fileName);
  rememberObracunSetupFromRequest_("K", e, result.fileName);

  return json({
    success: true,
    fileName: result.fileName,
    url: result.url
  });
}

function sendObracunKEmail(e) {
  const to = e.parameter.to || "";
  const html = e.parameter.html || "";
  const month = e.parameter.month || "";
  const year = e.parameter.year || "";
  const data = e.parameter.data || "";
  const message = e.parameter.message || "";
  const emailHtml = e.parameter.emailHtml || "";

  if (!to) {
    return json({ success: false, message: "Nema primaoca" });
  }

  const result = createObracunKPdfFile(html, month, year);
  saveObracunKData(month, year, data, result.url, result.fileName);
  rememberObracunSetupFromRequest_("K", e, result.fileName);

  const file = DriveApp.getFileById(result.fileId);
  const subject = "OBRAČUN - K " + month + " " + year;
  const plainBody = "Poštovani,\n\nU prilogu se nalazi obračun - K za " + month + " " + year + ".\n\n" + message + "\n\nM&M Safety";

  MailApp.sendEmail({
    to: to,
    subject: subject,
    body: plainBody,
    htmlBody: emailHtml ? injectLogoIntoHtml(emailHtml) : plainBody.replace(/\n/g, "<br>"),
    attachments: [file.getBlob()]
  });

  return json({
    success: true,
    message: "Email je poslat",
    fileName: result.fileName,
    url: result.url
  });
}

function createObracunKPdfFile(html, month, year) {
  const finalHtml = injectLogoIntoHtml(html);
  const fileName = "OBRAČUN - K - " + sanitizeFileName(month) + " " + sanitizeFileName(year) + ".pdf";
  const folder = DriveApp.getFolderById(OBRACUN_K_FOLDER_ID);
  const htmlBlob = Utilities.newBlob(finalHtml, "text/html", fileName.replace(/\.pdf$/i, ".html"));
  const pdfBlob = htmlBlob.getAs(MimeType.PDF).setName(fileName);
  const file = folder.createFile(pdfBlob);

  return {
    fileId: file.getId(),
    fileName: file.getName(),
    url: file.getUrl()
  };
}

function saveObracunKData(month, year, data, pdfUrl, fileName) {
  const sheet = getOrCreateSheet("ObracunK", ["TIMESTAMP", "ID", "MESEC", "GODINA", "DATA_JSON", "PDF_URL", "FILE_NAME"]);
  const id = new Date().getTime();
  sheet.appendRow([new Date(), id, month, year, data, pdfUrl, fileName]);
}



/* FAKTURA */

function getNextInvoiceNumber(e) {
  const sheet = getOrCreateSheet("Faktura", ["Datum izdavanja", "Broj fakture", "Datum placanja", "Kompanija", "Iznos"]);
  const data = sheet.getDataRange().getValues();

  let maxNo = 0;
  const year = new Date().getFullYear();

  for (let i = 1; i < data.length; i++) {
    const broj = String(data[i][1] || "");
    const match = broj.match(/^(\d+)\/(\d{4})$/);
    if (match && Number(match[2]) === year) {
      maxNo = Math.max(maxNo, Number(match[1]));
    }
  }

  const next = String(maxNo + 1).padStart(3, "0") + "/" + year;

  return json({
    success: true,
    invoiceNumber: next
  });
}

function getInvoiceCompanies(e) {
  const book = ss();
  const excluded = {
    "Login": true,
    "Transakcije": true,
    "Zaposleni": true,
    "Artikli": true,
    "Email": true,
    "Faktura": true,
    "ObracunR": true,
    "ObracunK": true
  };

  const result = [];

  book.getSheets().forEach(sheet => {
    const name = sheet.getName();
    if (excluded[name]) return;

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;

      result.push({
        tip: name,
        ime: data[i][0],
        adresa: data[i][1] || "",
        ziro: data[i][2] || ""
      });
    }
  });

  return json({
    success: true,
    data: result
  });
}

function getInvoiceArticles(e) {
  const sheet = ss().getSheetByName("Artikli");

  if (!sheet) {
    return json({ success: true, data: [] });
  }

  const data = sheet.getDataRange().getValues();
  const result = [];

  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;

    result.push({
      naziv: data[i][0],
      cena: data[i][1] || ""
    });
  }

  return json({
    success: true,
    data: result
  });
}

function saveInvoicePdf(e) {
  const html = e.parameter.html || "";
  const invoiceNumber = e.parameter.invoiceNumber || "";
  const issueDate = e.parameter.issueDate || "";
  const dueDate = e.parameter.dueDate || "";
  const company = e.parameter.company || "";
  const total = e.parameter.total || "";

  if (!html) {
    return json({ success: false, message: "HTML fakture nije poslat" });
  }

  const result = createInvoicePdfFile(html, invoiceNumber);
  saveInvoiceData(issueDate, invoiceNumber, dueDate, company, total, result.url, result.fileName);

  return json({
    success: true,
    fileName: result.fileName,
    url: result.url
  });
}

function sendInvoiceEmail(e) {
  const to = e.parameter.to || "";
  const html = e.parameter.html || "";
  const emailHtml = e.parameter.emailHtml || "";
  const invoiceNumber = e.parameter.invoiceNumber || "";
  const issueDate = e.parameter.issueDate || "";
  const dueDate = e.parameter.dueDate || "";
  const company = e.parameter.company || "";
  const total = e.parameter.total || "";

  if (!to) {
    return json({ success: false, message: "Nema primaoca" });
  }

  if (!html) {
    return json({ success: false, message: "HTML fakture nije poslat" });
  }

  const result = createInvoicePdfFile(html, invoiceNumber);
  saveInvoiceData(issueDate, invoiceNumber, dueDate, company, total, result.url, result.fileName);

  const file = DriveApp.getFileById(result.fileId);
  const subject = "Invoice " + invoiceNumber + " – M&M SAFETY DOO";

  MailApp.sendEmail({
    to: to,
    subject: subject,
    body: "Poštovani,\n\nPDF faktura je u prilogu.\n\nM&M Safety",
    htmlBody: emailHtml ? injectLogoIntoHtml(emailHtml) : "PDF faktura je u prilogu.",
    attachments: [file.getBlob()]
  });

  return json({
    success: true,
    message: "Email je poslat",
    fileName: result.fileName,
    url: result.url
  });
}

function createInvoicePdfFile(html, invoiceNumber) {
  const cleanNumber = sanitizeFileName(String(invoiceNumber || "invoice").replace("/", "_"));
  const fileName = "Invoice_" + cleanNumber + ".pdf";
  const folder = DriveApp.getFolderById(INVOICE_FOLDER_ID);

  const finalHtml = injectLogoIntoHtml(String(html || ""));
  const htmlBlob = Utilities.newBlob(finalHtml, "text/html", fileName.replace(/\.pdf$/i, ".html"));
  const pdfBlob = htmlBlob.getAs(MimeType.PDF).setName(fileName);
  const file = folder.createFile(pdfBlob);

  return {
    fileId: file.getId(),
    fileName: file.getName(),
    url: file.getUrl()
  };
}

function saveInvoiceData(issueDate, invoiceNumber, dueDate, company, total, pdfUrl, fileName) {
  const sheet = getOrCreateSheet("Faktura", ["Datum izdavanja", "Broj fakture", "Datum placanja", "Kompanija", "Iznos", "PDF_URL", "FILE_NAME"]);
  sheet.appendRow([issueDate, invoiceNumber, dueDate, company, total, pdfUrl, fileName]);
}
