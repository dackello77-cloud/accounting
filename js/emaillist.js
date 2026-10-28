// Lista mejlova za unos (partner, primaoci obračuna): polje + DODAJ, mejlovi kao oznake sa ×.
import { escapeHtml } from "./util.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class EmailList {
    constructor(container){
        this.items = [];
        container.innerHTML = `<div class="email-list-chips"></div>
            <div class="email-list-add"><input type="email" autocapitalize="none" placeholder="ime@primer.com"><button type="button" class="row-btn">DODAJ</button></div>
            <div class="email-list-error"></div>`;
        this.chips = container.querySelector(".email-list-chips");
        this.input = container.querySelector("input");
        this.error = container.querySelector(".email-list-error");
        container.querySelector("button").addEventListener("click", () => this.addTyped());
        this.input.addEventListener("keydown", (event) => {
            if(event.key === "Enter"){ event.preventDefault(); this.addTyped(); }
        });
        this.chips.addEventListener("click", (event) => {
            const btn = event.target.closest("button[data-remove]");
            if(!btn) return;
            this.items.splice(Number(btn.dataset.remove), 1);
            this.render();
        });
    }

    addTyped(){
        const email = this.input.value.trim();
        this.error.textContent = "";
        if(!email) return true;
        if(!EMAIL.test(email)){ this.error.textContent = "Email adresa nije ispravna."; return false; }
        if(!this.items.some(e => e.toLowerCase() === email.toLowerCase())) this.items.push(email);
        this.input.value = "";
        this.render();
        return true;
    }

    set(list){
        this.items = [...(list || [])];
        this.input.value = "";
        this.error.textContent = "";
        this.render();
    }

    // Ukucan, a ne dodat mejl se dodaje pri čuvanju; null ako nije ispravan.
    get(){
        return this.addTyped() ? [...this.items] : null;
    }

    render(){
        this.chips.innerHTML = this.items.map((e, i) =>
            `<div class="email-chip"><span>${escapeHtml(e)}</span><button type="button" data-remove="${i}">×</button></div>`).join("");
    }
}
