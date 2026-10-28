// Prenos između banaka: transakcija tipa 'prenos' (sa banke → na banku); ne ulazi u ulaz/izlaz.
import * as api from "./api.js";
import { escapeHtml, parseAmount, todayIso, bindAmountInput, errorMessage, showModal, hideModal } from "./util.js";
import { loadDashboard } from "./dashboard.js";
import { saveTransactionPdf } from "./transaction.js";

const $ = (id) => document.getElementById(id);
let banks = [];
let saving = false;

export async function openTransferModal(){
    $("transferAmount").value = "";
    $("transferNotes").value = "";
    $("transferDate").value = todayIso();
    $("transferStatus").textContent = "";
    $("transferSaveBtn").disabled = false;
    showModal("transferModal");
    try{
        banks = await api.listBanks({ activeOnly: true });
        const options = banks.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join("");
        $("transferFrom").innerHTML = options;
        $("transferTo").innerHTML = options;
        // Najčešće: sa podrazumevane (Intesa) na drugu banku.
        const from = banks.find(b => b.is_default) || banks[0];
        $("transferFrom").value = from?.id || "";
        $("transferTo").value = banks.find(b => b.id !== from?.id)?.id || "";
    }catch(error){
        $("transferStatus").textContent = errorMessage(error, "Greška pri učitavanju banaka.");
    }
}

export function closeTransferModal(){ hideModal("transferModal"); }

export async function saveTransfer(){
    if(saving) return;
    const from = banks.find(b => b.id === $("transferFrom").value);
    const to = banks.find(b => b.id === $("transferTo").value);
    const amount = parseAmount($("transferAmount").value);
    const status = $("transferStatus");
    if(!from || !to){ status.textContent = "Izaberite obe banke."; return; }
    if(from.id === to.id){ status.textContent = "Banke moraju biti različite."; return; }
    if(amount === null || amount <= 0){ status.textContent = "Unesite ispravan iznos."; return; }
    if(!$("transferDate").value){ status.textContent = "Unesite datum."; return; }

    saving = true;
    $("transferSaveBtn").disabled = true;
    status.textContent = "Čuvam prenos...";
    let t;
    try{
        t = await api.addTransaction({
            tx_date: $("transferDate").value,
            type: "prenos",
            partner_name: `${from.name} → ${to.name}`,
            amount,
            bank_id: from.id,
            to_bank_id: to.id,
            notes: $("transferNotes").value.trim() || null
        });
    }catch(error){
        status.textContent = errorMessage(error, "Greška pri čuvanju prenosa.");
        $("transferSaveBtn").disabled = false;
        return;
    }finally{
        saving = false;
    }
    loadDashboard();
    // PDF kao potvrda prenosa, u Dokumenti → Transakcije.
    status.textContent = "Prenos je sačuvan. Čuvam PDF u Dokumenti → Transakcije...";
    try{
        const doc = await saveTransactionPdf(t, banks);
        status.textContent = "Prenos i PDF su sačuvani (Dokumenti → Transakcije: " + doc.fileName + ").";
    }catch(error){
        status.textContent = errorMessage(error, "PDF nije sačuvan.") + " Prenos je sačuvan.";
        return;
    }
    setTimeout(closeTransferModal, 1500);
}

export function initTransfer(){
    bindAmountInput($("transferAmount"));
}
