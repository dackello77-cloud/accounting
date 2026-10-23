// Pregled: transakcije za period (podrazumevano tekući mesec), STORNO.
import * as api from "./api.js";
import { escapeHtml, formatMoney, formatDate, currentMonthRange, errorMessage, showModal, hideModal, TYPE_LABELS } from "./util.js";
import { loadDashboard } from "./dashboard.js";

const $ = (id) => document.getElementById(id);

export function openReviewModal(){
    const { from, to } = currentMonthRange();
    $("reviewFrom").value = from;
    $("reviewTo").value = to;
    showModal("reviewModal");
    loadReview();
}

export function closeReviewModal(){ hideModal("reviewModal"); }

export async function loadReview(){
    const table = $("reviewTable");
    try{
        const rows = await api.listTransactions($("reviewFrom").value, $("reviewTo").value);
        table.innerHTML = rows.length === 0
            ? `<tr><td colspan="7">Nema transakcija za izabrani period</td></tr>`
            : rows.map(t => {
                const storno = t.status === "storno";
                return `<tr class="${storno ? "is-storno" : ""}"><td class="nowrap">${formatDate(t.tx_date)}</td><td><span class="badge b-${escapeHtml(t.type)}">${escapeHtml(TYPE_LABELS[t.type] || t.type)}</span></td><td>${escapeHtml(t.partner_name)}</td><td class="muted">${escapeHtml(t.invoice_number)}</td><td class="num ${t.type === "ulaz" ? "green" : "red"}">${formatMoney(t.amount)}</td><td><span class="status ${storno ? "storno" : "active"}">${storno ? "STORNO" : "ACTIVE"}</span></td><td><button class="row-btn danger" data-storno="${escapeHtml(t.id)}" ${storno ? "disabled" : ""}>STORNO</button></td></tr>`;
            }).join("");
    }catch(error){
        alert(errorMessage(error, "Greška pri učitavanju pregleda"));
    }
}

async function stornoTransaction(id){
    if(!confirm("Da li ste sigurni da želite da stornirate transakciju?")) return;
    try{
        await api.stornoTransaction(id);
        alert("Transakcija je stornirana");
        loadReview();
        loadDashboard();
    }catch(error){
        alert(errorMessage(error, "Greška pri storniranju"));
    }
}

export function initReview(){
    $("reviewTable").addEventListener("click", (event) => {
        const btn = event.target.closest("button[data-storno]");
        if(btn) stornoTransaction(btn.dataset.storno);
    });
}
