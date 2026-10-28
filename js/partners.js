// Dodaj / Uredi: partneri po grupama, artikli i banke; deaktivacija umesto brisanja.
import * as api from "./api.js";
import { escapeHtml, formatMoney, parseAmount, errorMessage, showModal, hideModal } from "./util.js";

const $ = (id) => document.getElementById(id);
let items = [];
let banks = [];

function selectedTip(){
    return document.querySelector('input[name="addTip"]:checked')?.value || "";
}

export function openAddModal(){ resetAddModal(); showModal("addModal"); loadBanks(); }

// Izbor prioritetne banke partnera; prazno = podrazumevana banka.
async function loadBanks(){
    try{
        banks = await api.listBanks();
        const def = banks.find(b => b.is_default);
        const current = $("addBank").value;
        $("addBank").innerHTML = `<option value="">Podrazumevana${def ? " (" + escapeHtml(def.name) + ")" : ""}</option>` +
            banks.filter(b => b.active || b.id === current).map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join("");
        $("addBank").value = current;
    }catch(error){
        $("addStatus").textContent = errorMessage(error, "Greška pri učitavanju banaka.");
    }
}
export function closeAddModal(){ resetAddModal(); hideModal("addModal"); }

function resetAddModal(){
    document.querySelectorAll('input[name="addTip"]').forEach(el => el.checked = false);
    items = [];
    $("addShowInactive").checked = false;
    $("addExistingEntity").innerHTML = '<option value="">Izaberite tip za uređivanje ili ostavite za novi unos</option>';
    clearFields();
    handleAddTipChange();
}

function clearFields(){
    ["addIme", "addAdresa", "addZiro", "addTaxId", "addRegNo", "addEmail", "addBankRsd", "addBankUsd"].forEach(id => $(id).value = "");
    $("addBank").value = "";
    $("addCountry").value = "RS";
    $("addActive").checked = true;
    $("addCode").textContent = "";
    $("addStatus").textContent = "";
    updateCountryFields();
}

function updateCountryFields(){
    const rs = ($("addCountry").value.trim().toUpperCase() || "RS") === "RS";
    $("addTaxIdLabel").textContent = rs ? "PIB" : "Poreski broj (EIN…)";
    $("addRegNoGroup").style.display = rs ? "block" : "none";
}

export function handleAddTipChange(){
    const isArticle = selectedTip() === "artikli";
    const isBank = selectedTip() === "banke";
    $("addAdresaLabel").textContent = isArticle ? "Cena" : "Adresa";
    $("addAdresa").placeholder = isArticle ? "Unesite cenu artikla" : "";
    $("addAdresa").inputMode = isArticle ? "decimal" : "text";
    $("addAdresaGroup").style.display = isBank ? "none" : "block";
    $("addPartnerFields").style.display = isArticle || isBank ? "none" : "block";
    $("addBankFields").style.display = isBank ? "block" : "none";
    clearFields();
    loadAddEntities();
}

// Neaktivni samo uz „Prikaži neaktivne“ (npr. da se ponovo aktiviraju).
export async function loadAddEntities(){
    const tip = selectedTip();
    const select = $("addExistingEntity");
    items = [];
    if(!tip){
        select.innerHTML = '<option value="">Izaberite tip za uređivanje ili ostavite za novi unos</option>';
        return;
    }
    select.innerHTML = '<option value="">Novi unos</option>';
    try{
        const activeOnly = !$("addShowInactive").checked;
        items = tip === "artikli" ? await api.listArticles({ activeOnly })
            : tip === "banke" ? await api.listBanks({ activeOnly })
            : await api.listPartners(tip, { activeOnly });
        select.innerHTML = '<option value="">Novi unos</option>' + items.map((item, i) => {
            const label = (item.code && tip !== "banke" ? item.code + " · " : "") + item.name + (item.active ? "" : " (neaktivan)");
            return `<option value="${i}">${escapeHtml(label)}</option>`;
        }).join("");
    }catch(error){
        $("addStatus").textContent = errorMessage(error, "Greška pri učitavanju liste.");
    }
}

export function selectAddEntity(){
    const index = $("addExistingEntity").value;
    const item = index === "" ? null : items[Number(index)];
    clearFields();
    if(!item) return;

    $("addIme").value = item.name || "";
    $("addActive").checked = item.active !== false;
    if(selectedTip() === "artikli"){
        $("addAdresa").value = formatMoney(item.price);
        return;
    }
    if(selectedTip() === "banke"){
        $("addBankRsd").value = item.account_rsd || "";
        $("addBankUsd").value = item.account_usd || "";
        return;
    }
    $("addCode").textContent = "Šifra partnera: " + item.code;
    $("addAdresa").value = item.address || "";
    $("addZiro").value = item.bank_account || "";
    $("addCountry").value = item.country || "RS";
    $("addTaxId").value = item.tax_id || "";
    $("addRegNo").value = item.registration_no || "";
    $("addEmail").value = item.email || "";
    $("addBank").value = item.bank_id || "";
    updateCountryFields();
}

export async function saveEntity(){
    const tip = selectedTip();
    const name = $("addIme").value.trim();
    if(tip === ""){ alert("Izaberite tip"); return; }
    if(name === ""){ alert("Unesite naziv"); return; }

    const index = $("addExistingEntity").value;
    const existing = index === "" ? null : items[Number(index)];
    let fields;

    if(tip === "artikli"){
        const price = parseAmount($("addAdresa").value);
        if(price === null){ alert("Unesite ispravnu cenu (npr. 1.234,56)"); return; }
        fields = { name, price, active: $("addActive").checked };
    }else if(tip === "banke"){
        fields = {
            name,
            account_rsd: $("addBankRsd").value.trim() || null,
            account_usd: $("addBankUsd").value.trim() || null,
            active: $("addActive").checked
        };
        if(existing?.is_default && !fields.active){ alert("Podrazumevana banka ne može biti neaktivna."); return; }
        // Šifra nove banke: slova iz naziva + nasumičan nastavak (jedinstvena).
        if(!existing) fields.code = (name.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "").slice(0, 12) || "banka")
            + Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 4);
    }else{
        const country = ($("addCountry").value.trim().toUpperCase() || "RS");
        fields = {
            group_type: tip,
            name,
            address: $("addAdresa").value.trim() || null,
            bank_account: $("addZiro").value.trim() || null,
            country,
            tax_id: $("addTaxId").value.trim() || null,
            registration_no: country === "RS" ? ($("addRegNo").value.trim() || null) : null,
            email: $("addEmail").value.trim() || null,
            bank_id: $("addBank").value || null,
            active: $("addActive").checked
        };
        if(country === "RS" && fields.tax_id && !/^\d{9}$/.test(fields.tax_id)){ alert("PIB mora imati 9 cifara."); return; }
        if(fields.registration_no && !/^\d{8}$/.test(fields.registration_no)){ alert("Matični broj mora imati 8 cifara."); return; }
    }

    const btn = $("addSaveBtn");
    btn.disabled = true;
    try{
        if(tip === "artikli") await api.saveArticle(existing?.id, fields);
        else if(tip === "banke") await api.saveBank(existing?.id, fields);
        else await api.savePartner(existing?.id, fields);
        alert(existing ? "Uspešno izmenjeno" : "Uspešno sačuvano");
        closeAddModal();
    }catch(error){
        $("addStatus").textContent = errorMessage(error, "Greška pri čuvanju.");
    }finally{
        btn.disabled = false;
    }
}

export function initPartners(){
    $("addCountry").addEventListener("input", updateCountryFields);
}
