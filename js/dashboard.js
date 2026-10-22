// Dashboard: stanje, godišnji prikaz, poslednjih 20, podsetnici, tema, sat.
import * as api from "./api.js";
import { escapeHtml, formatMoney, formatDate, formatDateTime, TYPE_LABELS } from "./util.js";

const $ = (id) => document.getElementById(id);

export async function loadDashboard(){
    try{
        const data = await api.dashboardSummary(Number(new Date().toLocaleString("en-US", { timeZone: "Europe/Belgrade", year: "numeric" })));
        if(!data) return;
        $("stanje").textContent = formatMoney(data.stanje) + " RSD";
        $("ulaz").textContent = formatMoney(data.ulaz) + " RSD";
        $("izlaz").textContent = formatMoney(data.izlaz) + " RSD";

        const g = data.godina || {};
        const income = Number(g.ulaz || 0), tax = Number(g.porezi || 0), clients = Number(g.klijenti || 0), staff = Number(g.zaposleni || 0);
        $("godisnjiUlaz").textContent = formatMoney(income) + " RSD";
        $("godisnjiIzlaz").textContent = formatMoney(tax + clients + staff) + " RSD";
        updateYearChart(income, tax, clients, staff);

        const rows = data.poslednje || [];
        $("transactionsTable").innerHTML = rows.length === 0
            ? `<tr><td colspan="5">Nema transakcija</td></tr>`
            : rows.map(t => `<tr><td>${formatDate(t.tx_date)}</td><td>${escapeHtml(TYPE_LABELS[t.type] || t.type)}</td><td>${escapeHtml(t.partner_name)}</td><td>${escapeHtml(t.invoice_number)}</td><td class="${t.type === "ulaz" ? "green" : "red"}">${formatMoney(t.amount)}</td></tr>`).join("");
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

export async function loadReminderAlerts(){
    const box = $("sidebarReminderAlerts");
    if(!box) return;
    try{
        const reminders = await api.reminderAlerts();
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
    }catch(error){
        box.textContent = "Greška pri učitavanju.";
    }
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
    const tick = () => {
        const el = $("currentTimeBox");
        if(el) el.textContent = new Date().toLocaleTimeString("sr-RS", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Belgrade" });
    };
    tick();
    setInterval(tick, 30000);
}
