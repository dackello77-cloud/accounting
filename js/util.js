// Zajedničke pomoćne funkcije: format novca i datuma, escape, štampa.

export const TYPE_LABELS = { ulaz: "Ulaz", porezi: "Porezi", klijenti: "Klijenti", zaposleni: "Zaposleni", prenos: "Prenos" };
export const TYPES = Object.keys(TYPE_LABELS);

export function escapeHtml(value){
    return String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

const moneyFormat = new Intl.NumberFormat("sr-Latn-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function formatMoney(value){
    const num = Number(value);
    return moneyFormat.format(Number.isFinite(num) ? num : 0);
}

// "1.234,56" → 1234.56; prazno ili neispravno → null (nikad NaN u zbiru).
export function parseAmount(value){
    if(typeof value === "number") return Number.isFinite(value) ? value : null;
    const normalized = String(value || "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
    if(!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
}

// Datum "yyyy-mm-dd" → "22. 10. 2026."
export function formatDate(value){
    if(!value) return "";
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(m) return `${Number(m[3])}. ${Number(m[2])}. ${m[1]}.`;
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("sr-RS", { timeZone: "Europe/Belgrade" });
}

export function formatDateTime(value){
    if(!value) return "";
    const d = new Date(value);
    if(isNaN(d.getTime())) return String(value);
    return d.toLocaleString("sr-RS", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", timeZone:"Europe/Belgrade" });
}

function belgradeParts(date){
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Belgrade", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23"
    }).formatToParts(date);
    return Object.fromEntries(parts.map(p => [p.type, p.value]));
}

// Današnji datum u Beogradu kao "yyyy-mm-dd".
export function todayIso(){
    const p = belgradeParts(new Date());
    return `${p.year}-${p.month}-${p.day}`;
}

export function currentMonthRange(){
    const [y, m] = todayIso().split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const mm = String(m).padStart(2, "0");
    return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

// timestamptz → vrednost za <input type="datetime-local"> po beogradskom vremenu.
export function toDateTimeLocal(value){
    if(!value) return "";
    const d = new Date(value);
    if(isNaN(d.getTime())) return "";
    const p = belgradeParts(d);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// Polje iznosa: tačka sa numeričke tastature postaje zarez, grupisanje hiljada tačkom.
export function bindAmountInput(input){
    input.addEventListener("keydown", (event) => {
        if(event.key !== "." && event.code !== "NumpadDecimal") return;
        event.preventDefault();
        const start = input.selectionStart;
        const end = input.selectionEnd;
        if(input.value.includes(",") && !input.value.slice(start, end).includes(",")) return;
        input.setRangeText(",", start, end, "end");
        formatAmountInput(input);
    });
    input.addEventListener("input", () => formatAmountInput(input));
    input.addEventListener("focus", () => {
        if(/,00$/.test(input.value)) input.value = input.value.slice(0, -3);
        requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
    });
    input.addEventListener("blur", () => {
        const amount = parseAmount(input.value);
        input.value = amount === null ? "" : formatMoney(amount);
    });
}

function formatAmountInput(input){
    let value = input.value;
    if(value.includes(".") && !value.includes(",")){
        const lastDot = value.lastIndexOf(".");
        if(value.slice(lastDot + 1).replace(/\D/g, "").length <= 2){
            value = value.slice(0, lastDot) + "," + value.slice(lastDot + 1);
        }
    }
    const clean = value.replace(/[^\d,]/g, "");
    if(clean === ""){ input.value = ""; return; }
    const comma = clean.indexOf(",");
    const integer = (comma === -1 ? clean : clean.slice(0, comma)).replace(/^0+(?=\d)/, "");
    const decimals = comma === -1 ? "" : clean.slice(comma + 1).replace(/,/g, "").slice(0, 2);
    input.value = (integer || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (comma === -1 ? "" : "," + decimals);
}

// Štampa kroz skriveni iframe (kao 1.x).
export function openPrintWindow(html){
    const frame = document.createElement("iframe");
    Object.assign(frame.style, { position:"fixed", right:"0", bottom:"0", width:"0", height:"0", border:"0", visibility:"hidden" });
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        setTimeout(() => frame.remove(), 1500);
    }, 700);
}

export function showModal(id){ document.getElementById(id).style.display = "flex"; }
export function hideModal(id){ document.getElementById(id).style.display = "none"; }

// Greška sa porukom za korisnika (na srpskom), prikazuje se kakva jeste.
export class UserError extends Error {}

// Poruka greške iz Supabase-a na srpskom.
export function errorMessage(error, fallback = "Došlo je do greške."){
    if(error instanceof UserError) return error.message;
    const msg = String(error?.message || "");
    if(/partners_tax_id_rs/.test(msg)) return "PIB mora imati 9 cifara.";
    if(/partners_registration_no_rs/.test(msg)) return "Matični broj mora imati 8 cifara.";
    if(/country/.test(msg) && /check/.test(msg)) return "Država mora biti oznaka od 2 slova (npr. RS, US).";
    if(/email_recipients_email_idx|duplicate key/.test(msg)) return "Taj unos već postoji.";
    if(/Failed to fetch|NetworkError/i.test(msg)) return "Nema veze sa serverom. Proverite internet.";
    if(/[čćšđž]|Nemate|Transakcija|Broj fakture/.test(msg)) return msg;
    return fallback;
}
