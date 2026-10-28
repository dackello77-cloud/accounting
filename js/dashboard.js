// Dashboard: stanje, godišnji prikaz, poslednjih 20, podsetnici, tema, sat.
import * as api from "./api.js";
import { escapeHtml, formatMoney, formatDate, formatDateTime, TYPE_LABELS } from "./util.js";

const $ = (id) => document.getElementById(id);
// Godina u Godišnjem prikazu; null = tekuća.
let selectedYear = null;
let yearsFilled = false;

const currentYear = () => Number(new Date().toLocaleString("en-US", { timeZone: "Europe/Belgrade", year: "numeric" }));

// Godine od prve transakcije do tekuće, najnovija prva.
async function fillYearSelect(){
    yearsFilled = true;
    const select = $("yearSelect");
    const now = currentYear();
    let first = now - 1;
    try{
        const date = await api.firstTransactionDate();
        if(date) first = Math.min(Number(date.slice(0, 4)), now);
    }catch(error){
        console.error(error);
    }
    select.innerHTML = Array.from({ length: now - first + 1 }, (_, i) => now - i)
        .map(y => `<option value="${y}">${y}</option>`).join("");
    select.value = String(selectedYear || now);
}

export async function changeDashboardYear(value){
    selectedYear = Number(value) || null;
    try{
        const data = await api.dashboardSummary(selectedYear || currentYear());
        if(data) showYear(data.godina || {});
    }catch(error){
        console.error(error);
        alert("Greška pri učitavanju godišnjeg prikaza");
    }
}

function showYear(g){
    const income = Number(g.ulaz || 0), tax = Number(g.porezi || 0), clients = Number(g.klijenti || 0), staff = Number(g.zaposleni || 0);
    $("godisnjiUlaz").textContent = formatMoney(income) + " RSD";
    $("godisnjiIzlaz").textContent = formatMoney(tax + clients + staff) + " RSD";
    updateYearChart(income, tax, clients, staff);
}

export async function loadDashboard(){
    try{
        if(!yearsFilled) fillYearSelect();
        const data = await api.dashboardSummary(selectedYear || currentYear());
        if(!data) return;
        $("stanje").textContent = formatMoney(data.stanje) + " RSD";
        $("stanjeBanke").innerHTML = (data.banke || []).map(b =>
            `<span>${escapeHtml(b.name)}<strong>${formatMoney(b.stanje)}</strong></span>`).join("");
        $("ulaz").textContent = formatMoney(data.ulaz) + " RSD";
        $("izlaz").textContent = formatMoney(data.izlaz) + " RSD";

        showYear(data.godina || {});

        const rows = data.poslednje || [];
        $("transactionsTable").innerHTML = rows.length === 0
            ? `<tr><td colspan="5" class="empty">Nema transakcija</td></tr>`
            : rows.map(t => `<tr>
                <td class="muted nowrap">${formatDate(t.tx_date)}</td>
                <td><span class="badge b-${escapeHtml(t.type)}">${escapeHtml(TYPE_LABELS[t.type] || t.type)}</span></td>
                <td class="strong">${escapeHtml(t.partner_name)}</td>
                <td class="muted">${escapeHtml(t.invoice_number)}</td>
                <td class="num ${t.type === "ulaz" ? "pos" : t.type === "prenos" ? "muted" : "neg"}">${Number(t.amount) === 0 || t.type === "prenos" ? "" : t.type === "ulaz" ? "+" : "−"}${formatMoney(t.amount)}</td>
            </tr>`).join("");
    }catch(error){
        console.error(error);
        alert("Greška pri učitavanju podataka");
    }
    loadReminderAlerts();
}

function updateYearChart(income, tax, clients, staff){
    const max = Math.max(income, tax, clients, staff, 1);
    const bars = [["yearChartIncome", income], ["yearChartTax", tax], ["yearChartClient", clients], ["yearChartStaff", staff]];
    bars.forEach(([id, value]) => {
        $(id + "Val").textContent = formatMoney(value) + " RSD";
        $(id).style.width = `${Math.round((value / max) * 100)}%`;
    });
}

// Podsetnici idu u meni (telefon) i u desnu kolonu Dashboard-a.
export async function loadReminderAlerts(){
    const boxes = ["sidebarReminderAlerts", "sideReminderAlerts"].map($).filter(Boolean);
    if(!boxes.length) return;
    loadPendingReceipts();
    try{
        const reminders = await api.reminderAlerts();
        boxes.forEach(box => fillReminders(box, reminders));
    }catch(error){
        boxes.forEach(box => { box.textContent = "Greška pri učitavanju."; });
    }
}

async function loadPendingReceipts(){
    const el = $("pendingReceipts");
    if(!el) return;
    try{ el.textContent = (await api.listInboxReceipts()).length; }catch{ el.textContent = "–"; }
}

function fillReminders(box, reminders){
    if(!reminders.length){
        box.className = "reminder-empty";
        box.textContent = "Nema podsetnika za 24h.";
        return;
    }
    box.className = "";
    box.innerHTML = reminders.map(r => `
        <div class="reminder-alert-item" onclick="openNotesModal()">
            <strong>${escapeHtml(r.title || "Podsetnik")}</strong>
            <span>${escapeHtml(formatDateTime(r.remind_at))}</span>
            <div>${escapeHtml((r.body || "").slice(0, 80))}</div>
        </div>
    `).join("");
}

function applyTheme(theme){
    const isLight = theme === "light";
    document.body.classList.toggle("light-theme", isLight);
    const btn = $("themeToggleBtn");
    if(btn) btn.textContent = isLight ? "🌙" : "☀";
}

function readTheme(){
    try{ return localStorage.getItem("theme") || "dark"; }catch{ return "dark"; }
}

export function toggleTheme(){
    const next = readTheme() === "light" ? "dark" : "light";
    try{ localStorage.setItem("theme", next); }catch{}
    applyTheme(next);
}

export function initChrome(){
    applyTheme(readTheme());
    const today = $("todayLabel");
    if(today){
        const label = new Date().toLocaleDateString("sr-Latn-RS", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Belgrade" });
        today.textContent = label.charAt(0).toUpperCase() + label.slice(1);
    }
    const tick = () => {
        const el = $("currentTimeBox");
        if(el) el.textContent = new Date().toLocaleTimeString("sr-RS", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Belgrade" });
    };
    tick();
    setInterval(tick, 30000);
}
