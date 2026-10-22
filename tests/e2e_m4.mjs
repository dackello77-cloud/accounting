// M4: Playwright provera dokumenata na DEV projektu: račun, PDF transakcije/kartice,
// Obračun R i K, Faktura (jedan red i jedan fajl posle dva čuvanja), Dokumenti, slanje mejla.
// Pokretanje (aplikacija na http://localhost:8001):
//   TEST_USER=test TEST_PASSWORD=... [CHROMIUM_PATH=...] [PDF_DIR=...] [SEND_EMAIL=1] node tests/e2e_m4.mjs
import { chromium } from "playwright";
import { writeFileSync } from "fs";

const BASE = process.env.APP_URL || "http://localhost:8001/index.html";
const PASSWORD = process.env.TEST_PASSWORD;
if(!PASSWORD){ console.error("Nedostaje TEST_PASSWORD"); process.exit(2); }
const PDF_DIR = process.env.PDF_DIR || "";
const run = Date.now().toString(36).slice(-5);
let failures = 0;
const ok = (cond, label) => { console.log((cond ? "ok   " : "FAIL ") + label); if(!cond) failures++; };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(e.message));
page.on("dialog", d => d.accept());
// PRINT otvara dijalog štampe u iframe-u; u testu ga gasimo.
await context.addInitScript(() => { window.print = () => {}; HTMLIFrameElement.prototype.__noop = true; });

const statusOf = (id) => page.textContent("#" + id);
async function waitStatus(id, re, timeout = 60000){
    await page.waitForFunction(([i, src]) => new RegExp(src).test(document.getElementById(i).textContent), [id, re.source], { timeout });
    return statusOf(id);
}

// Preuzima fajl iz Storage-a kroz aplikaciju (signed URL) i vraća bajtove.
async function fetchStorage(bucket, path){
    const b64 = await page.evaluate(async ([bucket, path]) => {
        const api = await import("./js/api.js");
        const url = await api.signedUrl(bucket, path);
        const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
        let s = ""; for(const x of buf) s += String.fromCharCode(x);
        return btoa(s);
    }, [bucket, path]);
    return Buffer.from(b64, "base64");
}

async function query(table, filter){
    return page.evaluate(async ([table, filter]) => {
        const { sb } = await import("./js/api.js");
        let q = sb.from(table).select("*");
        for(const [k, v] of Object.entries(filter)) q = q.eq(k, v);
        const { data, error } = await q;
        if(error) throw new Error(error.message);
        return data;
    }, [table, filter]);
}

function savePdf(name, bytes){
    if(PDF_DIR) writeFileSync(`${PDF_DIR}/${name}`, bytes);
}

await page.goto(BASE);
await page.fill("#username", process.env.TEST_USER || "test");
await page.fill("#password", PASSWORD);
await page.click("#loginBtn");
await page.waitForSelector("#loginPage", { state: "hidden" });

// Partneri za ovaj prolaz
await page.evaluate(async (run) => {
    const api = await import("./js/api.js");
    await api.savePartner(null, { group_type: "ulaz", name: "Kupac Čačak " + run, address: "Main St 1, Dallas", country: "US", tax_id: "12-3456789", bank_account: "US-ACC-1" });
    await api.savePartner(null, { group_type: "zaposleni", name: "Đorđe Šćekić " + run });
    await api.addEmailRecipient(`primalac-${run}@example.com`, "Probni primalac");
}, run);

// 1. Sačuvaj račun
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
await page.click("text=Sačuvaj račun");
await page.setInputFiles("#receiptFile", { name: `gorivo-${run}.png`, mimeType: "image/png", buffer: png });
await page.fill("#receiptNote", "gorivo " + run);
await page.click("#receiptModal .save-btn:not(#receiptPickerBtn)");
ok(/uspešno sačuvan/.test(await waitStatus("receiptMessage", /sačuvan|Greška/)), "Sačuvaj račun: upload u inbox");
await page.waitForTimeout(2500);

// 2. Transakcija sa računom + SAVE PDF
await page.click('.menu button:text-is("Ulaz")');
await page.waitForFunction(() => document.querySelectorAll("#transactionPartner option").length > 1);
await page.selectOption("#transactionPartner", { label: "Kupac Čačak " + run });
await page.fill("#transactionAmount", "250.000,75");
await page.fill("#transactionInvoice", "INV-" + run);
await page.click("text=PREUZMI RAČUN");
await page.waitForFunction(() => document.querySelectorAll("#transactionReceiptSelect option").length > 1);
const receiptOption = await page.$eval("#transactionReceiptSelect", (s, run) => [...s.options].find(o => o.textContent.includes(run))?.value, run);
await page.selectOption("#transactionReceiptSelect", receiptOption);
await page.waitForSelector("#transactionReceiptPreview img");
ok(true, "račun prikazan u preview-u");
await page.click("#transactionSaveBtn");
await page.waitForSelector("#transactionDocActions", { state: "visible" });
await page.waitForTimeout(1500);
ok(/povezan i preimenovan/.test(await page.textContent("#transactionReceiptInfo")), "račun povezan sa transakcijom");
await page.click("#transactionDocActions >> text=SAVE PDF");
let st = await waitStatus("transactionDocStatus", /PDF je sačuvan|Greška/);
ok(/PDF je sačuvan: \d\d-\d\d-\d{4} - Kupac - INV-/.test(st), "SAVE PDF transakcije: " + st);
const [tx] = await query("transactions", { invoice_number: "INV-" + run });
ok(tx && tx.document_path && tx.document_path.startsWith("transakcije/" + tx.id), "transactions.document_path postavljen");
const [rcpt] = await query("receipts", { transaction_id: tx.id });
ok(rcpt && rcpt.storage_path.startsWith(`transactions/${tx.id}/`), "receipts: premešten u transactions/<id>/");
const txPdf = await fetchStorage("documents", tx.document_path);
ok(txPdf.subarray(0, 5).toString() === "%PDF-", "PDF transakcije je pravi PDF");
savePdf("transakcija.pdf", txPdf);
await page.click("#transactionModal .close-btn");

// 3. Kartica SAVE PDF
await page.click("text=Kartica");
await page.check('input[name="cardTip"][value="ulaz"]');
await page.waitForFunction(() => document.querySelectorAll("#cardPartner option").length > 1);
await page.selectOption("#cardPartner", { label: "Kupac Čačak " + run });
await page.click("#cardModal button:text-is('PRIKAŽI')");
await page.waitForTimeout(1200);
await page.click("#cardModal button:text-is('SAVE PDF')");
st = await waitStatus("cardDocStatus", /PDF je sačuvan|Greška/);
ok(/PDF je sačuvan/.test(st), "SAVE PDF kartice: " + st);
await page.click("#cardModal .close-btn");

// 4. Obračun R
await page.click("text=Obračun - R");
await page.waitForTimeout(2000);
await page.fill("#obracunRate", "100");
await page.dispatchEvent("#obracunRate", "input");
await page.fill("#taxRows tr:first-child .obracun-r-name", "PIO " + run);
await page.fill("#taxRows tr:first-child .obracun-r-money", "10000");
await page.dispatchEvent("#taxRows tr:first-child .obracun-r-money", "input");
await page.click("#obracunRModal button:text-is('Učitaj zaposlene')");
await page.waitForTimeout(1200);
const salaryText = await page.$$eval("#salaryRows .obracun-r-name", els => els.map(e => e.value).join("|"));
ok(salaryText.includes("Đorđe Šćekić " + run), "Obračun R: zaposleni učitani");
ok((await page.textContent("#sumTaxUsd")) === "100.00", "Obračun R: USD preračun (10.000 / 100 = 100.00)");
await page.click("text=SAVE PDF >> nth=0").catch(() => {});
await page.click("#obracunRModal .obracun-r-actions .doc-btn-save");
st = await waitStatus("obracunStatus", /PDF je sačuvan|Greška/);
ok(/OBRAČUN - R - /.test(st), "Obračun R SAVE PDF: " + st);
await page.click("#obracunRModal .obracun-r-actions .doc-btn-save");
await waitStatus("obracunStatus", /PDF je sačuvan|Greška/);
const monthIdx = new Date().getMonth() + 1, year = new Date().getFullYear();
const rRows = await query("payroll_r", { month: monthIdx, year });
ok(rRows.length === 1 && Number(rRows[0].usd_rate) === 100, "payroll_r: jedan red za mesec posle dva čuvanja");
savePdf("obracun_r.pdf", await fetchStorage("documents", rRows[0].pdf_path));
await page.waitForTimeout(1500);
const draftR = await query("calc_drafts", { type: "R" });
ok(draftR.length === 1 && draftR[0].data.rate === "100", "calc_drafts R: autosave");
await page.click("#obracunRModal .close-btn");

// 5. Obračun K
await page.click("text=Obračun - K");
await page.waitForTimeout(2000);
await page.click("#obracunKModal button:has-text('Učitaj')").catch(() => {});
await page.waitForTimeout(800);
ok((await page.textContent("#obracunKRows")).includes("Đorđe Šćekić " + run), "Obračun K: zaposleni učitani");
await page.check("#obracunKExtraEnabled");
await page.fill("#obracunKExtraTitle", "Dodatne smene");
await page.dispatchEvent("#obracunKExtraTitle", "input");
await page.fill("#obracunKNotes", "Napomena " + run);
await page.dispatchEvent("#obracunKNotes", "input");
await page.click("#obracunKModal .doc-btn-save");
st = await waitStatus("obracunKStatus", /PDF je sačuvan|Greška/);
ok(/OBRAČUN - K - /.test(st), "Obračun K SAVE PDF: " + st);
const kRows = await query("payroll_k", { month: monthIdx, year });
ok(kRows.length === 1 && kRows[0].data.notes === "Napomena " + run, "payroll_k: red sa stanjem");
savePdf("obracun_k.pdf", await fetchStorage("documents", kRows[0].pdf_path));
await page.click("#obracunKModal .close-btn");

// 6. Faktura: SAVE PDF dva puta → jedan red, jedan fajl
await page.click(".menu button:text-is('Faktura')");
await page.waitForFunction(() => document.querySelectorAll("#invoiceCompany option").length > 1);
const proposed = await page.inputValue("#invoiceNumber");
ok(/^\d{3}\/\d{4}$/.test(proposed), "Faktura: predlog broja " + proposed);
await page.selectOption("#invoiceCompany", { label: "Kupac Čačak " + run });
await page.check('input[name="invoiceCurrency"][value="USD"]');
await page.fill("#invoiceItemRows tr:first-child .invoice-service", "Dispatch services " + run);
await page.fill("#invoiceItemRows tr:first-child .invoice-qty", "2");
await page.fill("#invoiceItemRows tr:first-child .invoice-price", "1500.5");
await page.dispatchEvent("#invoiceItemRows tr:first-child .invoice-price", "input");
ok((await page.textContent("#invoiceTotalText")) === "3.001,00 USD", "Faktura: zbir 3.001,00 USD");
await page.click("#invoiceModal .invoice-actions .doc-btn-save");
st = await waitStatus("invoiceStatus", /sačuvana|Greška|Izaberite|Dodajte/);
ok(/Faktura je sačuvana: Invoice_\d{3}_\d{4}\.pdf/.test(st), "Faktura SAVE PDF: " + st);
const number = await page.inputValue("#invoiceNumber");
await page.fill("#invoiceItemRows tr:first-child .invoice-qty", "3");
await page.dispatchEvent("#invoiceItemRows tr:first-child .invoice-qty", "input");
await page.click("#invoiceModal .invoice-actions .doc-btn-save");
await page.waitForTimeout(500);
await waitStatus("invoiceStatus", /sačuvana|Greška/);
const invs = await query("invoices", { number });
ok(invs.length === 1 && Number(invs[0].total) === 4501.5 && invs[0].currency === "USD" && invs[0].company_tax_id === "12-3456789", "Faktura: jedan red posle dva čuvanja, zbir ažuriran");
const invDocs = await query("documents", { storage_path: invs[0].pdf_path });
ok(invDocs.length === 1, "Faktura: jedan fajl u documents");
savePdf("faktura.pdf", await fetchStorage("documents", invs[0].pdf_path));

// 7. Slanje mejla (faktura) – samo kad je send-email postavljen
await page.click("#invoiceModal .invoice-actions .doc-btn-both");
await page.waitForFunction(() => document.querySelectorAll("#invoiceEmailSelect option").length > 1);
const emailOption = await page.$eval("#invoiceEmailSelect", (s, run) => [...s.options].find(o => o.textContent.includes(run))?.value, run);
await page.selectOption("#invoiceEmailSelect", emailOption);
await page.click("#invoiceEmailBox button:text-is('Dodaj primaoca')");
if(process.env.SEND_EMAIL){
    await page.click("#invoiceEmailBox button:text-is('SEND')");
    st = await waitStatus("invoiceStatus", /poslat|Greška|Gmail|nije|Funkcija/, 90000);
    ok(/TEST: email je poslat samo na/.test(st), "SEND EMAIL (test režim): " + st);
    const invs2 = await query("invoices", { number });
    ok(invs2.length === 1, "SAVE PDF pa SEND EMAIL → i dalje jedan red");
}
await page.click("#invoiceModal .close-btn");

// 8. Dokumenti
await page.click(".menu button:text-is('Dokumenti')");
await page.click("#documentsGrid button[data-category='fakture']");
await page.waitForTimeout(1500);
ok((await page.textContent("#documentsList")).includes(`Invoice_${number.replace("/", "_")}.pdf`), "Dokumenti: faktura na listi");
await page.click("#documentsGrid button[data-category='racuni']");
await page.waitForTimeout(1500);
ok((await page.textContent("#documentsList")).includes("INV-" + run), "Dokumenti: račun (preimenovan po transakciji) na listi");
await page.click("#documentsGrid button[data-category='izvodi_dinarski']");
await page.waitForTimeout(800);
await page.setInputFiles("#documentsFile", { name: `izvod-${run}.pdf`, mimeType: "application/pdf", buffer: txPdf });
await page.click("text=SAČUVAJ IZVOD");
st = await waitStatus("documentsStatus", /sačuvan|Greška|Dozvoljeni/);
ok(/Izvod je sačuvan/.test(st), "Dokumenti: upload izvoda");
await page.waitForFunction((n) => document.getElementById("documentsList").textContent.includes(n), `izvod-${run}.pdf`, { timeout: 15000 }).catch(() => {});
ok((await page.textContent("#documentsList")).includes(`izvod-${run}.pdf`), "Dokumenti: izvod na listi");
// Otvori: PNG račun (test pregledač nema PDF prikazivač, PDF bi samo preuzeo)
await page.click("#documentsGrid button[data-category='racuni']");
await page.waitForFunction(() => document.querySelectorAll("#documentsList button[data-open]").length > 0);
const pngIndex = await page.$$eval("#documentsList tr", (rows, run) => rows.findIndex(r => r.textContent.includes("INV-" + run)), run);
const popupPromise = context.waitForEvent("page");
await page.click(`#documentsList button[data-open='${pngIndex}']`);
const popup = await popupPromise;
await popup.waitForURL(/token=/, { timeout: 15000 }).catch(() => {});
ok(/token=/.test(popup.url()), "Dokumenti: Otvori → signed URL");
await popup.close();
await page.click("#documentsGrid button[data-category='izvodi_dinarski']");
await page.waitForTimeout(800);
await page.setInputFiles("#documentsFile", { name: `virus-${run}.exe`, mimeType: "application/x-msdownload", buffer: png });
await page.click("text=SAČUVAJ IZVOD");
ok(/Dozvoljeni su samo/.test(await waitStatus("documentsStatus", /Dozvoljeni|sačuvan|Greška/)), "Dokumenti: .exe odbijen");

ok(pageErrors.length === 0, "bez JS grešaka" + (pageErrors.length ? ": " + pageErrors.join(" | ") : ""));
await browser.close();
console.log(failures ? `\n${failures} provera NIJE prošlo` : "\nSve provere prošle");
process.exit(failures ? 1 : 0);
