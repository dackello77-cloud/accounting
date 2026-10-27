// Obračun R (račun): porezi, mesečni troškovi, plate; USD preko kursa; PDF / PRINT / SEND EMAIL.
import * as api from "./api.js";
import { escapeHtml, formatMoney, openPrintWindow, errorMessage, showModal, hideModal, UserError } from "./util.js";
import { LOGO_URL } from "./logo.js";
import { MONTHS, payrollFileName } from "./files.js";
import { savePdfDocument } from "./docsave.js";
import { EmailPicker } from "./emailpicker.js";

const $ = (id) => document.getElementById(id);
let data = { tax: [], cost: [], salary: [] };
let draftLoaded = false;
let draftTimer = null;
let pendingSave = null;
let emails = null;

function formatUsd(num){
    return Number(num || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getState(){
    return { data, month: $("obracunMonth").value, year: $("obracunYear").value, rate: $("obracunRate").value, defaultSalary: $("defaultSalaryRsd").value };
}

function applyState(saved){
    if(!saved) return;
    if(saved.data){
        data = {
            tax: Array.isArray(saved.data.tax) ? saved.data.tax : [],
            cost: Array.isArray(saved.data.cost) ? saved.data.cost : [],
            salary: Array.isArray(saved.data.salary) ? saved.data.salary : []
        };
    }
    if(saved.month) $("obracunMonth").value = saved.month;
    if(saved.year) $("obracunYear").value = saved.year;
    if(saved.rate !== undefined) $("obracunRate").value = saved.rate;
    if(saved.defaultSalary !== undefined) $("defaultSalaryRsd").value = saved.defaultSalary;
}

// Poslednje stanje u calc_drafts, 1 s posle poslednje izmene.
function scheduleDraftSave(){
    if(!draftLoaded) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => saveDraftNow().catch(error => console.error(error)), 1000);
}

function saveDraftNow(){
    clearTimeout(draftTimer);
    draftTimer = null;
    pendingSave = api.saveDraft("R", getState());
    return pendingSave;
}

// Nacrt čuva zaposlene po imenu; one koji su u međuvremenu deaktivirani ne prikazujemo.
async function inactiveEmployeeNames(){
    const all = await api.listPartners("zaposleni");
    const active = new Set(all.filter(e => e.active).map(e => e.name));
    return new Set(all.filter(e => !e.active && !active.has(e.name)).map(e => e.name));
}

function savedAtText(){
    return new Date().toLocaleTimeString("sr-RS", { timeZone: "Europe/Belgrade", hour: "2-digit", minute: "2-digit" });
}

function getRate(){
    const rate = Number($("obracunRate").value || 0);
    return rate > 0 ? rate : 0;
}

export async function openObracunRModal(){
    showModal("obracunRModal");
    if(!emails){
        emails = new EmailPicker({ selectId: "obracunEmailSelect", chipsId: "obracunEmailChips", nameId: "newEmailName", addressId: "newEmailAddress" });
    }
    // Nacrt se čita iz baze pri svakom otvaranju (možda je menjan na drugom uređaju ili tabu).
    // Dok se ne učita, automatsko čuvanje je isključeno da prazan obračun ne prepiše sačuvani.
    draftLoaded = false;
    const status = $("obracunStatus");
    status.textContent = "Učitavam sačuvani obračun...";
    try{
        await pendingSave?.catch(() => {});
        const draft = await api.getDraft("R");
        const now = new Date();
        data = { tax: [], cost: [], salary: [] };
        $("obracunMonth").value = MONTHS[now.getMonth()];
        $("obracunYear").value = now.getFullYear();
        applyState(draft?.data);
        const inactive = await inactiveEmployeeNames();
        data.salary = data.salary.filter(row => !inactive.has(row.name));
    }catch(error){
        console.error(error);
        status.textContent = errorMessage(error, "Sačuvani obračun nije učitan. Zatvorite i otvorite obračun ponovo.");
        return;
    }
    draftLoaded = true;
    status.textContent = "";
    if(data.tax.length === 0) data.tax.push({ name: "", rsd: "" });
    if(data.cost.length === 0) data.cost.push({ name: "", rsd: "" });
    if(data.salary.length === 0) await loadObracunEmployees();
    emails.load();
    renderObracunR();
}

export function closeObracunRModal(){
    hideModal("obracunRModal");
    if(draftTimer) saveDraftNow().catch(error => console.error(error));
}

export function addObracunRow(type){
    data[type].push({ name: "", rsd: "" });
    renderObracunR();
}

export function deleteObracunRow(type, index){
    data[type].splice(index, 1);
    if(data[type].length === 0 && type !== "salary") data[type].push({ name: "", rsd: "" });
    renderObracunR();
}

export function updateObracunRow(type, index, field, value){
    data[type][index][field] = value;
    renderObracunR(false);
}

function renderRows(type, tbodyId){
    const rate = getRate();
    $(tbodyId).innerHTML = data[type].map((row, i) => {
        const rsd = Number(row.rsd || 0);
        return `<tr>
            <td class="obracun-r-rb">${i + 1}</td>
            <td><input class="obracun-r-name" type="text" value="${escapeHtml(row.name)}" oninput="updateObracunRow('${type}',${i},'name',this.value)"></td>
            <td><input class="obracun-r-money" type="number" step="0.01" value="${escapeHtml(row.rsd)}" oninput="updateObracunRow('${type}',${i},'rsd',this.value)"></td>
            <td class="obracun-r-usd">${formatUsd(rate ? rsd / rate : 0)}</td>
            <td><button class="obracun-r-del" onclick="deleteObracunRow('${type}',${i})">X</button></td>
        </tr>`;
    }).join("");
}

function sum(type){
    return data[type].reduce((total, row) => total + (Number(row.rsd) || 0), 0);
}

export function renderObracunR(updateRows = true){
    const rate = getRate();
    if(updateRows){
        renderRows("tax", "taxRows");
        renderRows("cost", "costRows");
        renderRows("salary", "salaryRows");
    }
    const tax = sum("tax"), cost = sum("cost"), salary = sum("salary"), total = tax + cost + salary;
    $("sumTaxRsd").textContent = formatMoney(tax);
    $("sumCostRsd").textContent = formatMoney(cost);
    $("sumSalaryRsd").textContent = formatMoney(salary);
    $("sumTotalRsd").textContent = formatMoney(total);
    $("sumTaxUsd").textContent = formatUsd(rate ? tax / rate : 0);
    $("sumCostUsd").textContent = formatUsd(rate ? cost / rate : 0);
    $("sumSalaryUsd").textContent = formatUsd(rate ? salary / rate : 0);
    $("sumTotalUsd").textContent = formatUsd(rate ? total / rate : 0);
    $("obracunPreview").innerHTML = buildInnerHtml();
    scheduleDraftSave();
}

export async function loadObracunEmployees(){
    try{
        const employees = await api.listPartners("zaposleni", { activeOnly: true });
        const defaultSalary = $("defaultSalaryRsd").value || "";
        data.salary = employees.map(e => ({ name: e.name || "", rsd: defaultSalary }));
        renderObracunR();
    }catch(error){
        alert(errorMessage(error, "Greška pri učitavanju zaposlenih"));
    }
}

export function applyDefaultSalary(){
    const amount = $("defaultSalaryRsd").value;
    data.salary.forEach(row => row.rsd = amount);
    renderObracunR();
}

function buildInnerHtml(){
    const month = $("obracunMonth").value;
    const year = $("obracunYear").value;
    const rate = getRate();
    const tax = sum("tax"), cost = sum("cost"), salary = sum("salary"), total = tax + cost + salary;
    const headStyle = "background:#073b44!important;color:#ffffff!important;font-weight:800;text-transform:uppercase;letter-spacing:.2px;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;";
    const totalStyle = "background:#073b44!important;color:#ffffff!important;font-weight:900;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;";

    const sectionTable = (title, rows, withRb) => {
        let html = `<table class="obracun-preview-table"><thead><tr><th style="${headStyle}">${title}</th><th style="${headStyle}">RSD</th><th style="${headStyle}">USD</th></tr></thead><tbody>`;
        rows.forEach((r, i) => {
            const name = withRb ? `${i + 1}. ${escapeHtml(r.name || "")}` : escapeHtml(r.name || "");
            const rsd = Number(r.rsd || 0);
            const bg = i % 2 === 0 ? "#ffffff" : "#eef2f7";
            html += `<tr><td style="background:${bg};">${name}</td><td style="background:${bg};">${formatMoney(rsd)}</td><td style="background:${bg};">$ ${formatUsd(rate ? rsd / rate : 0)}</td></tr>`;
        });
        return html + `</tbody></table>`;
    };

    return `
        <div class="obracun-preview-head">
            <img src="${LOGO_URL}" alt="Logo">
            <div class="obracun-preview-title">
                <h2>PLATE I TROŠKOVI NA RAČUN</h2>
                <div>${escapeHtml(month)} ${escapeHtml(year)}</div>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;">
            <div>
                ${sectionTable("POREZI", data.tax, false)}
                ${sectionTable("MESEČNI TROŠKOVI", data.cost, false)}
                <div class="obracun-preview-rate"><span>KURS DOLARA</span><span>${rate ? formatMoney(rate) : "0,00"}</span></div>
                <table class="obracun-preview-table">
                    <thead><tr><th style="${totalStyle}">UKUPNO</th><th style="${totalStyle}">RSD</th><th style="${totalStyle}">USD</th></tr></thead>
                    <tbody>
                        <tr><td style="background:#ffffff;">POREZI</td><td style="background:#ffffff;">${formatMoney(tax)}</td><td style="background:#ffffff;">$ ${formatUsd(rate ? tax / rate : 0)}</td></tr>
                        <tr><td style="background:#eef2f7;">MESEČNI TROŠKOVI</td><td style="background:#eef2f7;">${formatMoney(cost)}</td><td style="background:#eef2f7;">$ ${formatUsd(rate ? cost / rate : 0)}</td></tr>
                        <tr><td style="background:#ffffff;">PLATE ZAPOSLENIH</td><td style="background:#ffffff;">${formatMoney(salary)}</td><td style="background:#ffffff;">$ ${formatUsd(rate ? salary / rate : 0)}</td></tr>
                        <tr class="obracun-preview-total"><td style="${totalStyle}">UKUPNO ZA UPLATU</td><td style="${totalStyle}">${formatMoney(total)}</td><td style="${totalStyle}">$ ${formatUsd(rate ? total / rate : 0)}</td></tr>
                    </tbody>
                </table>
            </div>
            <div>
                ${sectionTable("PLATE ZAPOSLENIH", data.salary, true)}
            </div>
        </div>
    `;
}

function buildDocumentHtml(){
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Obračun - R</title><style>
        @page{size:A4 landscape;margin:4mm}
        *{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
        html,body{margin:0;padding:0;background:white;color:#111;font-family:Arial,sans-serif}
        body{width:289mm;min-height:200mm;overflow:hidden}
        .obracun-pdf-page{width:289mm;min-height:200mm;padding:5mm 6mm 4mm 6mm;overflow:hidden}
        .obracun-preview-head{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #073b44;padding-bottom:7px;margin-bottom:9px}
        .obracun-preview-head img{width:118px}
        .obracun-preview-title{text-align:right}
        .obracun-preview-title h2{margin:0;font-size:19px;line-height:1.1;color:#111827;letter-spacing:.2px}
        .obracun-preview-title div{background:#073b44;color:white;padding:5px 14px;margin-top:5px;font-weight:bold;font-size:12px;border-radius:2px}
        .obracun-preview-table{width:100%;border-collapse:collapse;margin-bottom:7px;font-size:8.7px;line-height:1.13;page-break-inside:avoid;border:1px solid #111827}
        .obracun-preview-table th{background:#073b44!important;color:white!important;border:1px solid #111827;padding:4px 5px;text-align:left;font-weight:bold;text-transform:uppercase;letter-spacing:.15px}
        .obracun-preview-table td{border:1px solid #374151;padding:3px 5px;color:#111;vertical-align:middle}
        .obracun-preview-table td:first-child{padding-left:5px;padding-right:5px;font-weight:500}
        .obracun-preview-total td{background:#073b44!important;color:white!important;font-weight:bold}
        .obracun-preview-rate{background:#b91c1c;color:white;font-weight:bold;padding:7px 10px;margin:8px 0;border-radius:4px;display:flex;justify-content:space-between;align-items:center;font-size:11px;line-height:14px;letter-spacing:.2px;border:1px solid #7f1d1d}
        .obracun-preview-rate span:first-child{text-transform:uppercase}
        .obracun-pdf-page > div:nth-child(2){gap:10px!important}
        @media print{
            html,body{width:289mm;min-height:200mm;overflow:hidden}
            .obracun-pdf-page{page-break-after:avoid;page-break-inside:avoid}
        }
    </style></head><body><div class="obracun-pdf-page">${buildInnerHtml()}</div></body></html>`;
}

export function printObracunR(){
    openPrintWindow(buildDocumentHtml());
}

// PDF u Storage (isti mesec se prepisuje) + red u payroll_r.
async function savePdf(){
    const monthName = $("obracunMonth").value;
    const year = $("obracunYear").value;
    const month = MONTHS.indexOf(monthName) + 1;
    if(!month || !Number(year)) throw new UserError("Izaberite mesec i godinu.");
    const fileName = payrollFileName("R", monthName, year);
    const doc = await savePdfDocument({ html: buildDocumentHtml(), category: "obracun_r", fileName, orientation: "landscape", margin: 4 });
    const row = await api.savePayroll("payroll_r", { month, year: Number(year), usd_rate: getRate() || null, data: getState(), pdf_path: doc.path });
    return { ...doc, record: row };
}

export async function saveObracunRPdfOnly(){
    const status = $("obracunStatus");
    status.textContent = "Čuvam PDF...";
    try{
        const doc = await savePdf();
        status.textContent = "PDF je sačuvan: " + doc.fileName;
    }catch(error){
        status.textContent = errorMessage(error, "Greška pri čuvanju PDF-a.");
    }
}

// Čuva nacrt bez PDF-a i slanja, da se sledeći put nastavi gde se stalo.
export async function saveObracunRDraft(){
    const status = $("obracunStatus");
    clearTimeout(draftTimer);
    if(!draftLoaded){
        status.textContent = "Sačuvani obračun nije učitan, pa čuvanje nije dozvoljeno. Zatvorite i otvorite obračun ponovo.";
        return;
    }
    status.textContent = "Čuvam...";
    try{
        await saveDraftNow();
        status.textContent = "Sačuvano u " + savedAtText() + ". Možete nastaviti kasnije.";
    }catch(error){
        status.textContent = errorMessage(error, "Greška pri čuvanju.");
    }
}

export function toggleObracunEmailBox(){
    const box = $("obracunEmailBox");
    box.style.display = box.style.display === "block" ? "none" : "block";
    if(box.style.display === "block"){
        emails.load();
        box.scrollIntoView({ behavior: "smooth", block: "center" });
    }
}

function buildEmailHtml(){
    const month = $("obracunMonth").value;
    const year = $("obracunYear").value;
    const message = escapeHtml($("obracunEmailMessage").value || "").replace(/\n/g, "<br>");
    const rate = getRate();
    const total = sum("tax") + sum("cost") + sum("salary");
    return `
        <div style="font-family:Arial,sans-serif;background:#eaf7ff;padding:24px;color:#0f172a;">
            <div style="max-width:760px;margin:0 auto;background:white;border-radius:22px;padding:26px;box-shadow:0 12px 40px rgba(15,23,42,.10);">
                <img src="cid:mmlogo" alt="M&M Safety" style="width:150px;height:auto;display:block;margin-bottom:16px;">
                <h2 style="margin:0 0 6px 0;">Obračun - R ${escapeHtml(month)} ${escapeHtml(year)}</h2>
                <p style="margin:0 0 18px 0;color:#475569;">PDF dokument je u prilogu.</p>
                <div style="background:#0f172a;color:white;border-radius:16px;padding:18px;margin-bottom:18px;">
                    <strong>UKUPNO ZA UPLATU:</strong><br>
                    <span style="font-size:22px;font-weight:bold;">${formatMoney(total)} RSD</span>
                    <span style="margin-left:16px;font-size:22px;font-weight:bold;">$ ${formatUsd(rate ? total / rate : 0)}</span>
                </div>
                ${message ? `<div style="margin:18px 0;padding:16px;background:#f1f5f9;border-radius:14px;line-height:1.5;">${message}</div>` : ""}
                <p style="color:#475569;">M&M Safety</p>
            </div>
        </div>
    `;
}

export async function sendObracunREmail(){
    const status = $("obracunStatus");
    if(emails.selected.length === 0){ status.textContent = "Dodajte bar jedan email."; return; }
    status.textContent = "Čuvam PDF i šaljem email...";
    try{
        const doc = await savePdf();
        const result = await api.sendEmail({
            to: emails.emails(),
            subject: `OBRAČUN - R ${$("obracunMonth").value} ${$("obracunYear").value}`,
            html: buildEmailHtml(),
            attachments: [{ bucket: doc.bucket, path: doc.path, filename: doc.fileName }],
            kind: "obracun_r",
            record_id: doc.record.id
        });
        status.textContent = (result.test ? "TEST: email je poslat samo na " + result.sent_to.join(", ") : "Email je poslat.") + " PDF je sačuvan: " + doc.fileName;
    }catch(error){
        status.textContent = errorMessage(error, "Greška pri slanju emaila.");
    }
}

export const emailActions = {
    addSelectedObracunEmail: () => emails.addSelected(),
    addNewObracunEmail: () => emails.addNew(),
    loadObracunEmails: () => emails.load()
};
