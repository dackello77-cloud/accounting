// Kartica: partner iz liste (po partner_id), period, pojedinačno / po mesecima / po godinama.
import * as api from "./api.js";
import { escapeHtml, formatMoney, formatDate, currentMonthRange, openPrintWindow, errorMessage,
         showModal, hideModal, TYPE_LABELS } from "./util.js";
import { LOGO_URL } from "./logo.js";

const $ = (id) => document.getElementById(id);

function selectedTip(){ return document.querySelector('input[name="cardTip"]:checked')?.value || ""; }
function selectedView(){ return document.querySelector('input[name="cardView"]:checked')?.value || "single"; }

export function openCardModal(){
    resetCardModal();
    const { from, to } = currentMonthRange();
    $("cardFrom").value = from;
    $("cardTo").value = to;
    showModal("cardModal");
}

export function closeCardModal(){ resetCardModal(); hideModal("cardModal"); }

function resetCardModal(){
    document.querySelectorAll('input[name="cardTip"]').forEach(el => el.checked = false);
    $("cardPartner").innerHTML = '<option value="">Svi</option>';
    document.querySelector('input[name="cardView"][value="single"]').checked = true;
    $("cardHead").innerHTML = "";
    $("cardTable").innerHTML = `<tr><td colspan="6">Nema podataka</td></tr>`;
    $("cardDocStatus").textContent = "";
}

// Lista sadrži i neaktivne partnere, da bi se videla njihova istorija.
export async function loadCardEntities(){
    const select = $("cardPartner");
    select.innerHTML = '<option value="">Svi</option>';
    const tip = selectedTip();
    if(!tip) return;
    try{
        const partners = await api.listPartners(tip);
        select.innerHTML = '<option value="">Svi</option>' + partners.map(p =>
            `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name + (p.active ? "" : " (neaktivan)"))}</option>`).join("");
    }catch(error){
        alert(errorMessage(error, "Greška pri učitavanju kartice"));
    }
}

export async function loadCard(){
    const view = selectedView();
    try{
        const data = await api.card($("cardPartner").value, selectedTip(), $("cardFrom").value, $("cardTo").value, view);
        renderCard(data, view);
    }catch(error){
        alert(errorMessage(error, "Greška pri učitavanju kartice"));
    }
}

function renderCard(data, view){
    const rows = data?.rows || [];
    const total = formatMoney(data?.total);
    let head, body;

    if(view === "single"){
        head = `<tr><th>Datum</th><th>Tip</th><th>Naziv</th><th>Faktura</th><th>Iznos</th><th>Notes</th></tr>`;
        body = rows.length === 0 ? `<tr><td colspan="6">Nema podataka</td></tr>`
            : rows.map(t => `<tr><td>${formatDate(t.tx_date)}</td><td>${escapeHtml(TYPE_LABELS[t.type] || t.type)}</td><td>${escapeHtml(t.partner_name)}</td><td>${escapeHtml(t.invoice_number)}</td><td class="${t.type === "ulaz" ? "green" : "red"}">${formatMoney(t.amount)}</td><td>${escapeHtml(t.notes)}</td></tr>`).join("")
              + `<tr><td colspan="4"><strong>UKUPNO</strong></td><td><strong>${total} RSD</strong></td><td></td></tr>`;
    }else{
        head = `<tr><th>Period</th><th>Ukupan iznos</th></tr>`;
        body = rows.length === 0 ? `<tr><td colspan="2">Nema podataka</td></tr>`
            : rows.map(r => `<tr><td>${escapeHtml(r.period)}</td><td>${formatMoney(r.amount)} RSD</td></tr>`).join("")
              + `<tr><td><strong>UKUPNO</strong></td><td><strong>${total} RSD</strong></td></tr>`;
    }
    $("cardHead").innerHTML = head;
    $("cardTable").innerHTML = body;
}

export function buildCardDocumentHtml(){
    const table = $("cardModal").querySelector("table").outerHTML;
    const tip = TYPE_LABELS[selectedTip()] || "Sve";
    const select = $("cardPartner");
    const name = select.value ? select.options[select.selectedIndex].text : "Sve";
    return `<html><head><meta charset="UTF-8"><title>Kartica</title><style>body{font-family:Arial,sans-serif;padding:30px;color:#111}.header{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:15px;margin-bottom:25px}.logo{width:150px}h1{margin:0;font-size:26px}.info{margin-bottom:20px;font-size:14px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #999;padding:8px;text-align:left;font-size:13px}th{background:#f1f5f9}.green{color:#15803d}.red{color:#b91c1c}.footer{margin-top:40px;font-size:12px;color:#555;text-align:center}</style></head><body>`
        + `<div class="header"><div><h1>Kartica</h1><div>M&M Safety Accounting</div></div><img src="${LOGO_URL}" class="logo"></div>`
        + `<div class="info"><strong>Tip:</strong> ${escapeHtml(tip)}<br><strong>Naziv:</strong> ${escapeHtml(name)}<br><strong>Period:</strong> ${escapeHtml(formatDate($("cardFrom").value))} - ${escapeHtml(formatDate($("cardTo").value))}</div>`
        + `${table}<div class="footer">Dokument generisan iz M&M Safety Accounting aplikacije</div></body></html>`;
}

export function handleCardDocumentAction(action){
    const status = $("cardDocStatus");
    if(action === "save" || action === "both"){
        status.textContent = "Čuvanje PDF-a stiže u sledećem koraku (M4). Za sada koristite PRINT.";
        return;
    }
    status.textContent = "Otvaram dokument za štampu...";
    openPrintWindow(buildCardDocumentHtml());
}
