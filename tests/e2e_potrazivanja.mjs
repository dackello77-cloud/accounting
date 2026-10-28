// Potraživanja: Playwright provera na DEV projektu: račun sa podacima, uplate kroz Klijenti
// (delimično, preplata, storno), Potraživanja / Realizovane, dopuna podataka iz liste na čekanju.
// Pokretanje (aplikacija na http://localhost:8001):
//   TEST_USER=test TEST_PASSWORD=... [CHROMIUM_PATH=...] node tests/e2e_potrazivanja.mjs
import { chromium } from "playwright";

const BASE = process.env.APP_URL || "http://localhost:8001/index.html";
const PASSWORD = process.env.TEST_PASSWORD;
if(!PASSWORD){ console.error("Nedostaje TEST_PASSWORD"); process.exit(2); }
const run = Date.now().toString(36).slice(-5);
const company = "Dobavljač Čačak " + run;
const number = "R-" + run;
let failures = 0;
const ok = (cond, label) => { console.log((cond ? "ok   " : "FAIL ") + label); if(!cond) failures++; };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(e.message));
page.on("dialog", d => d.accept());

async function waitStatus(id, re, timeout = 60000){
    await page.waitForFunction(([i, src]) => new RegExp(src).test(document.getElementById(i).textContent), [id, re.source], { timeout });
    return page.textContent("#" + id);
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

async function openTxMenu(type){
    if(await page.isHidden(".menu .submenu")) await page.click(".menu-group-btn");
    await page.click(`.menu .submenu button:text-is("${type}")`);
}

// Uplata kroz Transakcije → Klijenti sa izabranom fakturom; vraća tekst opcije pre izbora.
async function pay(amount){
    await openTxMenu("Klijenti");
    await page.waitForFunction(() => document.querySelectorAll("#transactionPartner option").length > 1);
    await page.click("text=PREUZMI RAČUN");
    await page.waitForFunction(() => document.querySelectorAll("#transactionReceiptSelect option").length > 1);
    const option = await page.$eval("#transactionReceiptSelect", (s, n) => {
        const o = [...s.options].find(o => o.textContent.includes(n));
        return o ? { value: o.value, text: o.textContent } : null;
    }, number);
    if(!option) return null;
    await page.selectOption("#transactionReceiptSelect", option.value);
    await page.waitForFunction(() => document.getElementById("transactionInvoice").value !== "");
    const filled = {
        partner: await page.$eval("#transactionPartner", s => s.selectedOptions[0]?.textContent),
        invoice: await page.inputValue("#transactionInvoice"),
        amount: await page.inputValue("#transactionAmount")
    };
    await page.fill("#transactionAmount", amount);
    await page.click("#transactionSaveBtn");
    await page.waitForSelector("#transactionDocActions", { state: "visible" });
    await page.click("#transactionModal .close-btn");
    return { option: option.text, filled };
}

async function receivableRow(tab){
    await page.click(".menu button:has-text('Potraživanja')");
    await page.click(tab === "done" ? "#receivablesTabDone" : "#receivablesTabOpen");
    await page.waitForFunction(() => !/Učitavam/.test(document.getElementById("receivablesTable").textContent));
    return page.$$eval("#receivablesTable tr", (rows, n) => {
        const r = rows.find(r => r.cells[1]?.textContent === n);
        return r ? [...r.cells].map(c => c.textContent.trim()) : null;
    }, number);
}

await page.goto(BASE);
await page.fill("#username", process.env.TEST_USER || "test");
await page.fill("#password", PASSWORD);
await page.click("#loginBtn");
await page.waitForSelector("#loginPage", { state: "hidden" });

const partner = await page.evaluate(async (name) => {
    const api = await import("./js/api.js");
    return api.savePartner(null, { group_type: "klijenti", name, address: "Glavna 1, Čačak", bank_account: "160-1234-56" });
}, company);

// 1. Sačuvaj račun: samo kompanija → greška; sva tri → potraživanje
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
await page.click(".menu button:has-text('Sačuvaj račun')");
await page.waitForFunction(() => document.querySelectorAll("#receiptPartner option").length > 1);
await page.setInputFiles("#receiptFile", { name: `faktura-${run}.png`, mimeType: "image/png", buffer: png });
await page.selectOption("#receiptPartner", { label: company });
await page.click("#receiptSaveBtn");
ok(/broj fakture/.test(await page.textContent("#receiptMessage")), "samo kompanija → traži broj fakture");
await page.fill("#receiptInvoice", number);
await page.fill("#receiptAmount", "1.000,00");
await page.click("#receiptSaveBtn");
ok(/uspešno sačuvan/.test(await waitStatus("receiptMessage", /sačuvan|Greška/)), "račun sa podacima sačuvan");
await page.waitForTimeout(2500);
const [receipt] = await query("receipts", { invoice_number: number });
ok(receipt && receipt.partner_id === partner.id && Number(receipt.amount) === 1000, "receipts: kompanija, broj, iznos");

// 2. Potraživanja: neplaćena
let row = await receivableRow("open");
ok(row && row[0] === company && row[2] === "1.000,00" && row[3] === "0,00" && row[4] === "1.000,00" && /Neplaćena/.test(row[5]), "Potraživanja: neplaćena 1.000,00");
await page.click("#receivablesModal .close-btn");

// 3. Uplata 300: formular popunjen iz fakture
let p = await pay("300,00");
ok(p && /preostalo 1\.000,00/.test(p.option), "lista uz transakciju: preostalo 1.000,00");
ok(p && p.filled.partner === company && p.filled.invoice === number && p.filled.amount === "1.000,00", "formular popunjen: kompanija, broj, preostali iznos");
const [first] = await query("transactions", { receipt_id: receipt.id });
ok(first && Number(first.amount) === 300 && first.type === "klijenti", "transakcija vezana za račun");
const [moved] = await query("receipts", { id: receipt.id });
ok(moved.transaction_id === first.id && moved.storage_path.startsWith(`transactions/${first.id}/`), "račun premešten uz prvu uplatu");

// 4. Uplata 200 → delimično, 500 / 500
p = await pay("200,00");
ok(p && /preostalo 700,00/.test(p.option), "posle 300: preostalo 700,00");
row = await receivableRow("open");
ok(row && row[3] === "500,00" && row[4] === "500,00" && /Delimično plaćena/.test(row[5]), "delimično: plaćeno 500, preostalo 500");
await page.click(`#receivablesTable tr:has(td:text-is("${number}")) button[data-payments]`);
await page.waitForSelector(".recv-payments-table");
ok((await page.$$eval(".recv-payments-table tbody tr", r => r.length)) === 2, "istorija: 2 uplate");
const [still] = await query("receipts", { id: receipt.id });
ok(still.storage_path === moved.storage_path, "druga uplata ne premešta račun");
await page.click("#receivablesModal .close-btn");

// 5. Preplata 600 → realizovana
p = await pay("600,00");
ok(!(await receivableRow("open")), "preplata: nije više u Potraživanjima");
row = await receivableRow("done");
ok(row && row[4] === "0,00" && /Plaćena/.test(row[5]), "Realizovane: plaćena, preostalo 0,00");
await page.click("#receivablesModal .close-btn");

// 6. Storno poslednje uplate → ponovo delimično
const last = (await query("transactions", { receipt_id: receipt.id })).find(t => Number(t.amount) === 600);
await page.evaluate(async (id) => (await import("./js/api.js")).stornoTransaction(id), last.id);
row = await receivableRow("open");
ok(row && row[4] === "500,00" && /Delimično/.test(row[5]), "storno uplate: vraćena u Potraživanja");
await page.click("#receivablesModal .close-btn");

// 7. Običan račun pa dopuna podataka iz liste na čekanju
await page.click(".menu button:has-text('Sačuvaj račun')");
await page.setInputFiles("#receiptFile", { name: `stari-${run}.png`, mimeType: "image/png", buffer: png });
await page.click("#receiptSaveBtn");
ok(/uspešno sačuvan/.test(await waitStatus("receiptMessage", /sačuvan|Greška/)), "običan račun bez podataka");
await page.waitForTimeout(2500);
await page.click("#dashboard .pending-count");
await page.waitForFunction(() => !/Učitavam/.test(document.getElementById("documentsList").textContent));
await page.click(`#documentsList tr:has-text("stari-${run}") button[data-claim]`);
await page.waitForFunction(() => document.querySelectorAll("#claimPartner option").length > 1);
await page.selectOption("#claimPartner", { label: company });
await page.fill("#claimInvoice", number + "-B");
await page.fill("#claimAmount", "50,00");
await page.click("#claimModal .save-btn");
await page.waitForSelector("#claimModal", { state: "hidden" });
await page.waitForFunction((n) => document.getElementById("documentsList").textContent.includes("br. " + n), number + "-B");
ok(true, "lista na čekanju: podaci uneti");
await page.click("#documentsModal .close-btn");
await page.click(".menu button:has-text('Potraživanja')");
await page.waitForFunction((n) => document.getElementById("receivablesTable").textContent.includes(n), number + "-B");
ok(true, "dopunjen račun u Potraživanjima");

ok(pageErrors.length === 0, "bez JS grešaka" + (pageErrors.length ? ": " + pageErrors.join(" | ") : ""));
await browser.close();
console.log(failures ? `\n${failures} provera NIJE prošlo` : "\nSve provere prošle");
process.exit(failures ? 1 : 0);
