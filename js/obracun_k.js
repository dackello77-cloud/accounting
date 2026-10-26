// Obračun K (keš): ko prima na račun / keš, dodatna kolona, napomene; PDF / PRINT / SEND EMAIL.
import * as api from "./api.js";
import { escapeHtml, openPrintWindow, errorMessage, showModal, hideModal, UserError } from "./util.js";
import { LOGO_URL } from "./logo.js";
import { MONTHS, payrollFileName } from "./files.js";
import { savePdfDocument } from "./docsave.js";
import { EmailPicker } from "./emailpicker.js";

const $ = (id) => document.getElementById(id);
let rows = [];
let draftLoaded = false;
let draftTimer = null;
let emails = null;

function extraType(){
    return document.querySelector('input[name="obracunKExtraType"]:checked')?.value || "text";
}

function getState(){
    return {
        month: $("obracunKMonth").value,
        year: $("obracunKYear").value,
        extraEnabled: $("obracunKExtraEnabled").checked,
        extraTitle: $("obracunKExtraTitle").value,
        extraType: extraType(),
        notes: $("obracunKNotes").value,
        rows
    };
}

function applyState(state){
    if(!state) return false;
    if(state.month) $("obracunKMonth").value = state.month;
    if(state.year) $("obracunKYear").value = state.year;
    $("obracunKExtraEnabled").checked = !!state.extraEnabled;
    $("obracunKExtraTitle").value = state.extraTitle || "";
    const typeEl = document.querySelector(`input[name="obracunKExtraType"][value="${state.extraType === "check" ? "check" : "text"}"]`);
    if(typeEl) typeEl.checked = true;
    $("obracunKNotes").value = state.notes || "";
    rows = Array.isArray(state.rows) ? state.rows : [];
    return rows.length > 0;
}

function scheduleDraftSave(){
    if(!draftLoaded) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => api.saveDraft("K", getState()).catch(error => console.error(error)), 1000);
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

export async function openObracunKModal(){
    showModal("obracunKModal");
    const now = new Date();
    if(!emails){
        emails = new EmailPicker({ selectId: "obracunKEmailSelect", chipsId: "obracunKEmailChips", nameId: "newKEmailName", addressId: "newKEmailAddress" });
    }
    if(!draftLoaded){
        $("obracunKMonth").value = MONTHS[now.getMonth()];
        $("obracunKYear").value = now.getFullYear();
        let hasRows = false;
        try{
            const draft = await api.getDraft("K");
            hasRows = applyState(draft?.data);
            if(hasRows){
                const inactive = await inactiveEmployeeNames();
                rows = rows.filter(row => !inactive.has(row.name));
            }
        }catch(error){
            console.error(error);
        }
        draftLoaded = true;
        if(!hasRows){
            await loadObracunKEmployees(true);
            return;
        }
    }
    renderObracunK();
}

export function closeObracunKModal(){
    hideModal("obracunKModal");
}

export async function loadObracunKEmployees(force){
    if(rows.length && !force){ renderObracunK(); return; }
    try{
        const employees = await api.listPartners("zaposleni", { activeOnly: true });
        rows = employees.map((e, idx) => ({ id: Date.now() + "_" + idx, name: e.name || "", racun: true, kes: true, extraText: "", extraCheck: false }));
        renderObracunK();
    }catch(error){
        alert(errorMessage(error, "Greška pri učitavanju zaposlenih"));
    }
}

export function updateObracunKRow(index, field, value){
    if(!rows[index]) return;
    rows[index][field] = value;
    // Tekst se menja bez ponovnog crtanja tabele, da kursor ostane u polju.
    if(field === "extraText"){
        $("obracunKPreview").innerHTML = buildPreviewHtml();
        scheduleDraftSave();
        return;
    }
    renderObracunK();
}

export function deleteObracunKRow(index){
    if(!rows[index]) return;
    if(!confirm("Ukloniti zaposlenog iz ovog obračuna?")) return;
    rows.splice(index, 1);
    renderObracunK();
}

export function renderObracunK(){
    const extraEnabled = $("obracunKExtraEnabled").checked;
    const extraTitle = $("obracunKExtraTitle").value.trim() || "Dodatno";
    const type = extraType();

    $("obracunKTableHead").innerHTML = `
        <tr>
            <th style="width:60px;">RB</th>
            <th>Zaposleni</th>
            <th style="width:100px;">Račun</th>
            <th style="width:100px;">Keš</th>
            ${extraEnabled ? `<th>${escapeHtml(extraTitle)}</th>` : ""}
            <th style="width:55px;">X</th>
        </tr>`;

    $("obracunKRows").innerHTML = rows.map((row, index) => {
        let extraCell = "";
        if(extraEnabled){
            extraCell = type === "check"
                ? `<td class="obracun-k-check"><input type="checkbox" ${row.extraCheck ? "checked" : ""} onchange="updateObracunKRow(${index}, 'extraCheck', this.checked)"></td>`
                : `<td><input class="obracun-k-extra-input" type="text" value="${escapeHtml(row.extraText || "")}" oninput="updateObracunKRow(${index}, 'extraText', this.value)"></td>`;
        }
        return `<tr>
            <td class="obracun-k-rb">${index + 1}</td>
            <td class="obracun-k-name">${escapeHtml(row.name)}</td>
            <td class="obracun-k-check"><input type="checkbox" ${row.racun ? "checked" : ""} onchange="updateObracunKRow(${index}, 'racun', this.checked)"></td>
            <td class="obracun-k-check"><input type="checkbox" ${row.kes ? "checked" : ""} onchange="updateObracunKRow(${index}, 'kes', this.checked)"></td>
            ${extraCell}
            <td><button class="obracun-r-del" onclick="deleteObracunKRow(${index})">X</button></td>
        </tr>`;
    }).join("");
    $("obracunKPreview").innerHTML = buildPreviewHtml();
    scheduleDraftSave();
}

const checkMark = (value) => value ? "✓" : "";

function extraCellValue(state, row){
    return state.extraType === "check" ? checkMark(row.extraCheck) : escapeHtml(row.extraText || "");
}

function buildPreviewHtml(){
    const state = getState();
    const notes = (state.notes || "").trim();
    const body = state.rows.map((row, idx) => `
        <tr>
            <td style="text-align:center;width:45px;">${idx + 1}</td>
            <td>${escapeHtml(row.name)}</td>
            <td style="text-align:center;">${checkMark(row.racun)}</td>
            <td style="text-align:center;">${checkMark(row.kes)}</td>
            ${state.extraEnabled ? `<td style="text-align:center;">${extraCellValue(state, row)}</td>` : ""}
        </tr>`).join("");

    return `
        <div class="obracun-k-preview-head">
            <img src="${LOGO_URL}" alt="Logo">
            <div class="obracun-k-preview-title">
                <h2>TROŠKOVI NA RUKE</h2>
                <div>${escapeHtml(state.month)} ${escapeHtml(state.year)}</div>
            </div>
        </div>
        <table class="obracun-k-preview-table">
            <thead>
                <tr>
                    <th style="width:45px;">RB</th>
                    <th>Zaposleni</th>
                    <th style="width:90px;text-align:center;">Račun</th>
                    <th style="width:90px;text-align:center;">Keš</th>
                    ${state.extraEnabled ? `<th style="text-align:center;">${escapeHtml(state.extraTitle || "Dodatno")}</th>` : ""}
                </tr>
            </thead>
            <tbody>${body}</tbody>
        </table>
        ${notes ? `<div class="obracun-k-notes-preview"><h3>NAPOMENE</h3><div>${escapeHtml(notes)}</div></div>` : ""}
    `;
}

function buildPdfHtml(){
    const state = getState();
    const notes = (state.notes || "").trim();
    const body = state.rows.map((row, idx) => `
        <tr>
            <td class="rb">${idx + 1}</td>
            <td class="name">${escapeHtml(row.name)}</td>
            <td class="check">${checkMark(row.racun)}</td>
            <td class="check">${checkMark(row.kes)}</td>
            ${state.extraEnabled ? `<td class="extra">${extraCellValue(state, row)}</td>` : ""}
        </tr>`).join("");

    return `<html>
<head>
<meta charset="UTF-8">
<title>OBRAČUN - K - ${escapeHtml(state.month)} ${escapeHtml(state.year)}</title>
<style>
@page{size:A4 portrait;margin:6mm;}
*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
body{font-family:Arial,sans-serif;margin:0;color:#111;background:#fff;font-size:10.5px;}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;border-bottom:3px solid #111827;padding-bottom:7px;}
.logo{width:150px;}
.title{text-align:right;}
.title h1{font-size:18px;margin:0 0 4px 0;font-weight:900;letter-spacing:.3px;}
.title div{background:#111827;color:#fff;padding:6px 16px;font-weight:800;display:inline-block;}
table{width:100%;border-collapse:collapse;margin-top:8px;}
th{background:#dc2626;color:#fff;padding:4px 5px;border:1px solid #111;text-transform:uppercase;font-size:10.5px;}
td{border:1px solid #111;padding:3px 5px;font-size:10.5px;line-height:13px;}
tbody tr:nth-child(even) td{background:#f3f4f6;}
.rb{width:42px;text-align:center;}
.name{font-weight:700;}
.check{width:70px;text-align:center;font-size:13px;line-height:16px;color:#dc2626;font-weight:900;}
.extra{text-align:center;}
.notes{margin-top:8px;border:1px solid #111;}
.notes-title{background:#1d4ed8;color:#fff;text-align:center;font-weight:900;padding:4px;text-transform:uppercase;}
.notes-body{padding:7px;white-space:pre-wrap;line-height:1.2;font-size:10.5px;}
</style>
</head>
<body>
    <div class="header">
        <img class="logo" src="${LOGO_URL}" alt="Logo">
        <div class="title">
            <h1>TROŠKOVI NA RUKE</h1>
            <div>${escapeHtml(state.month)} ${escapeHtml(state.year)}</div>
        </div>
    </div>
    <table>
        <thead>
            <tr>
                <th>RB</th>
                <th>Zaposleni</th>
                <th>Račun</th>
                <th>Keš</th>
                ${state.extraEnabled ? `<th>${escapeHtml(state.extraTitle || "Dodatno")}</th>` : ""}
            </tr>
        </thead>
        <tbody>${body}</tbody>
    </table>
    ${notes ? `<div class="notes"><div class="notes-title">Napomene</div><div class="notes-body">${escapeHtml(notes)}</div></div>` : ""}
</body>
</html>`;
}

export function printObracunK(){
    openPrintWindow(buildPdfHtml());
}

async function savePdf(){
    const state = getState();
    const month = MONTHS.indexOf(state.month) + 1;
    if(!month || !Number(state.year)) throw new UserError("Izaberite mesec i godinu.");
    const fileName = payrollFileName("K", state.month, state.year);
    const doc = await savePdfDocument({ html: buildPdfHtml(), category: "obracun_k", fileName, margin: 6 });
    const row = await api.savePayroll("payroll_k", { month, year: Number(state.year), data: state, pdf_path: doc.path });
    return { ...doc, record: row };
}

export async function saveObracunKPdfOnly(){
    const status = $("obracunKStatus");
    status.textContent = "Čuvam PDF...";
    try{
        const doc = await savePdf();
        status.textContent = "PDF je sačuvan: " + doc.fileName;
    }catch(error){
        status.textContent = errorMessage(error, "Greška pri čuvanju PDF-a.");
    }
}

// Čuva nacrt bez PDF-a i slanja, da se sledeći put nastavi gde se stalo.
export async function saveObracunKDraft(){
    const status = $("obracunKStatus");
    clearTimeout(draftTimer);
    status.textContent = "Čuvam...";
    try{
        await api.saveDraft("K", getState());
        status.textContent = "Sačuvano u " + savedAtText() + ". Možete nastaviti kasnije.";
    }catch(error){
        status.textContent = errorMessage(error, "Greška pri čuvanju.");
    }
}

export function toggleObracunKEmailBox(){
    const box = $("obracunKEmailBox");
    box.style.display = box.style.display === "block" ? "none" : "block";
    if(box.style.display === "block") emails.load();
}

function buildEmailHtml(pdfFileName){
    const state = getState();
    const notes = (state.notes || "").trim();
    const message = $("obracunKEmailMessage").value.trim();
    return `
        <div style="font-family:Arial,sans-serif;background:#eaf7ff;padding:22px;color:#0f172a;">
            <div style="max-width:760px;margin:auto;background:#ffffff;border-radius:22px;padding:24px;border:1px solid #d7e8f5;">
                <div style="margin-bottom:22px;">
                    <img src="cid:mmlogo" alt="M&M Safety" style="width:150px;height:auto;display:block;margin-bottom:12px;">
                    <h2 style="margin:0;color:#334155;">Obračun Ruke ${escapeHtml(state.month)} ${escapeHtml(state.year)}</h2>
                    <p style="margin:6px 0 0 0;color:#334155;">PDF je u prilogu.</p>
                </div>
                ${notes ? `<div style="background:#111827;color:white;border-radius:14px;padding:18px;margin-bottom:14px;"><strong>Napomene</strong><div style="white-space:pre-wrap;line-height:1.55;margin-top:10px;">${escapeHtml(notes)}</div></div>` : ""}
                ${message ? `<div style="background:#111827;color:white;border-radius:14px;padding:18px;margin-bottom:14px;"><strong>Message</strong><div style="white-space:pre-wrap;line-height:1.55;margin-top:10px;">${escapeHtml(message)}</div></div>` : ""}
                <p style="color:#334155;">PDF je u prilogu: <strong>${escapeHtml(pdfFileName || "")}</strong></p>
                <div style="text-align:center;margin-top:22px;color:#334155;">M&M Safety doo, Majakovskog 34, Niš, Srbija</div>
            </div>
        </div>
    `;
}

export async function sendObracunKEmail(){
    const status = $("obracunKStatus");
    if(emails.selected.length === 0){ status.textContent = "Dodajte bar jedan email."; return; }
    status.textContent = "Čuvam PDF i šaljem email...";
    try{
        const doc = await savePdf();
        const result = await api.sendEmail({
            to: emails.emails(),
            subject: `OBRAČUN - K ${$("obracunKMonth").value} ${$("obracunKYear").value}`,
            html: buildEmailHtml(doc.fileName),
            attachments: [{ bucket: doc.bucket, path: doc.path, filename: doc.fileName }],
            kind: "obracun_k",
            record_id: doc.record.id
        });
        status.textContent = result.test ? "TEST: email je poslat samo na " + result.sent_to.join(", ") + "." : "Email je poslat.";
    }catch(error){
        status.textContent = errorMessage(error, "Greška pri slanju emaila.");
    }
}

export const emailActions = {
    addSelectedObracunKEmail: () => emails.addSelected(),
    addNewObracunKEmail: () => emails.addNew(),
    loadObracunKEmails: () => emails.load()
};
