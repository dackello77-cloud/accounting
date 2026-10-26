// Ulaz aplikacije: prijava, trajna sesija, prijava preko otvorenih prozora, povezivanje ekrana.
import * as api from "./api.js";
import { loadDashboard, toggleTheme, initChrome } from "./dashboard.js";
import * as partners from "./partners.js";
import * as transaction from "./transaction.js";
import * as review from "./review.js";
import * as card from "./card.js";
import * as notes from "./notes.js";
import * as receipts from "./receipts.js";
import * as documents from "./documents.js";
import * as obracunR from "./obracun_r.js";
import * as obracunK from "./obracun_k.js";
import * as invoice from "./invoice.js";
import { initViewer } from "./viewer.js";
import { makeSearchable } from "./searchselect.js";

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
    reloadAddEntities: partners.loadAddEntities,
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
    saveNote: notes.saveNote,
    openReceiptModal: receipts.openReceiptModal,
    closeReceiptModal: receipts.closeReceiptModal,
    chooseReceiptFile: receipts.chooseReceiptFile,
    handleReceiptFileFallback: receipts.handleReceiptFileFallback,
    saveReceipt: receipts.saveReceipt,
    loadTransactionReceipts: receipts.loadTransactionReceipts,
    selectTransactionReceipt: receipts.selectTransactionReceipt,
    openDocumentsModal: documents.openDocumentsModal,
    closeDocumentsModal: documents.closeDocumentsModal,
    uploadStatement: documents.uploadStatement,
    openObracunRModal: obracunR.openObracunRModal,
    closeObracunRModal: obracunR.closeObracunRModal,
    renderObracunR: obracunR.renderObracunR,
    addObracunRow: obracunR.addObracunRow,
    deleteObracunRow: obracunR.deleteObracunRow,
    updateObracunRow: obracunR.updateObracunRow,
    loadObracunEmployees: obracunR.loadObracunEmployees,
    applyDefaultSalary: obracunR.applyDefaultSalary,
    printObracunR: obracunR.printObracunR,
    saveObracunRPdfOnly: obracunR.saveObracunRPdfOnly,
    saveObracunRDraft: obracunR.saveObracunRDraft,
    toggleObracunEmailBox: obracunR.toggleObracunEmailBox,
    sendObracunREmail: obracunR.sendObracunREmail,
    ...obracunR.emailActions,
    openObracunKModal: obracunK.openObracunKModal,
    closeObracunKModal: obracunK.closeObracunKModal,
    renderObracunK: obracunK.renderObracunK,
    loadObracunKEmployees: obracunK.loadObracunKEmployees,
    updateObracunKRow: obracunK.updateObracunKRow,
    deleteObracunKRow: obracunK.deleteObracunKRow,
    printObracunK: obracunK.printObracunK,
    saveObracunKPdfOnly: obracunK.saveObracunKPdfOnly,
    saveObracunKDraft: obracunK.saveObracunKDraft,
    toggleObracunKEmailBox: obracunK.toggleObracunKEmailBox,
    sendObracunKEmail: obracunK.sendObracunKEmail,
    ...obracunK.emailActions,
    openInvoiceModal: invoice.openInvoiceModal,
    closeInvoiceModal: invoice.closeInvoiceModal,
    newInvoice: invoice.newInvoice,
    fillInvoiceCompany: invoice.fillInvoiceCompany,
    addInvoiceItem: invoice.addInvoiceItem,
    fillInvoiceArticle: invoice.fillInvoiceArticle,
    updateInvoiceDueDate: invoice.updateInvoiceDueDate,
    renderInvoicePreview: invoice.renderInvoicePreview,
    printInvoice: invoice.printInvoice,
    saveInvoicePdfOnly: invoice.saveInvoicePdfOnly,
    toggleInvoiceEmailBox: invoice.toggleInvoiceEmailBox,
    sendInvoiceEmail: invoice.sendInvoiceEmail,
    ...invoice.emailActions
});

initChrome();
partners.initPartners();
transaction.initTransaction();
review.initReview();
notes.initNotes();
documents.initDocuments();
initViewer();
["transactionPartner", "invoiceCompany", "cardPartner"].forEach(id => makeSearchable(document.getElementById(id)));

(async function init(){
    const session = await api.getSession();
    if(session && await api.isActiveUser()){
        startApp();
    }else{
        showLogin();
    }
})();
