// Faktura: broj konačan pri prvom čuvanju (save_invoice), ponovno čuvanje ažurira istu fakturu.
import * as api from "./api.js";
import { escapeHtml, formatMoney, formatDate, todayIso, openPrintWindow, errorMessage, showModal, hideModal, UserError } from "./util.js";
import { LOGO_URL } from "./logo.js";
import { invoiceFileName } from "./files.js";
import { savePdfDocument } from "./docsave.js";
import { EmailPicker } from "./emailpicker.js";

const $ = (id) => document.getElementById(id);
const BANK_ACCOUNTS = { RSD: "160-6000001770008-96", USD: "160-6000001770455-16" };

let companies = [];
let articles = [];
let invoiceId = null;      // posle prvog čuvanja
let proposedNumber = "";   // predlog iz next_invoice_number
let emails = null;
let saving = null;         // da SAVE PDF i SEND EMAIL ne krenu dvaput istovremeno

function currency(){ return document.querySelector('input[name="invoiceCurrency"]:checked')?.value || "RSD"; }
function selectedCompany(){ return companies.find(c => c.id === $("invoiceCompany").value) || null; }

export function openInvoiceModal(){
    showModal("invoiceModal");
    if(!emails){
        emails = new EmailPicker({ selectId: "invoiceEmailSelect", chipsId: "invoiceEmailChips", nameId: "invoiceNewEmailName", addressId: "invoiceNewEmailAddress" });
    }
    if(!$("invoiceIssueDate").value){
        $("invoiceIssueDate").value = todayIso();
        $("invoicePaymentDays").value = 0;
        $("invoicePlace").value = "Niš, Srbija";
        updateInvoiceDueDate();
    }
    if($("invoiceItemRows").children.length === 0) addInvoiceItem();
    loadInitialData();
    renderInvoicePreview();
}

export function closeInvoiceModal(){ hideModal("invoiceModal"); }

async function loadInitialData(){
    try{
        if(!invoiceId && !$("invoiceNumber").value){
            const year = Number(($("invoiceIssueDate").value || todayIso()).slice(0, 4));
            proposedNumber = await api.nextInvoiceNumber(year) || "";
            $("invoiceNumber").value = proposedNumber;
        }
        const selected = $("invoiceCompany").value;
        companies = await api.listInvoiceCompanies();
        $("invoiceCompany").innerHTML = '<option value="">Izaberite kupca</option>' +
            companies.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("");
        $("invoiceCompany").value = selected;
        $("invoiceCompany").searchSync?.();
        articles = await api.listArticles({ activeOnly: true });
        $("invoiceArticleList").innerHTML = articles.map(a => `<option value="${escapeHtml(a.name)}"></option>`).join("");
        emails.load();
    }catch(error){
        $("invoiceStatus").textContent = errorMessage(error, "Greška pri učitavanju podataka za fakturu.");
    }
    renderInvoicePreview();
}

// Nova faktura: prazan obrazac, novi predlog broja.
export function newInvoice(){
    invoiceId = null;
    proposedNumber = "";
    $("invoiceNumber").value = "";
    $("invoiceIssueDate").value = "";
    $("invoiceCompany").value = "";
    $("invoiceCompany").searchSync?.();
    $("invoiceAddress").value = "";
    $("invoiceZiro").value = "";
    $("invoiceItemRows").innerHTML = "";
    $("invoiceEmailMessage").value = "";
    $("invoiceStatus").textContent = "";
    document.querySelector('input[name="invoiceCurrency"][value="RSD"]').checked = true;
    openInvoiceModal();
}

export function fillInvoiceCompany(){
    const c = selectedCompany();
    $("invoiceAddress").value = c?.address || "";
    $("invoiceZiro").value = c?.bank_account || "";
    renderInvoicePreview();
}

export function addInvoiceItem(){
    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td><input type="text" class="invoice-service" list="invoiceArticleList" oninput="fillInvoiceArticle(this);renderInvoicePreview();"></td>
        <td><input type="number" class="invoice-qty" step="0.01" oninput="renderInvoicePreview();"></td>
        <td><input type="number" class="invoice-price" step="0.01" oninput="renderInvoicePreview();"></td>
        <td><input type="text" class="invoice-value" readonly></td>
        <td><button class="invoice-del" onclick="this.closest('tr').remove();renderInvoicePreview();">X</button></td>`;
    $("invoiceItemRows").appendChild(tr);
    renderInvoicePreview();
}

export function fillInvoiceArticle(input){
    const found = articles.find(a => a.name === input.value);
    if(found) input.closest("tr").querySelector(".invoice-price").value = found.price ?? "";
}

const round2 = (n) => Math.round(n * 100) / 100;

function getItems(){
    const items = [];
    document.querySelectorAll("#invoiceItemRows tr").forEach(row => {
        const service = row.querySelector(".invoice-service").value.trim();
        const qty = Number(row.querySelector(".invoice-qty").value || 0);
        const price = Number(row.querySelector(".invoice-price").value || 0);
        if(service || qty || price) items.push({ service, qty, price, value: round2(qty * price) });
    });
    return items;
}

function calculateTotals(){
    let total = 0;
    document.querySelectorAll("#invoiceItemRows tr").forEach(row => {
        const value = round2(Number(row.querySelector(".invoice-qty").value || 0) * Number(row.querySelector(".invoice-price").value || 0));
        row.querySelector(".invoice-value").value = formatMoney(value);
        total += value;
    });
    $("invoiceTotalText").textContent = formatMoney(total) + " " + currency();
}

export function updateInvoiceDueDate(){
    const issue = $("invoiceIssueDate").value;
    const days = Number($("invoicePaymentDays").value || 0);
    if(issue){
        const d = new Date(issue + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + days);
        $("invoiceDueDate").value = d.toISOString().slice(0, 10);
    }
    renderInvoicePreview();
}

function buildInvoiceHtml(){
    const invoiceNumber = $("invoiceNumber").value || "";
    const place = $("invoicePlace").value || "Niš, Srbija";
    const cur = currency();
    const company = selectedCompany();
    const companyName = company?.name || "";
    const address = $("invoiceAddress").value || "";
    const ziro = $("invoiceZiro").value || "";
    const taxId = company?.tax_id || "";
    const items = getItems();
    let total = 0;

    let rows = items.map((item, i) => {
        total += item.value;
        const bg = i % 2 === 0 ? "#ffffff" : "#eef2f7";
        return `<tr><td style="background:${bg};">${escapeHtml(item.service)}</td><td class="right" style="background:${bg};">${formatMoney(item.qty)}</td><td class="right" style="background:${bg};">${formatMoney(item.price)}</td><td class="right" style="background:${bg};">${formatMoney(item.value)}</td></tr>`;
    }).join("");
    if(!rows) rows = `<tr><td style="background:#ffffff;">&nbsp;</td><td class="right" style="background:#ffffff;">0,00</td><td class="right" style="background:#ffffff;">0,00</td><td class="right" style="background:#ffffff;">0,00</td></tr>`;

    return `<html>
<head>
<meta charset="UTF-8">
<title>Faktura ${escapeHtml(invoiceNumber)}</title>
<style>
@page{size:A4;margin:12mm}
*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
html,body{margin:0;padding:0;background:white;color:#111;font-family:Arial,sans-serif}
body{font-size:12px;line-height:1.32}
.invoice-wrap{width:100%;max-width:720px;margin:0 auto;padding:0}
.header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #073b44;padding-bottom:12px;margin-bottom:18px}
.header img{width:140px;max-height:70px;object-fit:contain}
.company-info{text-align:right;line-height:1.35;font-size:11px;color:#111827}
.company-info strong{font-size:15px;line-height:20px}
.invoice-title{text-align:right;margin-bottom:18px}
.invoice-title h2{margin:0;font-size:24px;line-height:30px;color:#111827;letter-spacing:.2px}
.invoice-title div{display:inline-block;background:#073b44;color:white;padding:7px 18px;margin-top:6px;font-weight:bold;border-radius:2px}
.client-row{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start;margin-bottom:18px}
.client-box{background:#eef2f7;border:1px solid #374151;padding:14px;min-height:92px;line-height:1.4}
.client-box strong{font-size:13px;line-height:18px;color:#111827}
.details{border:1px solid #374151;padding:14px;line-height:1.55;font-size:12px;background:#ffffff}
.en,.small-muted{color:#4b5563;font-style:italic;font-weight:500}
table{width:100%;border-collapse:collapse;margin-top:0;border:1px solid #111827}
th{background:#073b44!important;color:#ffffff!important;border:1px solid #111827;padding:8px;text-align:left;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.15px}
th .en{color:#e5e7eb!important;font-style:italic;font-weight:700}
td{border:1px solid #374151;padding:8px;font-size:11px;vertical-align:top;color:#111}
.right{text-align:right}
.total-row td{background:#ffffff!important;color:#111!important;font-weight:900}
.summary{margin-top:18px;background:#eef2f7;color:#111;font-weight:900;font-size:13px;line-height:18px;padding:10px 12px;border-radius:0;display:flex;justify-content:space-between;border:1px solid #374151}
.bank{margin-top:18px;color:#111;line-height:1.4;font-size:11px;border:1px solid #374151;background:#eef2f7;padding:10px}
.footer{margin-top:18px;background:#eef2f7;border:1px solid #374151;color:#111;font-size:11px;line-height:1.35;padding:10px}
.responsible{margin-top:18px;font-size:11px;line-height:1.35;border-top:2px solid #073b44;padding-top:10px}
@media print{.invoice-wrap{page-break-inside:avoid}}
</style>
</head>
<body>
<div class="invoice-wrap">
    <div class="header">
        <img src="${LOGO_URL}" alt="Logo">
        <div class="company-info"><strong>M&M SAFETY DOO</strong><br>Majakovskog 34, 18000 Niš<br>Poreski br.: 113867473, Matični broj: 21937843<br>tel: +381 62 279 220, email: mmsafetydoo@gmail.com</div>
    </div>
    <div class="invoice-title">
        <h2>FAKTURA / <span class="en">INVOICE</span></h2>
        <div>${escapeHtml(invoiceNumber)}</div>
    </div>
    <div class="client-row">
        <div class="client-box"><strong>Kupac / <span class="en">Customer</span></strong><br><br><strong>${escapeHtml(companyName)}</strong><br>${escapeHtml(address).replace(/\n/g, "<br>")}<br>${taxId ? "PIB / <span class=\"en\">Tax ID</span>: " + escapeHtml(taxId) + "<br>" : ""}${ziro ? "Account: " + escapeHtml(ziro) : ""}</div>
        <div class="details">
            <strong>Broj računa / <span class="en">Invoice number:</span> ${escapeHtml(invoiceNumber)}</strong><br>
            <strong>Datum izdavanja / <span class="en">Issue date:</span> ${escapeHtml(formatDate($("invoiceIssueDate").value))}</strong><br>
            <strong>Datum plaćanja / <span class="en">Due date:</span> ${escapeHtml(formatDate($("invoiceDueDate").value))}</strong><br>
            <strong>Mesto izdavanja računa / <span class="en">Place of billing:</span> ${escapeHtml(place)}</strong>
        </div>
    </div>
    <table>
        <thead><tr><th>Vrsta usluge / <span class="en">Type of service</span></th><th class="right">Količina / <span class="en">Qty</span></th><th class="right">Cena / <span class="en">Price</span></th><th class="right">Vrednost / <span class="en">Total</span></th></tr></thead>
        <tbody>${rows}<tr class="total-row"><td colspan="3" class="right">Ukupno / <span class="en">Total:</span></td><td class="right">${formatMoney(total)}</td></tr></tbody>
    </table>
    <div class="summary"><span>Ukupno u ${cur} / <span class="en">Total in ${cur}</span></span><span>${formatMoney(total)}</span></div>
    <div class="bank">Banka / <span class="en">Bank:</span> Banca Intesa<br>Broj Računa / <span class="en">Account number:</span> ${BANK_ACCOUNTS.RSD} RSD<br>${BANK_ACCOUNTS.USD} USD</div>
    <div class="footer">Dokument je izdan elektronskim putem, te je valjan bez pečata i potpisa. /<br><span class="en">The document was issued electronically and is valid without a seal or signature.</span></div>
    <div class="responsible"><strong>Podaci o odgovornom licu / <span class="en">Data about the responsible person</span></strong><br>Dalibor Spasic<br>Milenka Hadzica 015</div>
</div>
</body>
</html>`;
}

export function renderInvoicePreview(){
    calculateTotals();
    const preview = $("invoicePreview");
    if(!preview) return;
    let iframe = preview.querySelector("iframe");
    if(!iframe){
        preview.innerHTML = `<iframe title="Invoice preview" style="width:100%;height:760px;border:0;background:white;border-radius:12px;" sandbox="allow-same-origin"></iframe>`;
        iframe = preview.querySelector("iframe");
    }
    iframe.srcdoc = buildInvoiceHtml();
}

export function printInvoice(){ openPrintWindow(buildInvoiceHtml()); }

async function persistInvoice(){
    const company = selectedCompany();
    if(!company) throw new UserError("Izaberite kupca.");
    if(!$("invoiceIssueDate").value) throw new UserError("Unesite datum izdavanja.");
    const items = getItems();
    if(!items.length) throw new UserError("Dodajte bar jednu stavku.");

    const typed = $("invoiceNumber").value.trim();
    if(typed && !/^\d+\/\d{4}$/.test(typed)) throw new UserError("Broj fakture mora biti u obliku 001/2026.");
    // Nova faktura sa nepromenjenim predlogom: broj dodeljuje baza (bez duplikata).
    const number = !invoiceId && typed === proposedNumber ? null : (typed || null);
    const cur = currency();

    const result = await api.saveInvoice({
        id: invoiceId || crypto.randomUUID(),
        number,
        issue_date: $("invoiceIssueDate").value,
        payment_days: Number($("invoicePaymentDays").value || 0),
        due_date: $("invoiceDueDate").value || null,
        place: $("invoicePlace").value,
        currency: cur,
        bank_account: BANK_ACCOUNTS[cur],
        partner_id: company.id,
        company_name: company.name,
        company_address: $("invoiceAddress").value,
        company_bank_account: $("invoiceZiro").value,
        company_tax_id: company.tax_id || null
    }, items.map(i => ({ service: i.service, qty: i.qty, price: i.price })));

    invoiceId = result.id;
    $("invoiceNumber").value = result.number;
    renderInvoicePreview();

    const doc = await savePdfDocument({ html: buildInvoiceHtml(), category: "fakture", fileName: invoiceFileName(result.number), margin: 12 });
    await api.setInvoicePdf(invoiceId, doc.path);
    return { ...doc, id: invoiceId, number: result.number };
}

async function persistOnce(){
    if(!saving) saving = persistInvoice().finally(() => { saving = null; });
    return saving;
}

export async function saveInvoicePdfOnly(){
    const status = $("invoiceStatus");
    status.textContent = "Čuvam fakturu...";
    try{
        const doc = await persistOnce();
        status.textContent = "Faktura je sačuvana: " + doc.fileName;
    }catch(error){
        status.textContent = errorMessage(error, "Greška pri čuvanju fakture.");
    }
}

export function toggleInvoiceEmailBox(){
    const box = $("invoiceEmailBox");
    box.style.display = box.style.display === "block" ? "none" : "block";
    if(box.style.display === "block") emails.load();
}

function buildEmailHtml(){
    const message = $("invoiceEmailMessage").value || "";
    const invoiceNumber = $("invoiceNumber").value || "";
    const total = $("invoiceTotalText").textContent || "";
    const company = selectedCompany()?.name || "";
    return `<div style="background:#eaf7ff;padding:28px;font-family:Arial,sans-serif;color:#0f172a;"><div style="max-width:680px;margin:0 auto;background:white;border-radius:22px;overflow:hidden;border:1px solid #d7e8f5;"><div style="padding:24px;border-bottom:3px solid #073b44;"><img src="cid:mmlogo" alt="M&M Safety" style="width:150px;height:auto;display:block;"><div style="margin-top:12px;font-size:20px;font-weight:800;">Faktura / Invoice ${escapeHtml(invoiceNumber)}</div><div style="margin-top:6px;color:#64748b;">Kupac: ${escapeHtml(company)}</div></div><div style="padding:24px;"><div style="background:#073b44;color:white;border-radius:14px;padding:18px;font-size:18px;font-weight:800;">Ukupno: ${escapeHtml(total)}</div>${message ? `<div style="margin-top:18px;background:#f8fafc;border-radius:14px;padding:16px;line-height:1.5;">${escapeHtml(message).replace(/\n/g, "<br>")}</div>` : ""}<p style="margin-top:22px;color:#475569;">PDF faktura je u prilogu.</p></div></div></div>`;
}

export async function sendInvoiceEmail(){
    const status = $("invoiceStatus");
    if(emails.selected.length === 0){ alert("Dodajte primaoca"); return; }
    status.textContent = "Čuvam i šaljem fakturu...";
    try{
        const doc = await persistOnce();
        const result = await api.sendEmail({
            to: emails.emails(),
            subject: `Invoice ${doc.number} – M&M SAFETY DOO`,
            html: buildEmailHtml(),
            attachments: [{ bucket: doc.bucket, path: doc.path, filename: doc.fileName }],
            kind: "faktura",
            record_id: doc.id
        });
        status.textContent = result.test ? "TEST: email je poslat samo na " + result.sent_to.join(", ") + "." : "Email je poslat.";
    }catch(error){
        status.textContent = errorMessage(error, "Greška pri slanju emaila.");
    }
}

export const emailActions = {
    addSelectedInvoiceEmail: () => emails.addSelected(),
    addNewInvoiceEmail: () => emails.addNew(),
    loadInvoiceEmails: () => emails.load()
};
