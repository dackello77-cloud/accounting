// Obračun R / K: kompanija kojoj se šalje; njeni mejlovi su automatski primaoci, izbor se pamti po tipu.
import * as api from "./api.js";
import { escapeHtml, errorMessage } from "./util.js";

export class PayrollCompany {
    constructor(type, selectId, picker){
        this.type = type;
        this.select = document.getElementById(selectId);
        this.picker = picker;
        this.companies = [];
    }

    async load(){
        try{
            const [companies, saved] = await Promise.all([api.listInvoiceCompanies(), api.getPayrollCompany(this.type)]);
            this.companies = companies;
            this.select.innerHTML = '<option value="">Bez kompanije</option>' +
                companies.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("");
            this.select.value = companies.some(c => c.id === saved) ? saved : "";
            this.apply();
        }catch(error){
            console.error(error);
        }
    }

    apply(){
        const c = this.companies.find(x => x.id === this.select.value);
        this.picker.setAuto((c?.emails || []).map(email => ({ name: c.name, email })));
    }

    async change(){
        this.apply();
        try{
            await api.savePayrollCompany(this.type, this.select.value);
        }catch(error){
            alert(errorMessage(error, "Izbor kompanije nije sačuvan."));
        }
    }
}
