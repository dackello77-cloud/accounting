// Dokumenti: lista fajlova po kategoriji iz Storage-a (otvori / preuzmi) i upload izvoda.
import * as api from "./api.js";
import { escapeHtml, formatDateTime, errorMessage, showModal, hideModal } from "./util.js";
import { CATEGORIES, storageKey, shortId, checkUploadFile, contentTypeOf } from "./files.js";
import { openStorageFile } from "./docsave.js";
import { receiptDisplayName } from "./receipts.js";

const $ = (id) => document.getElementById(id);
let current = "";
let files = [];

export function openDocumentsModal(){
    $("documentsGrid").innerHTML = Object.entries(CATEGORIES).map(([key, c]) =>
        `<button class="document-folder-btn" data-category="${key}"><strong>${escapeHtml(c.label)}</strong><span>${escapeHtml(c.hint)}</span></button>`).join("");
    $("documentsListBox").style.display = "none";
    current = "";
    showModal("documentsModal");
}

export function closeDocumentsModal(){ hideModal("documentsModal"); }

async function showCategory(category){
    current = category;
    const c = CATEGORIES[category];
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
        if(current === "racuni"){
            const receipts = await api.listAllReceipts();
            files = receipts.map(r => ({ bucket: "receipts", path: r.storage_path, name: receiptDisplayName(r), at: r.uploaded_at, note: r.transaction_id ? "uz transakciju" : "nepovezan" }));
        }else{
            const docs = await api.listDocuments(current);
            files = docs.map(d => ({ bucket: CATEGORIES[current].bucket, path: d.storage_path, name: d.file_name, at: d.created_at, note: "" }));
        }
        list.innerHTML = files.length === 0 ? `<tr><td colspan="3">Nema dokumenata</td></tr>`
            : files.map((f, i) => `<tr>
                <td>${escapeHtml(f.name)}${f.note ? `<div class="doc-note">${escapeHtml(f.note)}</div>` : ""}</td>
                <td>${escapeHtml(formatDateTime(f.at))}</td>
                <td class="doc-actions"><button data-open="${i}">Otvori</button><button data-download="${i}">Preuzmi</button></td>
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
        const open = event.target.closest("button[data-open]");
        const download = event.target.closest("button[data-download]");
        const f = files[Number((open || download)?.dataset.open ?? (open || download)?.dataset.download)];
        if(!f) return;
        try{
            await openStorageFile(f.bucket, f.path, download ? f.name : undefined);
        }catch(error){
            $("documentsStatus").textContent = errorMessage(error, "Fajl nije moguće otvoriti.");
        }
    });
}
