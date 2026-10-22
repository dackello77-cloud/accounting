// M3: Playwright provera osnovnih ekrana na DEV projektu (spec. odeljak 8, „Aplikacija”).
// Pokretanje (aplikacija servirana na http://localhost:8001):
//   TEST_USER=test TEST_PASSWORD=... [CHROMIUM_PATH=...] node tests/e2e_m3.mjs
// Lozinka probnog naloga se nikad ne upisuje u repozitorijum.
import { chromium } from "playwright";

const BASE = process.env.APP_URL || "http://localhost:8001/index.html";
const USER = process.env.TEST_USER || "test";
const PASSWORD = process.env.TEST_PASSWORD;
if(!PASSWORD){ console.error("Nedostaje TEST_PASSWORD"); process.exit(2); }

const run = Date.now().toString(36).slice(-5);
const XSS = `<img src=x onerror=alert(1)> ${run}`;
let failures = 0;
const ok = (cond, label) => { console.log((cond ? "ok   " : "FAIL ") + label); if(!cond) failures++; };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
let dialogs = [];
page.on("pageerror", e => pageErrors.push(e.message));
page.on("dialog", async d => { dialogs.push(d.message()); await d.accept(); });

const money = (s) => Number(String(s).replace(/[^\d,-]/g, "").replace(",", "."));
const ymd = (d) => d.toISOString().slice(0, 10);
const yesterday = ymd(new Date(Date.now() - 86400000));

async function login(){
    await page.fill("#username", USER);
    await page.fill("#password", PASSWORD);
    await page.click("#loginBtn");
    await page.waitForSelector("#loginPage", { state: "hidden" });
}

async function addPartner(tip, name, extra = {}){
    await page.click("text=Dodaj / Uredi");
    await page.check(`input[name="addTip"][value="${tip}"]`);
    await page.waitForTimeout(400);
    await page.fill("#addIme", name);
    await page.fill("#addAdresa", extra.address || "Adresa " + run);
    if(extra.ziro) await page.fill("#addZiro", extra.ziro);
    if(extra.tax) await page.fill("#addTaxId", extra.tax);
    dialogs = [];
    await page.click("#addSaveBtn");
    await page.waitForTimeout(800);
    return dialogs.slice();
}

async function addTransaction(type, partnerName, amount, date){
    await page.click(`.menu button:text-is("${type}")`);
    await page.waitForFunction(() => document.querySelectorAll("#transactionPartner option").length > 1);
    await page.selectOption("#transactionPartner", { label: partnerName });
    await page.fill("#transactionAmount", amount);
    if(date) await page.fill("#transactionDate", date);
    await page.fill("#transactionInvoice", "F-" + run);
    await page.click("#transactionSaveBtn");
    await page.waitForSelector("#transactionDocActions", { state: "visible" });
    await page.click("#transactionModal .close-btn");
}

async function dashboardValues(){
    await page.evaluate(() => window.loadDashboard());
    await page.waitForTimeout(1200);
    return {
        stanje: money(await page.textContent("#stanje")),
        ulaz: money(await page.textContent("#ulaz")),
        izlaz: money(await page.textContent("#izlaz"))
    };
}

await page.goto(BASE);
await login();
ok(await page.isVisible("#dashboard"), "prijava sa username-om");

const before = await dashboardValues();

// Dodaj / Uredi
let d = await addPartner("ulaz", "E2E Poslodavac " + run, { ziro: "160-0000-11" });
ok(d.includes("Uspešno sačuvano"), "dodat partner Ulaz");
await addPartner("porezi", "E2E Porez " + run);
await addPartner("zaposleni", "Marko " + run);
await addPartner("zaposleni", "Marko Marković " + run);
await addPartner("klijenti", XSS);
d = await addPartner("klijenti", "Loš PIB " + run, { tax: "123" });
ok(d.some(m => /PIB mora imati 9 cifara/.test(m)), "PIB sa 3 cifre odbijen");
await page.click("#addModal .close-btn");

// Porezi: padajući meni ima samo partnere grupe Porezi
await page.click('.menu button:text-is("Porezi")');
await page.waitForFunction(() => document.querySelectorAll("#transactionPartner option").length > 1);
ok((await page.textContent("#transactionTitle")).includes("Porezi"), "naslov: Nova transakcija – Porezi");
const porezOptions = await page.$$eval("#transactionPartner option", os => os.map(o => o.textContent));
ok(porezOptions.includes("E2E Porez " + run) && !porezOptions.some(o => o.includes("Marko") || o.includes("Poslodavac")), "Porezi: samo partneri grupe Porezi");
await page.click("#transactionModal .close-btn");

// Transakcije
await addTransaction("Ulaz", "E2E Poslodavac " + run, "100.000,50", yesterday);
await addTransaction("Porezi", "E2E Porez " + run, "1.234,56");
await addTransaction("Zaposleni", "Marko " + run, "30.000");
await addTransaction("Zaposleni", "Marko Marković " + run, "40.000");
await addTransaction("Klijenti", XSS, "500");

const after = await dashboardValues();
ok(Math.abs((after.ulaz - before.ulaz) - 100000.50) < 0.001, "dashboard: ulaz +100.000,50");
ok(Math.abs((after.izlaz - before.izlaz) - 71734.56) < 0.001, "dashboard: izlaz +71.734,56");
ok(Math.abs((after.stanje - before.stanje) - 28265.94) < 0.001, "dashboard: stanje +28.265,94");

// XSS prikazan kao tekst
ok(dialogs.every(m => m !== "1"), "XSS: nema alert(1)");
ok(await page.locator("#transactionsTable td", { hasText: "<img src=x" }).count() > 0, "XSS: dashboard prikazuje naziv kao tekst");

// Pregled: jučerašnja transakcija vidljiva; storno
await page.click("text=Pregled");
await page.fill("#reviewFrom", yesterday);
await page.click("#reviewModal button:text-is('Prikaži')");
await page.waitForTimeout(1200);
const reviewText = await page.textContent("#reviewTable");
ok(reviewText.includes("E2E Poslodavac " + run), "Pregled: jučerašnja transakcija vidljiva");
ok(reviewText.includes("<img src=x"), "XSS: Pregled prikazuje naziv kao tekst");
const markoRow = page.locator("#reviewTable tr", { hasText: "Marko Marković " + run });
dialogs = [];
await markoRow.locator("button[data-storno]").click();
await page.waitForTimeout(1500);
ok(dialogs.includes("Transakcija je stornirana"), "STORNO potvrđen");
ok((await markoRow.textContent()).includes("STORNO") && await markoRow.locator("button").isDisabled(), "storniran red: status STORNO, dugme isključeno");
await page.click("#reviewModal .close-btn");

const afterStorno = await dashboardValues();
ok(Math.abs((after.izlaz - afterStorno.izlaz) - 40000) < 0.001, "storno se ne računa u dashboard");

// Kartica po partner_id: „Marko” ne hvata „Marko Marković”
await page.click("text=Kartica");
await page.check('input[name="cardTip"][value="zaposleni"]');
await page.waitForFunction(() => document.querySelectorAll("#cardPartner option").length > 2);
await page.selectOption("#cardPartner", { label: "Marko " + run });
await page.fill("#cardFrom", yesterday);
await page.click("#cardModal button:text-is('PRIKAŽI')");
await page.waitForTimeout(1200);
const cardText = await page.textContent("#cardTable");
ok(cardText.includes("Marko " + run) && !cardText.includes("Marković"), "Kartica: Marko ne hvata Marko Marković");
ok(/30\.000,00 RSD/.test(cardText), "Kartica: zbir 30.000,00");
await page.check('input[name="cardTip"][value="ulaz"]');
await page.waitForFunction(() => document.querySelectorAll("#cardPartner option").length > 1);
await page.selectOption("#cardPartner", { label: "E2E Poslodavac " + run });
await page.click("#cardModal button:text-is('PRIKAŽI')");
await page.waitForTimeout(1200);
ok((await page.textContent("#cardTable")).includes("100.000,50"), "Kartica: jučerašnja transakcija vidljiva");
await page.check('input[name="cardView"][value="monthly"]');
await page.click("#cardModal button:text-is('PRIKAŽI')");
await page.waitForTimeout(1200);
ok((await page.textContent("#cardHead")).includes("Period"), "Kartica: prikaz po mesecima");
await page.click("#cardModal .close-btn");

// Notes / podsetnik u narednih 24 h → u meniju
await page.evaluate(() => window.openNotesModal());
await page.selectOption("#noteType", "reminder");
const inTwoHours = new Date(Date.now() + 2 * 3600000);
const local = new Date(inTwoHours.getTime() - inTwoHours.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
await page.fill("#noteReminderAt", local);
await page.fill("#noteTitle", "E2E podsetnik " + run);
await page.fill("#noteText", "Tekst " + run);
await page.click("#notesModal button:text-is('SAVE')");
await page.waitForTimeout(1500);
ok((await page.textContent("#notesList")).includes("E2E podsetnik " + run), "Notes: podsetnik sačuvan");
ok((await page.textContent("#sidebarReminderAlerts")).includes("E2E podsetnik " + run), "Podsetnik vidljiv u meniju (24 h)");
const noteCard = page.locator(".note-card", { hasText: "E2E podsetnik " + run });
await noteCard.locator("button[data-delete]").click();
await page.waitForTimeout(1500);
ok(!(await page.textContent("#notesList")).includes("E2E podsetnik " + run), "Notes: brisanje označavanjem");
await page.click("#notesModal .close-btn");

// Istek sesije preko otvorenog prozora: sadržaj ostaje
await page.click('.menu button:text-is("Ulaz")');
await page.waitForFunction(() => document.querySelectorAll("#transactionPartner option").length > 1);
await page.fill("#transactionNotes", "Nesačuvan tekst " + run);
await page.evaluate(async () => { const m = await import("./js/api.js"); await m.sb.auth.signOut({ scope: "local" }); });
await page.waitForSelector("#loginPage", { state: "visible" });
ok(await page.isVisible("#transactionModal"), "istek sesije: prozor ostaje otvoren ispod prijave");
await login();
ok(await page.inputValue("#transactionNotes") === "Nesačuvan tekst " + run, "istek sesije: uneti tekst ostaje posle prijave");

// Trajna sesija posle osvežavanja
await page.reload();
await page.waitForTimeout(2000);
ok(await page.isVisible("#dashboard") && !(await page.isVisible("#loginPage")), "sesija ostaje posle osvežavanja");

// Mobilni prikaz
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + "/m3-mobile.png" : "/dev/null" });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
ok(!overflow, "telefon: bez horizontalnog skrolovanja");

ok(pageErrors.length === 0, "bez JS grešaka" + (pageErrors.length ? ": " + pageErrors.join(" | ") : ""));
await browser.close();
console.log(failures ? `\n${failures} provera NIJE prošlo` : "\nSve provere prošle");
process.exit(failures ? 1 : 0);
