// Ulaz / Porezi / Klijenti / Zaposleni: isti obrazac, kategorija iz stavke menija.
import * as api from "./api.js";
import { escapeHtml, formatMoney, formatDate, parseAmount, todayIso, bindAmountInput, openPrintWindow,
         errorMessage, showModal, hideModal, TYPE_LABELS } from "./util.js";
import { LOGO_URL } from "./logo.js";
import { loadDashboard } from "./dashboard.js";
import { documentFileName } from "./files.js";
import { savePdfDocument } from "./docsave.js";
import { resetTransactionReceiptPanel, selectedReceipt, attachSelectedReceipt, selectTransactionReceipt as pickReceipt } from "./receipts.js";
import { focusSearchable } from "./searchselect.js";

const $ = (id) => document.getElementById(id);
let currentType = "";
let partners = [];
let banks = [];
let lastTransaction = null;
// PDF poslednje transakcije je već u Dokumenti → Transakcije (čuva se odmah posle SAVE).
let pdfSaved = false;
let saving = false;

export async function openTransactionModal(type){
    currentType = type;
    $("transactionTitle").textContent = "Nova transakcija – " + TYPE_LABELS[type];
    // Račun uz transakciju postoji samo kod Klijenata.
    $("transactionModal").classList.toggle("no-receipt", type !== "klijenti");
    resetTransactionModal();
    showModal("transactionModal");
    await Promise.all([loadPartners(), loadBanks()]);
}

// Podrazumevana banka (Intesa), osim kad partner ima prioritetnu.
function defaultBankId(partner){
    const id = partner?.bank_id;
    return banks.some(b => b.id === id) ? id : (banks.find(b => b.is_default) || banks[0])?.id || "";
}

async function loadBanks(){
    try{
        banks = await api.listBanks({ activeOnly: true });
        $("transactionBank").innerHTML = banks.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join("");
        $("transactionBank").value = defaultBankId(partners.find(x => x.id === $("transactionPartner").value));
    }catch(error){
        $("transactionDocStatus").textContent = errorMessage(error, "Greška pri učitavanju banaka.");
    }
}

export function closeTransactionModal(){
    resetTransactionModal();
    hideModal("transactionModal");
}

function resetTransactionModal(){
    saving = false;
    lastTransaction = null;
    pdfSaved = false;
    ["transactionAddress", "transactionZiro", "transactionAmount", "transactionInvoice", "transactionNotes"].forEach(id => $(id).value = "");
    $("transactionPartner").value = "";
    $("transactionPartner").searchSync?.();
    $("transactionDate").value = todayIso();
    $("transactionBank").value = defaultBankId(null);
    $("transactionDocActions").style.display = "none";
    $("transactionDocStatus").textContent = "";
    const btn = $("transactionSaveBtn");
    btn.style.display = "block";
    btn.disabled = false;
    btn.textContent = "SAVE";
    resetTransactionReceiptPanel();
}

async function loadPartners(){
    const select = $("transactionPartner");
    select.innerHTML = '<option value="">Učitavam...</option>';
    try{
        partners = await api.listPartners(currentType, { activeOnly: true });
        select.innerHTML = '<option value="">Izaberite naziv</option>' +
            partners.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
        if(!partners.length) $("transactionDocStatus").textContent = "Nema aktivnih partnera u ovoj kategoriji. Dodajte ih u Dodaj / Uredi.";
    }catch(error){
        select.innerHTML = '<option value="">Greška pri učitavanju</option>';
        $("transactionDocStatus").textContent = errorMessage(error, "Greška pri učitavanju liste.");
    }
}

export function fillEntityData(){
    const p = partners.find(x => x.id === $("transactionPartner").value);
    $("transactionAddress").value = p?.address || "";
    $("transactionZiro").value = p?.bank_account || "";
    $("transactionBank").value = defaultBankId(p);
}

// Račun iz Potraživanja popunjava kompaniju, broj fakture i preostali iznos (sve se može promeniti).
export async function selectTransactionReceipt(){
    await pickReceipt();
    const r = selectedReceipt();
    if(r?.amount == null) return;
    const select = $("transactionPartner");
    if(partners.some(p => p.id === r.partner_id)){
        select.value = r.partner_id;
        select.searchSync?.();
        fillEntityData();
    }else{
        $("transactionDocStatus").textContent = "Kompanija sa računa nije aktivna u listi Klijenti; izaberite naziv ručno.";
    }
    $("transactionInvoice").value = r.invoice_number || "";
    $("transactionAmount").value = formatMoney(r.remaining);
}

export function newTransactionAfterSave(){
    resetTransactionModal();
    focusSearchable($("transactionPartner"));
}

export async function saveTransaction(){
    if(saving) return;
    const partner = partners.find(x => x.id === $("transactionPartner").value);
    const amountText = $("transactionAmount").value;
    const amount = parseAmount(amountText);
    const txDate = $("transactionDate").value;

    if(!partner){ alert("Izaberite naziv"); return; }
    if(amountText.trim() === ""){ alert("Unesite iznos"); return; }
    if(amount === null){ alert("Unesite ispravan iznos"); return; }
    if(!txDate){ alert("Unesite datum"); return; }
    if(!$("transactionBank").value){ alert("Izaberite banku"); return; }

    saving = true;
    const btn = $("transactionSaveBtn");
    btn.disabled = true;
    btn.textContent = "ČUVAM...";
    $("transactionDocStatus").textContent = "Čuvam transakciju...";

    try{
        lastTransaction = await api.addTransaction({
            tx_date: txDate,
            type: currentType,
            partner_id: partner.id,
            partner_name: partner.name,
            address: partner.address || null,
            bank_account: partner.bank_account || null,
            invoice_number: $("transactionInvoice").value.trim() || null,
            amount,
            notes: $("transactionNotes").value.trim() || null,
            receipt_id: selectedReceipt()?.id || null,
            bank_id: $("transactionBank").value
        });
    }catch(error){
        $("transactionDocStatus").textContent = errorMessage(error, "Greška pri čuvanju.");
        saving = false;
        btn.disabled = false;
        btn.textContent = "SAVE";
        return;
    }

    loadDashboard();

    if(selectedReceipt()){
        $("transactionDocStatus").textContent = "Povezujem račun sa transakcijom...";
        try{
            const name = await attachSelectedReceipt(lastTransaction.id, transactionFileName(lastTransaction));
            $("transactionReceiptInfo").innerHTML = `Račun je povezan i preimenovan: <strong>${escapeHtml(name)}</strong>`;
        }catch(error){
            console.error(error);
            $("transactionReceiptInfo").textContent = "Račun nije povezan, ali je transakcija sačuvana.";
        }
    }

    btn.style.display = "none";
    btn.textContent = "SAVE";
    $("transactionDocActions").style.display = "block";
    // PDF se čuva odmah, da dokument postoji i kad se ne odštampa.
    $("transactionDocStatus").textContent = "Transakcija je sačuvana. Čuvam PDF u Dokumenti → Transakcije...";
    const t = lastTransaction;
    try{
        const doc = await saveTransactionPdf(t);
        if(t !== lastTransaction) return;
        pdfSaved = true;
        $("transactionDocStatus").textContent = "Transakcija i PDF su sačuvani (Dokumenti → Transakcije: " + doc.fileName + "). Možete da štampate.";
    }catch(error){
        if(t !== lastTransaction) return;
        $("transactionDocStatus").textContent = errorMessage(error, "PDF nije sačuvan.") + " Transakcija je sačuvana; pokušajte SAVE PDF.";
    }
    setTimeout(() => $("transactionDocActions").scrollIntoView({ behavior: "smooth", block: "center" }), 100);
}

// bankList: banke za nazive (prenos ih prosleđuje iz svog modala).
export function buildTransactionDocumentHtml(t, bankList = banks){
    const row = (label, value, cls = "") => `<tr><td class="label">${label}</td><td class="${cls}">${value}</td></tr>`;
    const bankName = (id) => escapeHtml(bankList.find(b => b.id === id)?.name);
    const rows = t.type === "prenos"
        ? row("Sa banke", bankName(t.bank_id)) + row("Na banku", bankName(t.to_bank_id))
        : row("Naziv", escapeHtml(t.partner_name))
            + row("Adresa", escapeHtml(t.address))
            + row("Žiro račun", escapeHtml(t.bank_account))
            + row("Banka", bankName(t.bank_id))
            + row("Broj fakture", escapeHtml(t.invoice_number));
    return `<html><head><meta charset="UTF-8"><title>Transakcija</title><style>body{font-family:Arial,sans-serif;padding:30px;color:#111}.header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #111;padding-bottom:15px;margin-bottom:30px}.logo{width:150px}table{width:100%;border-collapse:collapse;margin-top:20px}td{border:1px solid #999;padding:12px;font-size:14px}.label{width:220px;font-weight:bold;background:#f1f5f9}.amount{font-size:22px;font-weight:bold}</style></head><body>`
        + `<div class="header"><div><h1>${t.type === "prenos" ? "Prenos između banaka" : "Transakcija"}</h1><div>M&M Safety Accounting</div></div><img src="${LOGO_URL}" class="logo"></div><table>`
        + row("Datum", escapeHtml(formatDate(t.tx_date)))
        + row("Tip", escapeHtml(TYPE_LABELS[t.type] || t.type))
        + rows
        + row("Notes", escapeHtml(t.notes))
        + row("Iznos", formatMoney(t.amount) + " RSD", "amount")
        + `</table></body></html>`;
}

function transactionFileName(t, bankList = banks){
    if(t.type === "prenos"){
        const name = (id) => bankList.find(b => b.id === id)?.name || "";
        return documentFileName(t.tx_date, "Prenos", `${name(t.bank_id)}-${name(t.to_bank_id)}`);
    }
    return documentFileName(t.tx_date, t.partner_name, t.invoice_number);
}

// PDF transakcije u Storage (transakcije/<id>/…); ponovno čuvanje iste transakcije prepisuje fajl.
export async function saveTransactionPdf(t, bankList = banks){
    const doc = await savePdfDocument({ html: buildTransactionDocumentHtml(t, bankList), category: "transakcije", fileName: transactionFileName(t, bankList), subfolder: t.id });
    await api.setTransactionDocument(t.id, doc.path);
    return doc;
}

export async function handleTransactionDocumentAction(action){
    const status = $("transactionDocStatus");
    const t = lastTransaction;
    if(!t){ status.textContent = "Prvo sačuvajte transakciju."; return; }

    if((action === "save" || action === "both") && pdfSaved){
        status.textContent = "PDF je već sačuvan u Dokumenti → Transakcije.";
        if(action === "save") return;
    }else if(action === "save" || action === "both"){
        status.textContent = "Čuvam PDF...";
        try{
            const doc = await saveTransactionPdf(t);
            pdfSaved = true;
            status.textContent = "PDF je sačuvan: " + doc.fileName;
        }catch(error){
            status.textContent = errorMessage(error, "Greška pri čuvanju PDF-a.");
            return;
        }
        if(action === "save") return;
        status.textContent = "PDF je sačuvan. Otvaram štampu...";
    }else{
        status.textContent = "Otvaram prozor za štampu...";
    }
    openPrintWindow(buildTransactionDocumentHtml(t));
    setTimeout(() => { closeTransactionModal(); loadDashboard(); }, 500);
}

export function initTransaction(){
    bindAmountInput($("transactionAmount"));
}
