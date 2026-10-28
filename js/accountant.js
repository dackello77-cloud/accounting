// Izveštaj knjigovođi: fakture i izvodi sačuvani posle prethodnog slanja idu mejlom;
// poslati dokumenti se označavaju (documents.accountant_report_id) i ne šalju se ponovo.
import * as api from "./api.js";
import { escapeHtml, formatDate, formatDateTime, todayIso, errorMessage, showModal, hideModal } from "./util.js";
import { CATEGORIES } from "./files.js";
import { EmailList } from "./emaillist.js";
import { openViewer } from "./viewer.js";

const $ = (id) => document.getElementById(id);
// Prvi pokušaj: do 10 priloga po mejlu; ako send-email javi da je preveliko, deli se na pola.
const BATCH_SIZE = 10;
let emails = null;
let settings = null;
let pending = [];
let sending = false;

export async function openAccountantModal(){
    $("accountantStatus").textContent = "";
    $("accountantSendBtn").disabled = false;
    showModal("accountantModal");
    await load();
}

export function closeAccountantModal(){ hideModal("accountantModal"); }

async function load(){
    $("accountantList").innerHTML = `<tr><td colspan="4">Učitavam...</td></tr>`;
    try{
        settings = await api.getAccountantSettings();
        emails.set(settings?.emails || []);
        if(!$("accountantStart").value) $("accountantStart").value = todayIso().slice(0, 8) + "01";
        showStart();
        await Promise.all([loadPending(), loadHistory()]);
    }catch(error){
        $("accountantList").innerHTML = `<tr><td colspan="4">${escapeHtml(errorMessage(error, "Greška pri učitavanju."))}</td></tr>`;
    }
}

function showStart(){
    $("accountantStartBox").hidden = !!settings?.start_date;
    $("accountantStartInfo").textContent = settings?.start_date
        ? "Šalju se fakture i izvodi sačuvani posle prethodnog slanja (prvo slanje: od " + formatDate(settings.start_date) + ")."
        : "Prvo slanje: izaberite datum od kog se šalju fakture i izvodi; stariji se ne šalju.";
}

function startDate(){
    return settings?.start_date || $("accountantStart").value;
}

// Početak dana po lokalnom (beogradskom) vremenu.
function startIso(date){
    return new Date(date + "T00:00:00").toISOString();
}

export async function loadPending(){
    const list = $("accountantList");
    const date = startDate();
    if(!date){
        pending = [];
        list.innerHTML = `<tr><td colspan="4">Izaberite datum.</td></tr>`;
        updateSendButton();
        return;
    }
    try{
        pending = (await api.listAccountantPending(startIso(date)))
            .map(d => ({ ...d, bucket: CATEGORIES[d.category].bucket, path: d.storage_path, name: d.file_name }));
        list.innerHTML = pending.length === 0
            ? `<tr><td colspan="4">Nema novih faktura ni izvoda za slanje.</td></tr>`
            : pending.map((d, i) => `<tr>
                <td>${escapeHtml(CATEGORIES[d.category].label)}</td>
                <td><button class="doc-name-btn" data-open="${i}">${escapeHtml(d.file_name)}</button></td>
                <td>${escapeHtml(formatDateTime(d.created_at))}</td>
                <td class="doc-actions"><button data-open="${i}">Otvori</button></td>
            </tr>`).join("");
    }catch(error){
        pending = [];
        list.innerHTML = `<tr><td colspan="4">${escapeHtml(errorMessage(error, "Greška pri učitavanju dokumenata."))}</td></tr>`;
    }
    updateSendButton();
}

function updateSendButton(){
    $("accountantSendBtn").textContent = pending.length ? `POŠALJI KNJIGOVOĐI (${pending.length})` : "POŠALJI KNJIGOVOĐI";
}

async function loadHistory(){
    const box = $("accountantHistory");
    try{
        const reports = await api.listAccountantReports();
        box.innerHTML = reports.length === 0 ? `<tr><td colspan="3">Još ništa nije poslato.</td></tr>`
            : reports.map(r => `<tr>
                <td>${escapeHtml(formatDateTime(r.sent_at))}</td>
                <td>${escapeHtml(String(r.doc_count))}</td>
                <td>${escapeHtml((r.recipients || []).join(", "))}</td>
            </tr>`).join("");
    }catch(error){
        box.innerHTML = `<tr><td colspan="3">${escapeHtml(errorMessage(error, "Greška pri učitavanju istorije."))}</td></tr>`;
    }
}

function buildEmailHtml(docs, part){
    const groups = api.ACCOUNTANT_CATEGORIES.map(cat => [cat, docs.filter(d => d.category === cat)]).filter(([, list]) => list.length);
    const sections = groups.map(([cat, list]) => `<div style="margin-top:16px;"><div style="font-weight:800;">${escapeHtml(CATEGORIES[cat].label)} (${list.length})</div>`
        + `<ul style="margin:6px 0 0;padding-left:20px;line-height:1.6;">${list.map(d => `<li>${escapeHtml(d.file_name)}</li>`).join("")}</ul></div>`).join("");
    return `<div style="background:#eaf7ff;padding:28px;font-family:Arial,sans-serif;color:#0f172a;"><div style="max-width:680px;margin:0 auto;background:white;border-radius:22px;overflow:hidden;border:1px solid #d7e8f5;">`
        + `<div style="padding:24px;border-bottom:3px solid #073b44;"><img src="cid:mmlogo" alt="M&M Safety" style="width:150px;height:auto;display:block;">`
        + `<div style="margin-top:12px;font-size:20px;font-weight:800;">Izveštaj knjigovođi${part ? " – deo " + part : ""}</div>`
        + `<div style="margin-top:6px;color:#64748b;">${escapeHtml(formatDate(todayIso()))} · fakture i izvodi od prethodnog slanja</div></div>`
        + `<div style="padding:24px;">${sections}<p style="margin-top:22px;color:#475569;">Dokumenti su u prilogu.</p></div></div></div>`;
}

export async function sendAccountantReport(){
    if(sending) return;
    const status = $("accountantStatus");
    const to = emails.get();
    if(to === null) return;
    if(!to.length){ alert("Dodajte mejl knjigovođe"); return; }
    if(!startDate()){ alert("Izaberite datum od kog se šalje"); return; }
    if(!pending.length){ status.textContent = "Nema novih faktura ni izvoda za slanje."; return; }

    sending = true;
    $("accountantSendBtn").disabled = true;
    let report = null;
    let sentCount = 0;
    let test = false;
    try{
        // Mejlovi (i datum prvog slanja) se pamte; trigger ih dodaje u listu dozvoljenih primalaca.
        settings = await api.updateAccountantSettings({ emails: to, start_date: startDate() });

        const queue = [];
        for(let i = 0; i < pending.length; i += BATCH_SIZE) queue.push(pending.slice(i, i + BATCH_SIZE));
        const multiPart = queue.length > 1;
        let part = 0;
        while(queue.length){
            const batch = queue.shift();
            const label = multiPart || queue.length || part ? String(part + 1) : "";
            status.textContent = `Šaljem ${sentCount + 1}–${sentCount + batch.length} od ${pending.length}...`;
            let result;
            try{
                result = await api.sendEmail({
                    to,
                    subject: `Izveštaj knjigovođi ${formatDate(todayIso())}${label ? " – deo " + label : ""} – M&M SAFETY DOO`,
                    html: buildEmailHtml(batch, label),
                    attachments: batch.map(d => ({ bucket: d.bucket, path: d.path, filename: d.file_name })),
                    kind: "izvestaj",
                    record_id: report?.id || null
                });
            }catch(error){
                if(error.tooLarge && batch.length > 1){
                    const half = Math.ceil(batch.length / 2);
                    queue.unshift(batch.slice(0, half), batch.slice(half));
                    continue;
                }
                throw error;
            }
            part++;
            test = test || !!result?.test;
            if(!report) report = await api.addAccountantReport(to);
            await api.markDocumentsSent(report.id, batch.map(d => d.id));
            sentCount += batch.length;
            await api.setAccountantReportCount(report.id, sentCount);
        }
        status.textContent = (test ? "TEST: poslato samo na test adresu. " : "") + `Poslato knjigovođi: ${sentCount} dokumenata`
            + (part > 1 ? ` u ${part} mejla.` : ".") + " Označeni su kao poslati.";
    }catch(error){
        status.textContent = errorMessage(error, "Greška pri slanju.")
            + (sentCount ? ` Poslato i označeno: ${sentCount} od ${pending.length}; ostali ostaju za sledeće slanje.` : "");
    }finally{
        sending = false;
        $("accountantSendBtn").disabled = false;
        showStart();
        await Promise.all([loadPending(), loadHistory()]);
    }
}

export function initAccountant(){
    emails = new EmailList($("accountantEmails"));
    $("accountantList").addEventListener("click", (event) => {
        const open = event.target.closest("button[data-open]");
        if(open) openViewer(pending, Number(open.dataset.open));
    });
}
