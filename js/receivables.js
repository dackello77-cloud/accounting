// Potraživanja: računi za plaćanje (kompanija, broj, iznos) sa uplatama iz transakcija.
// Otvorene = neplaćene i delimično plaćene; Realizovane = plaćene (uplaćeno >= iznos).
import * as api from "./api.js";
import { escapeHtml, formatMoney, formatDate, errorMessage, showModal, hideModal, bindAmountInput } from "./util.js";
import { fillClaimPartners, readClaim, receiptDisplayName } from "./receipts.js";
import { openViewer } from "./viewer.js";
import { loadDashboard } from "./dashboard.js";

const $ = (id) => document.getElementById(id);
const STATUS_LABELS = { neplacena: "Neplaćena", delimicno: "Delimično plaćena", placena: "Plaćena" };

let all = [];
let tab = "open";
let shown = [];

export function openReceivablesModal(){
    tab = "open";
    $("receivablesCompany").value = "";
    showModal("receivablesModal");
    loadReceivables();
}

export function closeReceivablesModal(){ hideModal("receivablesModal"); }

export async function loadReceivables(){
    $("receivablesTable").innerHTML = `<tr><td colspan="7">Učitavam...</td></tr>`;
    try{
        all = await api.listReceivables();
    }catch(error){
        $("receivablesTable").innerHTML = `<tr><td colspan="7">${escapeHtml(errorMessage(error, "Greška pri učitavanju potraživanja."))}</td></tr>`;
        return;
    }
    const select = $("receivablesCompany");
    const current = select.value;
    const companies = [...new Map(all.map(r => [r.partner_id, r.partner_name])).entries()]
        .sort((a, b) => a[1].localeCompare(b[1], "sr"));
    select.innerHTML = '<option value="">Sve kompanije</option>' +
        companies.map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join("");
    select.value = companies.some(([id]) => id === current) ? current : "";
    render();
}

export function showReceivablesTab(name){
    tab = name;
    render();
}

export function render(){
    const company = $("receivablesCompany").value;
    const open = all.filter(r => r.status !== "placena");
    const done = all.filter(r => r.status === "placena");
    $("receivablesTabOpen").textContent = `Potraživanja (${open.length})`;
    $("receivablesTabDone").textContent = `Realizovane fakture (${done.length})`;
    $("receivablesTabOpen").classList.toggle("active", tab === "open");
    $("receivablesTabDone").classList.toggle("active", tab === "done");

    shown = (tab === "open" ? open : [...done].sort((a, b) => String(b.last_payment).localeCompare(String(a.last_payment))))
        .filter(r => !company || r.partner_id === company);

    renderSummary(open.filter(r => !company || r.partner_id === company));
    $("receivablesTable").innerHTML = shown.length === 0
        ? `<tr><td colspan="7">${tab === "open" ? "Nema otvorenih potraživanja" : "Nema realizovanih faktura"}</td></tr>`
        : shown.map((r, i) => `<tr data-row="${i}">
            <td>${escapeHtml(r.partner_name)}</td>
            <td>${escapeHtml(r.invoice_number)}</td>
            <td class="num">${formatMoney(r.amount)}</td>
            <td class="num">${formatMoney(r.paid)}</td>
            <td class="num ${Number(r.remaining) > 0 ? "red" : ""}">${formatMoney(r.remaining)}</td>
            <td><span class="recv-status s-${escapeHtml(r.status)}">${escapeHtml(STATUS_LABELS[r.status] || r.status)}</span><div class="doc-note">${escapeHtml(formatDate(r.last_payment))}</div></td>
            <td class="recv-actions"><button class="row-btn" data-payments="${i}">Uplate (${Number(r.payments)})</button><button class="row-btn" data-file="${i}">Račun</button><button class="row-btn" data-edit="${i}">Izmeni</button>${Number(r.payments) === 0 ? `<button class="row-btn danger" data-delete="${i}">Obriši</button>` : ""}</td>
        </tr>`).join("");
}

// Ukupno i po kompaniji: koliko je ostalo za plaćanje.
function renderSummary(open){
    const byCompany = new Map();
    for(const r of open){
        const c = byCompany.get(r.partner_name) || { count: 0, remaining: 0 };
        c.count++;
        c.remaining += Number(r.remaining);
        byCompany.set(r.partner_name, c);
    }
    const total = open.reduce((sum, r) => sum + Number(r.remaining), 0);
    $("receivablesTotal").textContent = formatMoney(total) + " RSD";
    $("receivablesByCompany").innerHTML = [...byCompany.entries()]
        .sort((a, b) => b[1].remaining - a[1].remaining)
        .map(([name, c]) => `<li><span>${escapeHtml(name)} <em>(${c.count})</em></span><strong>${formatMoney(c.remaining)}</strong></li>`).join("");
}

async function togglePayments(i, button){
    const row = button.closest("tr");
    if(row.nextElementSibling?.classList.contains("recv-payments")){
        row.nextElementSibling.remove();
        return;
    }
    const r = shown[i];
    const detail = document.createElement("tr");
    detail.className = "recv-payments";
    detail.innerHTML = `<td colspan="7">Učitavam uplate...</td>`;
    row.after(detail);
    try{
        const payments = await api.listReceivablePayments(r.id);
        detail.firstElementChild.innerHTML = payments.length === 0 ? "Nema uplata po ovoj fakturi."
            : `<table class="recv-payments-table"><thead><tr><th>Datum uplate</th><th>Iznos</th><th>Napomena</th></tr></thead><tbody>`
              + payments.map(p => `<tr><td class="nowrap">${escapeHtml(formatDate(p.tx_date))}</td><td class="num">${formatMoney(p.amount)}</td><td class="muted">${escapeHtml(p.notes)}</td></tr>`).join("")
              + `</tbody><tfoot><tr><td>Ukupno plaćeno</td><td class="num">${formatMoney(r.paid)}</td><td>Preostalo: ${formatMoney(r.remaining)} RSD</td></tr></tfoot></table>`;
    }catch(error){
        detail.firstElementChild.textContent = errorMessage(error, "Greška pri učitavanju uplata.");
    }
}

// ---------- Unos / izmena podataka računa ----------

let editing = null;
let afterSave = null;

// receipt: red iz receipts ili v_receivables (id, storage_path, partner_id, invoice_number, amount).
export async function openClaimEditor(receipt, onSaved){
    editing = receipt;
    afterSave = onSaved || null;
    $("claimFileName").textContent = receiptDisplayName(receipt);
    $("claimInvoice").value = receipt.invoice_number || "";
    $("claimAmount").value = receipt.amount == null ? "" : formatMoney(receipt.amount);
    $("claimMessage").textContent = "";
    showModal("claimModal");
    try{
        await fillClaimPartners($("claimPartner"), receipt.partner_id || "");
    }catch(error){
        $("claimMessage").textContent = errorMessage(error, "Greška pri učitavanju kompanija.");
    }
}

export function closeClaimModal(){ hideModal("claimModal"); }

export async function saveClaim(){
    if(!editing) return;
    const message = $("claimMessage");
    const claim = readClaim($("claimPartner"), $("claimInvoice"), $("claimAmount"));
    if(claim.error){ message.textContent = claim.error; return; }
    message.textContent = "Čuvam...";
    try{
        await api.setReceiptClaim(editing.id, claim.fields);
    }catch(error){
        message.textContent = errorMessage(error, "Greška pri čuvanju.");
        return;
    }
    closeClaimModal();
    await afterSave?.();
    loadDashboard();
}

// Briše se samo račun bez uplata (proverava i baza); posle brisanja nestaje iz svih lista.
export async function deleteReceiptConfirmed(receipt, onDeleted){
    const label = receipt.amount != null ? `${receipt.partner_name || ""} br. ${receipt.invoice_number}` : receiptDisplayName(receipt);
    if(!confirm(`Obrisati račun ${label}?`)) return;
    try{
        await api.deleteReceipt(receipt.id);
    }catch(error){
        alert(errorMessage(error, "Greška pri brisanju računa."));
        return;
    }
    await onDeleted?.();
    loadDashboard();
}

export function initReceivables(){
    bindAmountInput($("claimAmount"));
    $("receivablesTable").addEventListener("click", (event) => {
        const btn = event.target.closest("button");
        if(!btn) return;
        if(btn.dataset.payments !== undefined) togglePayments(Number(btn.dataset.payments), btn);
        else if(btn.dataset.file !== undefined){
            const r = shown[Number(btn.dataset.file)];
            openViewer([{ bucket: "receipts", path: r.storage_path, name: receiptDisplayName(r) }], 0);
        }
        else if(btn.dataset.edit !== undefined) openClaimEditor(shown[Number(btn.dataset.edit)], loadReceivables);
        else if(btn.dataset.delete !== undefined) deleteReceiptConfirmed(shown[Number(btn.dataset.delete)], loadReceivables);
    });
}
