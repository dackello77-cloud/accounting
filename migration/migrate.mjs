// Migracija 1.x (Google Sheet izvezen kao .xlsx) → Supabase 2.0. Spec: docs/V2_SPEC.md, odeljak 6.
//
//   node migrate.mjs                         probni prolaz: čita Excel, piše output/report.md, baza se ne dira
//   node migrate.mjs --target=dev            upis u praznu dev bazu (ključ iz ../.env)
//   node migrate.mjs --target=dev --reset    prvo briše sve podatke i fajlove na dev-u, pa upisuje
//   node migrate.mjs --target=prod           upis u praznu prod bazu (samo M7, uz potvrdu vlasnika)
//
// Ulaz: input/*.xlsx (tačno jedan), opciono input/partner_map.csv (grupa;stari naziv;šifra partnera)
// i input/corrections.json (ispravke vlasnika: datumi i valute faktura, nazivi kompanija, neaktivni partneri).
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";

const HERE = dirname(fileURLToPath(import.meta.url));
const INPUT = join(HERE, "input");
const OUTPUT = join(HERE, "output");
const DEV_REF = "qflpgxonpkzgcdbrolfz";

const args = process.argv.slice(2);
const TARGET = (args.find(a => a.startsWith("--target=")) || "").slice(9) || null;
if(TARGET && !["dev", "prod"].includes(TARGET)) fail("--target mora biti dev ili prod");
const WRITE = !!TARGET;
const PROD = TARGET === "prod";
const RESET = args.includes("--reset");
if(RESET && TARGET !== "dev") fail("--reset ide samo uz --target=dev");

const MONTHS = ["Januar","Februar","Mart","April","Maj","Jun","Jul","Avgust","Septembar","Oktobar","Novembar","Decembar"];
const GROUPS = { Ulaz: "ulaz", Porezi: "porezi", Klijenti: "klijenti", Zaposleni: "zaposleni" };

function fail(msg){ console.error("GREŠKA: " + msg); process.exit(1); }

// ---------- Pomoćne funkcije ----------

const str = (v) => v === null || v === undefined ? "" : String(v).trim();
const nameKey = (v) => str(v).toLowerCase().replace(/[.,;:()\-_/\\]+/g, "").replace(/\s+/g, "");
const cents = (n) => Math.round(Number(n) * 100);
const money = (c) => (c / 100).toLocaleString("sr-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (n, w = 2) => String(n).padStart(w, "0");

// Excel serijski broj → "zidno" vreme kako ga vidi Sheet (polja u UTC-u Date objekta).
function serialToWall(v){
    if(typeof v !== "number" || !isFinite(v) || v < 20000 || v > 80000) return null;
    return new Date(Math.round((v - 25569) * 86400000));
}

// Datum kao parseDateFlexible u 1.x: Date, d.M.yyyy, yyyy-MM-dd, M/d/yyyy → "yyyy-MM-dd" ili null.
function parseDate(v){
    const w = serialToWall(v);
    if(w) return `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}`;
    const s = str(v);
    let m;
    if((m = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\.?$/))) return validDate(+m[3], +m[2], +m[1]);
    if((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return validDate(+m[1], +m[2], +m[3]);
    if((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return validDate(+m[3], +m[1], +m[2]);
    return null;
}
function validDate(y, mo, d){
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : null;
}

// Zidno vreme u Beogradu → ISO u UTC-u.
const tzFmt = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Belgrade", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
function belgradeOffsetMs(utcMs){
    const p = Object.fromEntries(tzFmt.formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000;
}
function wallToIso(wall){
    if(!wall) return null;
    const guess = wall.getTime();
    return new Date(guess - belgradeOffsetMs(guess - belgradeOffsetMs(guess))).toISOString();
}
const timestampIso = (v) => wallToIso(serialToWall(v));

// Iznos: broj ili tekst "1.234,56" / "2025.19 USD".
function parseAmount(v){
    if(typeof v === "number") return isFinite(v) ? v : null;
    let s = str(v).replace(/\s*(USD|RSD|EUR|din\.?)\s*$/i, "").replace(/\s+/g, "");
    if(!s) return null;
    if(s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    return isFinite(n) ? n : null;
}

function readSheet(wb, name){
    const ws = wb.Sheets[name];
    if(!ws) return [];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    return rows.slice(1).map((r, i) => ({ r, line: i + 2 })).filter(({ r }) => r.some(c => str(c) !== ""));
}

// ---------- Čitanje ----------

const xlsxFiles = readdirSync(INPUT).filter(f => /\.xlsx$/i.test(f) && !f.startsWith("~$"));
if(xlsxFiles.length !== 1) fail(`u ${INPUT} treba tačno jedan .xlsx fajl (nađeno: ${xlsxFiles.length})`);
const wb = XLSX.read(readFileSync(join(INPUT, xlsxFiles[0])), { cellDates: false });

const corrFile = join(INPUT, "corrections.json");
const corr = existsSync(corrFile) ? JSON.parse(readFileSync(corrFile, "utf8")) : {};
const corrApplied = [];

const report = { warnings: [], sections: [] };
const warn = (msg) => report.warnings.push(msg);

// Partneri
const partners = [];
const partnerByKey = {};            // `${group}|${key}` → partner
const mergedDuplicates = [];
for(const [sheet, group] of Object.entries(GROUPS)){
    for(const { r, line } of readSheet(wb, sheet)){
        const name = str(r[0]);
        if(!name){ warn(`${sheet} red ${line}: prazan naziv, preskočeno`); continue; }
        const k = `${group}|${nameKey(name)}`;
        if(partnerByKey[k]){
            const p = partnerByKey[k];
            p.address ||= str(r[1]) || null;
            p.bank_account ||= str(r[2]) || null;
            mergedDuplicates.push(`${sheet} red ${line}: "${name}" spojen sa "${p.name}"`);
            continue;
        }
        const p = { id: randomUUID(), group_type: group, name, address: str(r[1]) || null, country: "RS", bank_account: str(r[2]) || null };
        partners.push(p);
        partnerByKey[k] = p;
    }
}

// Bivši partneri kojih nema u listovima, a imaju transakcije: prave se kao neaktivni.
for(const { group, name } of corr.inactivePartners || []){
    const k = `${group}|${nameKey(name)}`;
    if(partnerByKey[k]){ warn(`corrections.json: "${name}" već postoji u grupi ${group}`); continue; }
    const p = { id: randomUUID(), group_type: group, name, address: null, country: "RS", bank_account: null, active: false };
    partners.push(p);
    partnerByKey[k] = p;
    corrApplied.push(`neaktivan partner ${group}: ${name}`);
}

// partner_map.csv: grupa;stari naziv;šifra partnera (šifra postoji tek posle upisa, pa se ovde čuva samo veza)
const partnerMap = {};
const mapFile = join(INPUT, "partner_map.csv");
if(existsSync(mapFile)){
    for(const [i, lineText] of readFileSync(mapFile, "utf8").split(/\r?\n/).entries()){
        if(!lineText.trim() || i === 0 && /grupa/i.test(lineText)) continue;
        const [g, oldName, code] = lineText.split(";").map(s => s.trim());
        if(!g || !oldName || !code){ warn(`partner_map.csv red ${i + 1}: nepotpun`); continue; }
        partnerMap[`${g.toLowerCase()}|${nameKey(oldName)}`] = code;
    }
}

// Artikli
const articles = readSheet(wb, "Artikli").map(({ r, line }) => {
    const price = parseAmount(r[1]);
    if(price === null) warn(`Artikli red ${line}: neispravna cena "${str(r[1])}", upisano 0`);
    return { name: str(r[0]), price: price ?? 0 };
}).filter(a => a.name);

// Transakcije
const txRows = readSheet(wb, "Transakcije");
const idCount = {};
for(const { r } of txRows){ const id = str(r[0]); if(id) idCount[id] = (idCount[id] || 0) + 1; }
const transactions = [];
const badRows = [];
const unmatched = {};               // `${type}|${name}` → { type, name, count, sum }
const statusUnknown = [];
let lastCreated = 0, missingIds = 0, sharedIds = 0, extraDecimals = 0;
for(const { r, line } of txRows){
    const tipRaw = str(r[2]);
    const type = GROUPS[tipRaw];
    const date = parseDate(r[1]);
    const amount = parseAmount(r[7]);
    if(!type || !date || amount === null){
        badRows.push(`red ${line}: tip "${tipRaw}", datum "${str(r[1])}", iznos "${str(r[7])}"`);
        continue;
    }
    if(Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) extraDecimals++;
    const statusRaw = str(r[9]).toUpperCase();
    if(statusRaw !== "ACTIVE" && statusRaw !== "STORNO") statusUnknown.push(`red ${line}: "${str(r[9])}"`);
    const status = statusRaw === "STORNO" ? "storno" : "active";

    const idText = str(r[0]);
    let legacyId = null;
    if(!idText) missingIds++;
    else if(idCount[idText] > 1) sharedIds++;
    else legacyId = Number(idText);

    // created_at: redosled iz Sheet-a (1.x prikazuje poslednje unete), vreme iz ID-a ili datuma.
    const fromId = legacyId && legacyId > 1.4e12 && legacyId < 2.2e12 ? legacyId : null;
    const base = fromId ?? Date.parse(timestampIso(r[1]) || `${date}T10:00:00Z`);
    lastCreated = Math.max(base, lastCreated + 1);

    const partnerName = str(r[3]);
    const k = `${type}|${nameKey(partnerName)}`;
    let partner = partnerByKey[k];
    let partnerCode = null;
    if(!partner && partnerMap[k]) partnerCode = partnerMap[k];
    if(!partner && !partnerCode){
        const u = unmatched[`${type}|${partnerName}`] ||= { type, name: partnerName, count: 0, sum: 0 };
        u.count++; u.sum += cents(amount);
    }
    transactions.push({
        id: randomUUID(), legacy_id: legacyId, tx_date: date, type,
        partner_id: partner?.id ?? null, partner_code: partnerCode, partner_name: partnerName,
        address: str(r[4]) || null, bank_account: str(r[5]) || null, invoice_number: str(r[6]) || null,
        amount: Math.round(amount * 100) / 100, notes: str(r[8]) || null, status,
        created_at: new Date(lastCreated).toISOString()
    });
}

// Fakture (duplirani broj: ostaje poslednji red)
const invoiceRows = readSheet(wb, "Faktura");
const invoiceByNumber = {};
const duplicateInvoices = [];
const invoiceNotes = [];
const invoicePartnerGroups = ["ulaz", "porezi", "klijenti"];   // kao getInvoiceCompanies u 1.x
for(const { r, line } of invoiceRows){
    const number = str(r[1]);
    if(!number){ warn(`Faktura red ${line}: bez broja, preskočeno`); continue; }
    let issue = parseDate(r[0]);
    if(corr.invoiceDates?.[number]){
        corrApplied.push(`faktura ${number}: datum izdavanja "${issue || str(r[0])}" → ${corr.invoiceDates[number]}`);
        issue = corr.invoiceDates[number];
    }
    const due = parseDate(r[2]);
    if(!issue && !corr.invoiceDates?.[number]) invoiceNotes.push(`${number}: datum izdavanja "${str(r[0])}" neispravan → prazno`);
    const totalRaw = str(r[4]);
    const total = parseAmount(r[4]);
    if(total === null) invoiceNotes.push(`${number}: iznos "${totalRaw}" neispravan → 0`);
    const company = corr.invoiceCompanyAliases?.[str(r[3])] || str(r[3]);
    let currency = /USD/i.test(totalRaw) ? "USD" : /RSD|din/i.test(totalRaw) ? "RSD" : null;
    const defCur = corr.invoiceCurrencyDefault || {};
    if(!currency && (defCur[company] || defCur["*"])){
        currency = defCur[company] || defCur["*"];
        corrApplied.push(`faktura ${number}: valuta ${currency} (${company})`);
    }
    if(!currency) invoiceNotes.push(`${number}: valuta nepoznata (iznos "${totalRaw}") → prazno`);
    const ym = number.match(/^\d+\/(\d{4})$/);
    if(issue && ym && issue.slice(0, 4) !== ym[1]) invoiceNotes.push(`${number}: datum izdavanja ${issue} ne odgovara godini u broju`);
    if(company !== str(r[3])) corrApplied.push(`faktura ${number}: kompanija "${str(r[3])}" → "${company}"`);
    const partner = invoicePartnerGroups.map(g => partnerByKey[`${g}|${nameKey(company)}`]).find(Boolean);
    if(!partner) invoiceNotes.push(`${number}: kompanija "${company}" nema partnera`);
    if(invoiceByNumber[number]) duplicateInvoices.push(`${number}: red ${invoiceByNumber[number].line} zamenjen redom ${line}`);
    invoiceByNumber[number] = {
        line,
        pdfRef: str(r[5]), fileName: str(r[6]) || null,
        row: {
            id: randomUUID(), number, issue_date: issue, due_date: due,
            payment_days: issue && due ? Math.round((Date.parse(due) - Date.parse(issue)) / 86400000) : null,
            currency, partner_id: partner?.id ?? null, company_name: company || null,
            company_address: partner?.address ?? null, company_bank_account: partner?.bank_account ?? null,
            total: total === null ? 0 : Math.round(total * 100) / 100, status: "izdata"
        }
    };
}
const invoices = Object.values(invoiceByNumber);
const counters = {};
for(const { row } of invoices){
    const m = row.number.match(/^(\d+)\/(\d{4})$/);
    if(m) counters[m[2]] = Math.max(counters[m[2]] || 0, Number(m[1]));
}

// Obračuni: aplikacija drži jedan red po mesecu, pa ostaje poslednje čuvanje.
function readPayroll(sheet, hasRate){
    const byPeriod = {};
    let dropped = 0;
    for(const { r, line } of readSheet(wb, sheet)){
        const monthName = str(r[2]);
        const month = MONTHS.indexOf(monthName) + 1;
        const year = Number(r[3]);
        const jsonCol = hasRate ? 5 : 4;
        let parsed;
        try{ parsed = JSON.parse(str(r[jsonCol])); }catch{ warn(`${sheet} red ${line}: DATA_JSON neispravan, preskočeno`); continue; }
        if(!month || !year){ warn(`${sheet} red ${line}: mesec/godina "${monthName} ${str(r[3])}" neispravni, preskočeno`); continue; }
        const rate = hasRate ? parseAmount(r[4]) : null;
        const data = hasRate
            ? { data: parsed, month: monthName, year: String(year), rate: rate ?? "", defaultSalary: "" }
            : { ...parsed, month: parsed.month || monthName, year: String(parsed.year || year) };
        const key = `${year}-${month}`;
        if(byPeriod[key]) dropped++;
        byPeriod[key] = {
            fileName: str(r[hasRate ? 7 : 6]) || null, pdfRef: str(r[hasRate ? 6 : 5]),
            row: { id: randomUUID(), month, year, ...(hasRate ? { usd_rate: rate } : {}), data, created_at: timestampIso(r[0]) || undefined }
        };
    }
    return { items: Object.values(byPeriod), dropped };
}
const payrollR = readPayroll("ObracunR", true);
const payrollK = readPayroll("ObracunK", false);

// Primaoci mejla
const seenEmails = new Set();
const emailRecipients = [];
for(const { r, line } of readSheet(wb, "Email")){
    const email = str(r[1]);
    if(!email){ warn(`Email red ${line}: bez adrese`); continue; }
    if(seenEmails.has(email.toLowerCase())){ warn(`Email red ${line}: duplikat ${email}`); continue; }
    seenEmails.add(email.toLowerCase());
    emailRecipients.push({ name: str(r[0]) || null, email });
}

// Beleške
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notes = readSheet(wb, "Notes").map(({ r }) => ({
    id: uuidRe.test(str(r[0])) ? str(r[0]) : randomUUID(),
    type: str(r[2]).toLowerCase() === "reminder" ? "reminder" : "note",
    title: str(r[3]) || null, body: str(r[4]) || null,
    remind_at: timestampIso(r[5]),
    status: str(r[6]).toUpperCase() === "DELETED" ? "deleted" : "active",
    created_at: timestampIso(r[1]) || undefined
}));

// ---------- Zbirovi iz Sheet-a ----------

function txTotals(list){
    const t = {};
    for(const x of list){
        if(x.status !== "active") continue;
        const k = `${x.tx_date.slice(0, 4)}|${x.type}`;
        t[k] = (t[k] || 0) + cents(x.amount);
    }
    return t;
}
function invoiceTotals(list){
    const t = {};
    for(const x of list){
        const k = `${x.issue_date ? x.issue_date.slice(0, 4) : "bez datuma"}|${x.currency || "?"}`;
        t[k] = (t[k] || 0) + cents(x.total);
    }
    return t;
}
// Kontrola nezavisno od parsiranja: sirovi iznosi iz Sheet-a kao u getDashboard (ACTIVE, bez obzira na datum).
let rawUlaz = 0, rawIzlaz = 0;
for(const { r } of txRows){
    if(str(r[9]) !== "ACTIVE") continue;
    if(str(r[2]) === "Ulaz") rawUlaz += Number(r[7]); else rawIzlaz += Number(r[7]);
}
const sheetTx = txTotals(transactions);
const sheetInv = invoiceTotals(invoices.map(i => i.row));

// ---------- Upis ----------

let dbResult = null;
if(WRITE) dbResult = await writeToDb();

// ---------- Izveštaj ----------

writeReport();
console.log(`Izveštaj: ${join(OUTPUT, "report.md")}`);
if(dbResult && !dbResult.ok){ console.error("GREŠKA: zbirovi u bazi se ne slažu sa Sheet-om (vidi izveštaj)"); process.exit(1); }
if(badRows.length){ console.error(`GREŠKA: ${badRows.length} transakcija sa neispravnim tipom/datumom/iznosom`); process.exit(1); }

async function writeToDb(){
    const { config } = await import("dotenv");
    config({ path: join(HERE, "..", ".env"), quiet: true });
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!url || !key) fail("SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY moraju biti u .env");
    const ref = (url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
    if(PROD ? ref === DEV_REF : ref !== DEV_REF) fail(`.env pokazuje na projekat ${ref}, a cilj je ${TARGET}`);
    if(badRows.length) fail(`${badRows.length} transakcija sa neispravnim podacima; pokrenuti bez --target i proveriti izveštaj`);

    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const run = async (p, what) => { const { data, error } = await p; if(error) fail(`${what}: ${error.message}`); return data; };

    const TABLES = ["receipts", "documents", "invoice_items", "invoices", "transactions", "partners", "articles",
        "payroll_r", "payroll_k", "calc_drafts", "email_recipients", "notes", "invoice_counters"];
    const counts = {};
    for(const t of TABLES){
        const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
        if(error) fail(`${t}: ${error.message}`);
        counts[t] = count;
    }
    const nonEmpty = TABLES.filter(t => counts[t] > 0);
    if(nonEmpty.length && !RESET) fail(`baza nije prazna (${nonEmpty.map(t => `${t}: ${counts[t]}`).join(", ")}); ${PROD ? "prod mora biti prazan" : "na dev-u dodati --reset"}`);

    if(RESET){
        console.log("Brisanje postojećih podataka na dev-u…");
        for(const t of TABLES){
            const q = sb.from(t).delete();
            await run(t === "invoice_counters" ? q.gte("year", 0) : t === "calc_drafts" ? q.neq("type", "") : q.not("id", "is", null), `brisanje ${t}`);
        }
        for(const bucket of ["documents", "receipts", "statements"]) await emptyBucket(sb, bucket);
    }

    const insert = async (table, rows) => {
        for(let i = 0; i < rows.length; i += 200) await run(sb.from(table).insert(rows.slice(i, i + 200)), `upis ${table}`);
        console.log(`  ${table}: ${rows.length}`);
    };
    console.log("Upis…");
    await insert("partners", partners);
    if(Object.keys(partnerMap).length){
        const all = await run(sb.from("partners").select("id, code"), "čitanje šifara");
        const byCode = Object.fromEntries(all.map(p => [p.code, p.id]));
        for(const t of transactions){
            if(!t.partner_code) continue;
            if(byCode[t.partner_code]) t.partner_id = byCode[t.partner_code];
            else warn(`partner_map.csv: šifra ${t.partner_code} ne postoji (${t.partner_name})`);
        }
    }
    await insert("articles", articles);
    await insert("transactions", transactions.map(({ partner_code, ...t }) => t));
    await insert("invoices", invoices.map(i => i.row));
    await insert("invoice_counters", Object.entries(counters).map(([year, last_no]) => ({ year: Number(year), last_no })));
    await insert("payroll_r", payrollR.items.map(i => i.row));
    await insert("payroll_k", payrollK.items.map(i => i.row));
    await insert("email_recipients", emailRecipients);
    await insert("notes", notes);

    // Provera: zbirovi iz baze
    const dbTx = [];
    for(let from = 0; ; from += 1000){
        const page = await run(sb.from("transactions").select("tx_date, type, amount, status").order("id").range(from, from + 999), "čitanje transakcija");
        dbTx.push(...page);
        if(page.length < 1000) break;
    }
    const dbInv = await run(sb.from("invoices").select("issue_date, currency, total"), "čitanje faktura");
    const dbTxT = txTotals(dbTx), dbInvT = invoiceTotals(dbInv);
    const same = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].every(k => (a[k] || 0) === (b[k] || 0));
    return { ok: same(sheetTx, dbTxT) && same(sheetInv, dbInvT) && dbTx.length === transactions.length,
        dbTxT, dbInvT, dbTxCount: dbTx.length, dbInvCount: dbInv.length };
}

async function emptyBucket(sb, bucket){
    const paths = [];
    async function walk(prefix){
        for(let offset = 0; ; offset += 1000){
            const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000, offset });
            if(error) fail(`Storage ${bucket}: ${error.message}`);
            for(const f of data){
                const p = prefix ? `${prefix}/${f.name}` : f.name;
                if(f.id) paths.push(p); else await walk(p);
            }
            if(data.length < 1000) break;
        }
    }
    await walk("");
    for(let i = 0; i < paths.length; i += 100){
        const { error } = await sb.storage.from(bucket).remove(paths.slice(i, i + 100));
        if(error) fail(`Storage ${bucket} brisanje: ${error.message}`);
    }
    console.log(`  Storage ${bucket}: obrisano ${paths.length}`);
}

function writeReport(){
    const L = [];
    const now = new Date().toLocaleString("sr-RS", { timeZone: "Europe/Belgrade" });
    L.push(`# Izveštaj migracije`, ``, `- Izvor: \`${xlsxFiles[0]}\``, `- Vreme: ${now}`,
        `- Režim: ${WRITE ? (RESET ? "upis (dev, posle brisanja)" : "upis") : "probni prolaz (baza nije menjana)"}`);
    if(dbResult) L.push(`- **Provera zbirova u bazi: ${dbResult.ok ? "✅ slaže se do pare" : "❌ RAZLIKA"}**`);
    L.push(``, `## Broj redova`, ``, `| Izvor | Redova u Sheet-u | Tabela | Upisuje se |`, `|---|---:|---|---:|`);
    const n = (s) => readSheet(wb, s).length;
    for(const s of Object.keys(GROUPS)) L.push(`| ${s} | ${n(s)} | partners (${GROUPS[s]}) | ${partners.filter(p => p.group_type === GROUPS[s]).length} |`);
    L.push(`| Artikli | ${n("Artikli")} | articles | ${articles.length} |`,
        `| Transakcije | ${txRows.length} | transactions | ${transactions.length} |`,
        `| Faktura | ${invoiceRows.length} | invoices | ${invoices.length} |`,
        `| ObracunR | ${n("ObracunR")} | payroll_r (poslednji po mesecu) | ${payrollR.items.length} |`,
        `| ObracunK | ${n("ObracunK")} | payroll_k (poslednji po mesecu) | ${payrollK.items.length} |`,
        `| Email | ${n("Email")} | email_recipients | ${emailRecipients.length} |`,
        `| Notes | ${n("Notes")} | notes | ${notes.length} |`,
        `| Login | ${n("Login")} | — (ne prenosi se) | 0 |`);

    L.push(``, `## Zbir aktivnih transakcija po godini i tipu`, ``);
    const keys = [...new Set([...Object.keys(sheetTx), ...Object.keys(dbResult?.dbTxT || {})])].sort();
    L.push(dbResult ? `| Godina | Tip | Sheet | Baza | |` : `| Godina | Tip | Sheet |`, dbResult ? `|---|---|---:|---:|---|` : `|---|---|---:|`);
    for(const k of keys){
        const [y, t] = k.split("|");
        if(dbResult){
            const a = sheetTx[k] || 0, b = dbResult.dbTxT[k] || 0;
            L.push(`| ${y} | ${t} | ${money(a)} | ${money(b)} | ${a === b ? "✅" : "❌ " + money(b - a)} |`);
        } else L.push(`| ${y} | ${t} | ${money(sheetTx[k])} |`);
    }
    const ulaz = Object.entries(sheetTx).filter(([k]) => k.endsWith("|ulaz")).reduce((s, [, v]) => s + v, 0);
    const izlaz = Object.entries(sheetTx).filter(([k]) => !k.endsWith("|ulaz")).reduce((s, [, v]) => s + v, 0);
    L.push(``, `Dashboard: ulaz ${money(ulaz)}, izlaz ${money(izlaz)}, **stanje ${money(ulaz - izlaz)}**.`,
        `Kontrola na sirovim podacima kao 1.x getDashboard: ulaz ${money(cents(rawUlaz))}, izlaz ${money(cents(rawIzlaz))}, stanje ${money(cents(rawUlaz - rawIzlaz))} ${cents(rawUlaz) === ulaz && cents(rawIzlaz) === izlaz ? "✅" : "❌"}.`);

    L.push(``, `## Zbir faktura po godini i valuti`, ``, `| Godina | Valuta | Sheet${dbResult ? " | Baza" : ""} |`, `|---|---|---:${dbResult ? "|---:" : ""}|`);
    for(const k of [...new Set([...Object.keys(sheetInv), ...Object.keys(dbResult?.dbInvT || {})])].sort()){
        const [y, c] = k.split("|");
        L.push(`| ${y} | ${c} | ${money(sheetInv[k] || 0)}${dbResult ? ` | ${money(dbResult.dbInvT[k] || 0)}` : ""} |`);
    }

    const list = (title, items, empty = "nema") => { L.push(``, `## ${title}`, ``); if(items.length) items.forEach(x => L.push(`- ${x}`)); else L.push(empty); };
    const um = Object.values(unmatched).sort((a, b) => a.type.localeCompare(b.type) || b.count - a.count);
    L.push(``, `## Nazivi bez partnera (${um.length})`, ``,
        `Transakcije sa ovim nazivima prelaze bez veze sa partnerom (\`partner_id\` prazno). Za povezivanje: \`input/partner_map.csv\`, red \`grupa;stari naziv;šifra partnera\`.`, ``);
    if(um.length){ L.push(`| Grupa | Naziv | Transakcija | Zbir |`, `|---|---|---:|---:|`); um.forEach(u => L.push(`| ${u.type} | ${u.name.replace(/\|/g, "/").replace(/\n/g, " ")} | ${u.count} | ${money(u.sum)} |`)); }
    else L.push("nema");
    list("Transakcije sa neispravnim tipom, datumom ili iznosom", badRows);
    list("Nepoznat status (upisano kao aktivno)", statusUnknown);
    list("ID transakcija", [`${missingIds} redova bez ID-a i ${sharedIds} redova sa ID-om koji deli više redova → \`legacy_id\` prazno (1.x ih ne može ni stornirati pojedinačno)`,
        `${extraDecimals} iznosa sa više od 2 decimale (zaokruženo na 2)`]);
    list("Spojeni duplikati partnera", mergedDuplicates);
    list("Duplirane fakture (ostaje poslednji red)", duplicateInvoices);
    list("Napomene uz fakture", invoiceNotes);
    list("Obračuni", [`R: ${payrollR.dropped} starijih čuvanja istog meseca nije preneto`, `K: ${payrollK.dropped} starijih čuvanja istog meseca nije preneto`]);
    list("Primenjene ispravke vlasnika (corrections.json)", corrApplied);
    list("Ostala upozorenja", report.warnings);

    L.push(``, `## Uzorak 10 transakcija`, ``, `| Red u Sheet-u | Sheet: datum / tip / naziv / iznos / status | Prenosi se kao |`, `|---|---|---|`);
    const step = Math.max(1, Math.floor(txRows.length / 10));
    for(let i = 0; i < txRows.length && i / step < 10; i += step){
        const { r, line } = txRows[i];
        const t = transactions.find(x => x.created_at && x.partner_name === str(r[3]) && x.amount === Math.round(parseAmount(r[7]) * 100) / 100 && x.tx_date === parseDate(r[1]));
        const sheetDate = typeof r[1] === "number" ? parseDate(r[1]) : str(r[1]);
        L.push(`| ${line} | ${sheetDate} / ${str(r[2])} / ${str(r[3]).replace(/\|/g, "/")} / ${str(r[7])} / ${str(r[9])} | ${t ? `${t.tx_date} / ${t.type} / ${t.partner_id ? "partner ✓" : "bez partnera"} / ${money(cents(t.amount))} / ${t.status}` : "—"} |`);
    }

    L.push(``, `## Fajlovi sa Drive-a`, ``, existsSync(join(INPUT, "drive")) ? "Folder `input/drive` postoji; prenos fajlova još nije uključen u skriptu." : "Folder `input/drive` ne postoji — fajlovi još nisu preneti (fakture i obračuni prelaze bez PDF-a).");

    mkdirSync(OUTPUT, { recursive: true });
    writeFileSync(join(OUTPUT, "report.md"), L.join("\n") + "\n");
}
