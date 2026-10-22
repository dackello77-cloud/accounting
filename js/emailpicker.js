// Izbor primalaca mejla iz sačuvane liste + dodavanje novog (Obračun R, Obračun K, Faktura).
import * as api from "./api.js";
import { escapeHtml, errorMessage } from "./util.js";

export class EmailPicker {
    constructor({ selectId, chipsId, nameId, addressId }){
        this.select = document.getElementById(selectId);
        this.chips = document.getElementById(chipsId);
        this.name = document.getElementById(nameId);
        this.address = document.getElementById(addressId);
        this.list = [];
        this.selected = [];
        this.chips.addEventListener("click", (event) => {
            const btn = event.target.closest("button[data-remove]");
            if(!btn) return;
            this.selected.splice(Number(btn.dataset.remove), 1);
            this.render();
        });
    }

    async load(){
        this.select.innerHTML = '<option value="">Učitavam...</option>';
        try{
            this.list = await api.listEmailRecipients();
            this.select.innerHTML = '<option value="">Izaberite email</option>' + this.list.map((e, i) =>
                `<option value="${i}">${escapeHtml(e.name || "")} - ${escapeHtml(e.email)}</option>`).join("");
        }catch(error){
            this.select.innerHTML = '<option value="">Greška</option>';
        }
    }

    addSelected(){
        const item = this.list[Number(this.select.value)];
        if(this.select.value === "" || !item) return;
        this.addRecipient(item);
    }

    addRecipient(item){
        if(!this.selected.some(e => e.email.toLowerCase() === item.email.toLowerCase())) this.selected.push(item);
        this.render();
    }

    async addNew(){
        const name = this.name.value.trim();
        const email = this.address.value.trim();
        if(!name || !email){ alert("Unesite naziv i email adresu"); return; }
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ alert("Email adresa nije ispravna"); return; }
        try{
            const existing = this.list.find(e => e.email.toLowerCase() === email.toLowerCase());
            const item = existing || await api.addEmailRecipient(email, name);
            this.name.value = "";
            this.address.value = "";
            await this.load();
            this.addRecipient(item);
        }catch(error){
            alert(errorMessage(error, "Greška pri dodavanju emaila"));
        }
    }

    render(){
        this.chips.innerHTML = this.selected.map((e, i) =>
            `<div class="email-chip"><span>${escapeHtml(e.name || "")} - ${escapeHtml(e.email)}</span><button data-remove="${i}">×</button></div>`).join("");
    }

    emails(){ return this.selected.map(e => e.email); }
}
