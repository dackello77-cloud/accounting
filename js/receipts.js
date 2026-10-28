// Sačuvaj račun (upload u inbox) i izbor računa uz transakciju.
import * as api from "./api.js";
import { escapeHtml, errorMessage, showModal, hideModal, formatMoney, parseAmount, bindAmountInput } from "./util.js";
import { loadDashboard } from "./dashboard.js";
import { scanImage } from "./scan.js";
import { receiptFileName, storageKey, shortId, checkUploadFile, contentTypeOf, extensionOf } from "./files.js";

const $ = (id) => document.getElementById(id);

// ---------- Podaci za Potraživanja (kompanija, broj fakture, iznos) ----------

// Kompanije su partneri grupe Klijenti; neaktivan partner ostaje u listi ako je već izabran.
export async function fillClaimPartners(select, currentId = ""){
    select.innerHTML = '<option value="">Učitavam...</option>';
    let partners = await api.listPartners("klijenti");
    partners = partners.filter(p => p.active || p.id === currentId);
    select.innerHTML = '<option value="">Izaberite kompaniju</option>' +
        partners.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
    select.value = currentId || "";
    select.searchSync?.();
}

// Sva tri polja ili nijedno; vraća { fields } ili { error }.
export function readClaim(select, invoiceInput, amountInput){
    const partnerId = select.value;
    const invoice = invoiceInput.value.trim();
    const amountText = amountInput.value.trim();
    if(!partnerId && !invoice && !amountText) return { fields: { partner_id: null, invoice_number: null, amount: null } };
    if(!partnerId) return { error: "Izaberite kompaniju." };
    if(!invoice) return { error: "Unesite broj fakture." };
    if(!amountText) return { error: "Unesite iznos za plaćanje." };
    const amount = parseAmount(amountText);
    if(amount === null || amount <= 0) return { error: "Unesite ispravan iznos za plaćanje." };
    return { fields: { partner_id: partnerId, invoice_number: invoice, amount } };
}

// ---------- Sačuvaj račun ----------

let localFile = null;
let fileHandle = null;
let canDeleteOriginal = false;
let saving = false;

function supportsDeletablePicker(){
    return window.isSecureContext && typeof window.showOpenFilePicker === "function";
}

function hideScanPreview(){
    const preview = $("receiptScanPreview");
    if(preview.src) URL.revokeObjectURL(preview.src);
    preview.removeAttribute("src");
    preview.hidden = true;
}

function resetFileSelection(){
    $("receiptFile").value = "";
    $("receiptCamera").value = "";
    hideScanPreview();
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
    $("receiptInvoice").value = "";
    $("receiptAmount").value = "";
    $("receiptMessage").textContent = "";
    showModal("receiptModal");
    fillClaimPartners($("receiptPartner")).catch(error => {
        $("receiptPartner").innerHTML = '<option value="">Greška pri učitavanju</option>';
        $("receiptMessage").style.color = "#ef4444";
        $("receiptMessage").textContent = errorMessage(error, "Greška pri učitavanju kompanija.");
    });
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
        hideScanPreview();
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

// Fotografija sa kamere → skeniranje (list, perspektiva, izgled skenera) → JPEG za čuvanje.
export async function handleReceiptCamera(){
    const photo = $("receiptCamera").files[0];
    $("receiptCamera").value = "";
    if(!photo) return;
    const message = $("receiptMessage");
    message.textContent = "";
    let scanned;
    try{
        scanned = await scanImage(photo);
    }catch(error){
        console.error(error);
        message.style.color = "#ef4444";
        message.textContent = "Fotografiju nije moguće otvoriti. Pokušajte ponovo.";
        return;
    }
    if(!scanned) return;
    resetFileSelection();
    localFile = scanned;
    const preview = $("receiptScanPreview");
    preview.src = URL.createObjectURL(scanned);
    preview.hidden = false;
    $("receiptFileName").textContent = `Skeniran račun (${(scanned.size / 1024).toLocaleString("sr-Latn-RS", { maximumFractionDigits: 0 })} KB)`;
}

export function handleReceiptFileFallback(){
    const file = $("receiptFile").files[0];
    hideScanPreview();
    localFile = file || null;
    fileHandle = null;
    canDeleteOriginal = false;
    $("receiptFileName").textContent = file ? file.name + " - pregledač ne dozvoljava automatsko brisanje originala" : "";
}

export async function saveReceipt(){
    if(saving) return;
    const message = $("receiptMessage");
    const file = localFile || $("receiptFile").files[0];
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
    const claim = readClaim($("receiptPartner"), $("receiptInvoice"), $("receiptAmount"));
    if(claim.error){
        message.style.color = "#ef4444";
        message.textContent = claim.error;
        return;
    }

    const company = claim.fields.partner_id ? $("receiptPartner").selectedOptions[0]?.textContent : "";
    const fileName = receiptFileName(company, claim.fields.invoice_number, file.name);
    const path = `inbox/${shortId()}/${storageKey(fileName)}`;
    const started = performance.now();
    const seconds = () => ((performance.now() - started) / 1000).toLocaleString("sr-Latn-RS", { maximumFractionDigits: 1 }) + " s";
    saving = true;
    $("receiptSaveBtn").disabled = true;
    message.style.color = "#22c55e";
    try{
        message.textContent = `Šaljem fajl (${(file.size / 1048576).toLocaleString("sr-Latn-RS", { maximumFractionDigits: 1 })} MB)...`;
        await api.uploadFile("receipts", path, file, { contentType: contentTypeOf(file) });
        message.textContent = `Fajl poslat za ${seconds()}. Upisujem podatke...`;
        await api.addReceipt({ storage_path: path, original_name: file.name, ...claim.fields });
        loadDashboard();
    }catch(error){
        message.style.color = "#ef4444";
        message.textContent = errorMessage(error, "Greška pri čuvanju računa.");
        return;
    }finally{
        saving = false;
        $("receiptSaveBtn").disabled = false;
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
    $("receiptPartner").value = "";
    $("receiptPartner").searchSync?.();
    $("receiptInvoice").value = "";
    $("receiptAmount").value = "";
    message.style.color = localMessage.includes("je obrisan") ? "#22c55e" : "#f59e0b";
    message.textContent = `Račun je uspešno sačuvan (${seconds()}): ${fileName}.${localMessage}`;
    setTimeout(closeReceiptModal, 2200);
}

export function initReceipts(){
    bindAmountInput($("receiptAmount"));
}

// ---------- Račun uz transakciju ----------

let inbox = [];
let selected = null;

export function receiptDisplayName(r){
    return r.storage_path.split("/").pop();
}

// Naziv u listi uz transakciju: potraživanje pokazuje kompaniju, broj i preostali iznos.
function pickerLabel(r){
    if(r.amount == null) return receiptDisplayName(r);
    return `${r.partner_name} – br. ${r.invoice_number} – preostalo ${formatMoney(r.remaining)} RSD`;
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
        // Računi na čekanju + otvorena potraživanja (i delimično plaćena, već povezana sa uplatom).
        const [pending, receivables] = await Promise.all([api.listInboxReceipts(), api.listReceivables()]);
        const open = receivables.filter(r => r.status !== "placena");
        const openIds = new Set(receivables.map(r => r.id));
        inbox = open.concat(pending.filter(r => !openIds.has(r.id)));
        if(!inbox.length){
            select.innerHTML = '<option value="">Nema sačuvanih računa</option>';
            info.textContent = "Nema računa za preuzimanje. Dodajte ih kroz Sačuvaj račun.";
            return;
        }
        select.innerHTML = '<option value="">Izaberite račun</option>' +
            inbox.map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(pickerLabel(r))}</option>`).join("");
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
// Račun koji je već uz raniju uplatu (delimično plaćen) ostaje gde jeste; veza je transactions.receipt_id.
// Račun za plaćanje zadržava naziv "Kompanija - broj fakture".
export async function attachSelectedReceipt(transactionId, baseName){
    if(!selected) return null;
    if(selected.amount != null) baseName = receiptDisplayName(selected).replace(/\.[^.]+$/, "");
    if(selected.transaction_id){
        const name = receiptDisplayName(selected);
        selected = null;
        return name;
    }
    const ext = extensionOf(selected.storage_path);
    const target = `transactions/${transactionId}/${storageKey(baseName.replace(/\.pdf$/i, ""))}${ext}`;
    await api.moveFile("receipts", selected.storage_path, target);
    await api.attachReceipt(selected.id, transactionId, target);
    const name = target.split("/").pop();
    selected = null;
    return name;
}
