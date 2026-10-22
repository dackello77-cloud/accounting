// Ulaz aplikacije: prijava, trajna sesija, prijava preko otvorenih prozora, povezivanje ekrana.
import * as api from "./api.js";
import { loadDashboard, toggleTheme, initChrome } from "./dashboard.js";
import * as partners from "./partners.js";
import * as transaction from "./transaction.js";
import * as review from "./review.js";
import * as card from "./card.js";
import * as notes from "./notes.js";

const loginPage = document.getElementById("loginPage");
const loginForm = document.getElementById("loginForm");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");
const dashboard = document.getElementById("dashboard");

let appStarted = false;

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

// Funkcije koje pozivaju onclick/onchange atributi u index.html.
Object.assign(window, {
    logout: async () => { await api.signOut(); location.reload(); },
    loadDashboard,
    toggleTheme,
    openAddModal: partners.openAddModal,
    closeAddModal: partners.closeAddModal,
    handleAddTipChange: partners.handleAddTipChange,
    selectAddEntity: partners.selectAddEntity,
    saveEntity: partners.saveEntity,
    openTransactionModal: transaction.openTransactionModal,
    closeTransactionModal: transaction.closeTransactionModal,
    fillEntityData: transaction.fillEntityData,
    saveTransaction: transaction.saveTransaction,
    newTransactionAfterSave: transaction.newTransactionAfterSave,
    handleTransactionDocumentAction: transaction.handleTransactionDocumentAction,
    openReviewModal: review.openReviewModal,
    closeReviewModal: review.closeReviewModal,
    loadReview: review.loadReview,
    openCardModal: card.openCardModal,
    closeCardModal: card.closeCardModal,
    loadCardEntities: card.loadCardEntities,
    loadCard: card.loadCard,
    handleCardDocumentAction: card.handleCardDocumentAction,
    openNotesModal: notes.openNotesModal,
    closeNotesModal: notes.closeNotesModal,
    handleNoteTypeChange: notes.handleNoteTypeChange,
    resetNoteForm: notes.resetNoteForm,
    saveNote: notes.saveNote
});

// Ekrani koji se prenose u koraku M4; do tada samo poruka.
["openReceiptModal", "openDocumentsModal", "openObracunRModal", "openObracunKModal", "openInvoiceModal"].forEach(name => {
    window[name] = () => alert("Ovaj ekran se prenosi u sledećem koraku (M4).");
});

initChrome();
partners.initPartners();
transaction.initTransaction();
review.initReview();
notes.initNotes();

(async function init(){
    const session = await api.getSession();
    if(session && await api.isActiveUser()){
        startApp();
    }else{
        showLogin();
    }
})();
