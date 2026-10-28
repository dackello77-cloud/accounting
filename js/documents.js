// Dokumenti: lista fajlova po kategoriji iz Storage-a (otvori / preuzmi) i upload izvoda.
import * as api from "./api.js";
import { escapeHtml, formatMoney, formatDateTime, errorMessage, showModal, hideModal } from "./util.js";
import { CATEGORIES, storageKey, shortId, checkUploadFile, contentTypeOf } from "./files.js";
import { openStorageFile } from "./docsave.js";
import { openViewer } from "./viewer.js";
import { receiptDisplayName } from "./receipts.js";
import { openClaimEditor } from "./receivables.js";

const $ = (id) => document.getElementById(id);
let current = "";
let files = [];
// Računi na čekanju (inbox): otvaraju se sa početnog ekrana, nisu folder u mreži.
const PENDING = { label: "Računi na čekanju", upload: false };
const categoryOf = (key) => key === "racuni_cekanje" ? PENDING : CATEGORIES[key];

export function openDocumentsModal(){
    $("documentsGrid").innerHTML = Object.entries(CATEGORIES).map(([key, c]) =>
        `<button class="document-folder-btn" data-category="${key}"><strong>${escapeHtml(c.label)}</strong><span>${escapeHtml(c.hint)}</span></button>`).join("");
    $("documentsListBox").style.display = "none";
    current = "";
    showModal("documentsModal");
}

export async function openPendingReceipts(){
    openDocumentsModal();
    await showCategory("racuni_cekanje");
}

export function closeDocumentsModal(){ hideModal("documentsModal"); }

async function showCategory(category){
    current = category;
    const c = categoryOf(category);
    document.querySelectorAll("#documentsGrid .document-folder-btn").forEach(b => b.classList.toggle("active", b.dataset.category === category));
    $("documentsListBox").style.display = "block";
    $("documentsListTitle").textContent = c.label;
    $("documentsUpload").style.display = c.upload ? "grid" : "none";
    $("documentsStatus").textContent = "";
    await loadFiles();
    $("documentsListBox").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadFiles(){
    const list = $("documentsList");
    list.innerHTML = `<tr><td colspan="3">Učitavam...</td></tr>`;
    try{
        if(current === "racuni_cekanje"){
            const receipts = await api.listInboxReceipts();
            files = receipts.map(r => ({ bucket: "receipts", path: r.storage_path, name: receiptDisplayName(r), at: r.uploaded_at, receipt: r,
                note: [r.note, r.amount != null ? `za plaćanje ${formatMoney(r.amount)} RSD, br. ${r.invoice_number}` : ""].filter(Boolean).join(" · ") }));
        }else if(current === "racuni"){
            // Računi + arhiva plaćenih računa iz 1.x (prenesena migracijom, bez veze sa transakcijom).
            const [receipts, archived] = await Promise.all([api.listAllReceipts(), api.listDocuments("racuni")]);
            files = receipts.map(r => ({ bucket: "receipts", path: r.storage_path, name: receiptDisplayName(r), at: r.uploaded_at, note: r.transaction_id ? "uz transakciju" : "nepovezan" }))
                .concat(archived.map(d => ({ bucket: "receipts", path: d.storage_path, name: d.file_name, at: d.created_at, note: "arhiva" })))
                .sort((a, b) => String(b.at).localeCompare(String(a.at)));
        }else{
            const docs = await api.listDocuments(current);
            files = docs.map(d => ({ bucket: CATEGORIES[current].bucket, path: d.storage_path, name: d.file_name, at: d.created_at, note: "" }));
        }
        list.innerHTML = files.length === 0 ? `<tr><td colspan="3">${current === "racuni_cekanje" ? "Nema računa na čekanju" : "Nema dokumenata"}</td></tr>`
            : files.map((f, i) => `<tr>
                <td><button class="doc-name-btn" data-open="${i}">${escapeHtml(f.name)}</button>${f.note ? `<div class="doc-note">${escapeHtml(f.note)}</div>` : ""}</td>
                <td>${escapeHtml(formatDateTime(f.at))}</td>
                <td class="doc-actions">${f.receipt ? `<button data-claim="${i}">${f.receipt.amount != null ? "Podaci" : "Unesi podatke"}</button>` : ""}<button data-open="${i}">Otvori</button><button data-download="${i}">Preuzmi</button></td>
            </tr>`).join("");
    }catch(error){
        list.innerHTML = `<tr><td colspan="3">${escapeHtml(errorMessage(error, "Greška pri učitavanju dokumenata."))}</td></tr>`;
    }
}

export async function uploadStatement(){
    const input = $("documentsFile");
    const status = $("documentsStatus");
    const chosen = [...input.files];
    if(!chosen.length){ status.textContent = "Izaberite fajl."; return; }
    const c = CATEGORIES[current];
    for(const file of chosen){
        const problem = checkUploadFile(file);
        if(problem){ status.textContent = file.name + ": " + problem; return; }
    }
    try{
        for(const [i, file] of chosen.entries()){
            status.textContent = `Čuvam ${i + 1}/${chosen.length}: ${file.name}...`;
            const path = `${c.folder}/${shortId()}/${storageKey(file.name)}`;
            await api.uploadFile(c.bucket, path, file, { contentType: contentTypeOf(file) });
            await api.upsertDocument(current, path, file.name);
        }
        input.value = "";
        status.textContent = chosen.length === 1 ? "Izvod je sačuvan." : `Sačuvano izvoda: ${chosen.length}.`;
        await loadFiles();
    }catch(error){
        status.textContent = errorMessage(error, "Greška pri čuvanju izvoda.");
    }
}

export function initDocuments(){
    $("documentsGrid").addEventListener("click", (event) => {
        const btn = event.target.closest("button[data-category]");
        if(btn) showCategory(btn.dataset.category);
    });
    $("documentsList").addEventListener("click", async (event) => {
        const claim = event.target.closest("button[data-claim]");
        if(claim){ openClaimEditor(files[Number(claim.dataset.claim)].receipt, loadFiles); return; }
        const open = event.target.closest("button[data-open]");
        const download = event.target.closest("button[data-download]");
        const i = Number((open || download)?.dataset.open ?? (open || download)?.dataset.download);
        const f = files[i];
        if(!f) return;
        if(open){ openViewer(files, i); return; }
        try{
            await openStorageFile(f.bucket, f.path, f.name);
        }catch(error){
            $("documentsStatus").textContent = errorMessage(error, "Fajl nije moguće otvoriti.");
        }
    });
}
