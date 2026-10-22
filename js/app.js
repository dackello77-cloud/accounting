// Ulaz aplikacije: prijava, trajna sesija, prijava preko otvorenih prozora.
import * as api from "./api.js";

const loginPage = document.getElementById("loginPage");
const loginForm = document.getElementById("loginForm");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");
const dashboard = document.getElementById("dashboard");

let appStarted = false;

const moneyFormat = new Intl.NumberFormat("sr-Latn-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function formatMoney(value){
    const num = Number(value);
    return moneyFormat.format(Number.isFinite(num) ? num : 0);
}

// Prijava se prikazuje preko aplikacije; otvoreni prozori i uneti podaci ostaju ispod.
function showLogin(){
    loginError.textContent = "";
    loginBtn.disabled = false;
    loginPage.hidden = false;
    document.getElementById(document.getElementById("username").value ? "password" : "username").focus();
}

function hideLogin(){
    loginPage.hidden = true;
    document.getElementById("password").value = "";
}

function startApp(){
    hideLogin();
    if(appStarted) return;
    appStarted = true;
    dashboard.style.display = "block";
    loadDashboard();
}

async function loadDashboard(){
    try{
        const data = await api.dashboardSummary(new Date().getFullYear());
        if(!data) return;
        document.getElementById("stanje").textContent = formatMoney(data.stanje) + " RSD";
        document.getElementById("ulaz").textContent = formatMoney(data.ulaz) + " RSD";
        document.getElementById("izlaz").textContent = formatMoney(data.izlaz) + " RSD";
        const g = data.godina || {};
        document.getElementById("godisnjiUlaz").textContent = formatMoney(g.ulaz) + " RSD";
        document.getElementById("godisnjiIzlaz").textContent =
            formatMoney(Number(g.porezi || 0) + Number(g.klijenti || 0) + Number(g.zaposleni || 0)) + " RSD";
    }catch(error){
        console.error(error);
    }
}

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.textContent = "";
    loginBtn.disabled = true;
    try{
        await api.signIn(document.getElementById("username").value, document.getElementById("password").value);
        startApp();
    }catch(error){
        loginError.textContent = error.message || "Prijava nije uspela.";
        loginBtn.disabled = false;
    }
});

api.setAuthRequiredHandler(showLogin);
api.onAuthChange((event) => {
    if(event === "SIGNED_OUT" && appStarted) showLogin();
});

window.logout = async function(){
    await api.signOut();
    location.reload();
};
window.loadDashboard = loadDashboard;

// Ekrani iz 1.x koji se prenose u koraku M3/M4; do tada samo poruka.
[
    "openAddModal", "openTransactionModal", "openCardModal", "openReviewModal", "openReceiptModal",
    "openDocumentsModal", "openNotesModal", "openObracunRModal", "openObracunKModal", "openInvoiceModal",
    "toggleTheme"
].forEach(name => {
    if(!window[name]) window[name] = () => alert("Ovaj ekran se prenosi u sledećem koraku.");
});

(async function init(){
    const session = await api.getSession();
    if(session && await api.isActiveUser()){
        startApp();
    }else{
        showLogin();
    }
})();
