// Sačuvaj račun (upload u inbox) i izbor računa uz transakciju.
import * as api from "./api.js";
import { escapeHtml, errorMessage, showModal, hideModal } from "./util.js";
import { receiptFileName, storageKey, shortId, checkUploadFile, contentTypeOf, extensionOf } from "./files.js";

const $ = (id) => document.getElementById(id);

// ---------- Sačuvaj račun ----------

let localFile = null;
let fileHandle = null;
let canDeleteOriginal = false;

function supportsDeletablePicker(){
    return window.isSecureContext && typeof window.showOpenFilePicker === "function";
}

function resetFileSelection(){
    $("receiptFile").value = "";
    $("receiptFileName").textContent = "";
    localFile = null;
    fileHandle = null;
    canDeleteOriginal = false;
}

export function openReceiptModal(){
    resetFileSelection();
    const picker = supportsDeletablePicker();
    $("receiptFile").style.display = picker ? "none" : "block";
    $("receiptPickerBtn").style.display = picker ? "block" : "none";
    $("receiptNote").value = "";
    $("receiptMessage").textContent = "";
    showModal("receiptModal");
}

export function closeReceiptModal(){ hideModal("receiptModal"); }

// Chrome/Edge: izbor fajla sa dozvolom da se original obriše posle uspešnog čuvanja (kao 1.x).
export async function chooseReceiptFile(){
    const message = $("receiptMessage");
    try{
        const [handle] = await window.showOpenFilePicker({ multiple: false, types: [{ description: "PDF ili slika", accept: {
            "application/pdf": [".pdf"], "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/heic": [".heic", ".heif"] } }] });
        const file = await handle.getFile();
        let permission = "denied";
        if(typeof handle.requestPermission === "function") permission = await handle.requestPermission({ mode: "readwrite" });
        fileHandle = handle;
        localFile = file;
        canDeleteOriginal = permission === "granted";
        $("receiptFileName").textContent = file.name + (canDeleteOriginal
            ? " - biće obrisan sa računara posle uspešnog čuvanja"
            : " - nema dozvole za automatsko brisanje");
        message.textContent = "";
    }catch(error){
        if(error?.name === "AbortError") return;
        message.style.color = "#ef4444";
        message.textContent = "Fajl nije moguće otvoriti.";
    }
}

export function handleReceiptFileFallback(){
    const file = $("receiptFile").files[0];
    localFile = file || null;
    fileHandle = null;
    canDeleteOriginal = false;
    $("receiptFileName").textContent = file ? file.name + " - pregledač ne dozvoljava automatsko brisanje originala" : "";
}

export async function saveReceipt(){
    const message = $("receiptMessage");
    const file = localFile || $("receiptFile").files[0];
    const note = $("receiptNote").value.trim();
    if(!file){
        message.style.color = "#ef4444";
        message.textContent = "Izaberite fajl.";
        return;
    }
    const problem = checkUploadFile(file);
    if(problem){
        message.style.color = "#ef4444";
        message.textContent = problem;
        return;
    }

    message.style.color = "#22c55e";
    message.textContent = "Čuvam račun...";
    const fileName = receiptFileName(note, file.name);
    const path = `inbox/${shortId()}/${storageKey(fileName)}`;
    try{
        await api.uploadFile("receipts", path, file, { contentType: contentTypeOf(file) });
        await api.addReceipt({ storage_path: path, original_name: file.name, note: note || null });
    }catch(error){
        message.style.color = "#ef4444";
        message.textContent = errorMessage(error, "Greška pri čuvanju računa.");
        return;
    }

    let localMessage = " Originalni fajl je ostao na računaru.";
    if(fileHandle && canDeleteOriginal && typeof fileHandle.remove === "function"){
        try{
            await fileHandle.remove();
            localMessage = " Originalni fajl je obrisan sa računara.";
        }catch{
            localMessage = " Račun je sačuvan, ali originalni fajl nije moguće obrisati sa računara.";
        }
    }
    resetFileSelection();
    message.style.color = localMessage.includes("je obrisan") ? "#22c55e" : "#f59e0b";
    message.textContent = "Račun je uspešno sačuvan: " + fileName + "." + localMessage;
    setTimeout(closeReceiptModal, 2200);
}

// ---------- Račun uz transakciju ----------

let inbox = [];
let selected = null;

export function receiptDisplayName(r){
    return r.storage_path.split("/").pop();
}

export function resetTransactionReceiptPanel(){
    inbox = [];
    selected = null;
    $("transactionReceiptSelect").innerHTML = '<option value="">Prvo kliknite PREUZMI RAČUN</option>';
    $("transactionReceiptPreview").textContent = "Preview računa će se prikazati ovde.";
    $("transactionReceiptInfo").textContent = "";
}

export async function loadTransactionReceipts(){
    const info = $("transactionReceiptInfo");
    const select = $("transactionReceiptSelect");
    info.textContent = "Učitavam sačuvane račune...";
    $("transactionReceiptPreview").textContent = "Preview računa će se prikazati ovde.";
    selected = null;
    try{
        inbox = await api.listInboxReceipts();
        if(!inbox.length){
            select.innerHTML = '<option value="">Nema sačuvanih računa</option>';
            info.textContent = "Nema računa za preuzimanje. Dodajte ih kroz Sačuvaj račun.";
            return;
        }
        select.innerHTML = '<option value="">Izaberite račun</option>' +
            inbox.map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(receiptDisplayName(r))}</option>`).join("");
        info.textContent = "Izaberite račun iz liste.";
    }catch(error){
        info.textContent = errorMessage(error, "Greška pri učitavanju računa.");
    }
}

export async function selectTransactionReceipt(){
    const preview = $("transactionReceiptPreview");
    const info = $("transactionReceiptInfo");
    selected = inbox.find(r => r.id === $("transactionReceiptSelect").value) || null;
    if(!selected){
        preview.textContent = "Preview računa će se prikazati ovde.";
        info.textContent = "";
        return;
    }
    preview.textContent = "Učitavam račun...";
    try{
        const url = await api.signedUrl("receipts", selected.storage_path);
        const isPdf = extensionOf(selected.storage_path) === ".pdf";
        preview.innerHTML = isPdf ? `<iframe title="Račun"></iframe>` : `<img alt="Račun">`;
        preview.firstElementChild.src = url;
        info.innerHTML = `Izabrano: <strong>${escapeHtml(receiptDisplayName(selected))}</strong>`;
    }catch(error){
        preview.textContent = errorMessage(error, "Račun nije moguće učitati.");
    }
}

export function selectedReceipt(){ return selected; }

// Posle čuvanja transakcije: račun prelazi u transactions/<tx_id>/ pod imenom dokumenta transakcije.
export async function attachSelectedReceipt(transactionId, baseName){
    if(!selected) return null;
    const ext = extensionOf(selected.storage_path);
    const target = `transactions/${transactionId}/${storageKey(baseName.replace(/\.pdf$/i, ""))}${ext}`;
    await api.moveFile("receipts", selected.storage_path, target);
    await api.attachReceipt(selected.id, transactionId, target);
    const name = target.split("/").pop();
    selected = null;
    return name;
}
