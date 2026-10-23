// Notes / Podsetnik: beleške i podsetnici; brisanje = označavanje (status deleted).
import * as api from "./api.js";
import { escapeHtml, formatDateTime, toDateTimeLocal, errorMessage, showModal, hideModal } from "./util.js";
import { loadReminderAlerts } from "./dashboard.js";

const $ = (id) => document.getElementById(id);
let notes = [];

export function openNotesModal(){
    showModal("notesModal");
    resetNoteForm();
    loadNotes();
}

export function closeNotesModal(){ hideModal("notesModal"); }

export function handleNoteTypeChange(){
    $("noteReminderAt").disabled = $("noteType").value !== "reminder";
}

export function resetNoteForm(){
    $("noteId").value = "";
    $("noteType").value = "note";
    $("noteTitle").value = "";
    $("noteText").value = "";
    $("noteReminderAt").value = "";
    $("notesStatus").textContent = "";
    handleNoteTypeChange();
}

async function loadNotes(){
    const list = $("notesList");
    list.textContent = "Učitavam...";
    try{
        notes = await api.listNotes();
        renderNotesList();
    }catch(error){
        list.textContent = "Greška pri učitavanju notes/podsetnika.";
    }
}

function renderNotesList(){
    const list = $("notesList");
    if(!notes.length){ list.innerHTML = `<div class="reminder-empty">Nema unosa.</div>`; return; }
    list.innerHTML = notes.map(n => `
        <div class="note-card">
            <div class="note-card-head">
                <div class="note-card-title">${escapeHtml(n.title || "Bez naslova")}</div>
                <div class="note-card-meta">${n.type === "reminder" ? "Podsetnik" : "Notes"}</div>
            </div>
            <div class="note-card-meta">${n.remind_at ? "Vreme: " + escapeHtml(formatDateTime(n.remind_at)) : ""}</div>
            <div class="note-card-text">${escapeHtml(n.body)}</div>
            <div class="note-card-actions">
                <button class="note-edit-btn" data-edit="${escapeHtml(n.id)}">Izmeni</button>
                <button class="note-del-btn" data-delete="${escapeHtml(n.id)}">Obriši</button>
            </div>
        </div>
    `).join("");
}

export async function saveNote(){
    const id = $("noteId").value;
    const type = $("noteType").value;
    const title = $("noteTitle").value.trim();
    const body = $("noteText").value.trim();
    const remindAt = $("noteReminderAt").value;
    if(!title && !body){ alert("Upišite naslov ili tekst."); return; }
    if(type === "reminder" && !remindAt){ alert("Za podsetnik unesite datum i vreme."); return; }

    $("notesStatus").textContent = "Čuvam...";
    try{
        await api.saveNote(id, {
            type, title: title || null, body: body || null,
            remind_at: type === "reminder" ? new Date(remindAt).toISOString() : null
        });
        resetNoteForm();
        $("notesStatus").textContent = "Sačuvano.";
        await loadNotes();
        await loadReminderAlerts();
    }catch(error){
        $("notesStatus").textContent = errorMessage(error, "Greška pri čuvanju.");
    }
}

function editNote(id){
    const n = notes.find(x => x.id === id);
    if(!n) return;
    $("noteId").value = n.id;
    $("noteType").value = n.type || "note";
    $("noteTitle").value = n.title || "";
    $("noteText").value = n.body || "";
    $("noteReminderAt").value = toDateTimeLocal(n.remind_at);
    handleNoteTypeChange();
    $("noteTitle").focus();
}

async function deleteNote(id){
    if(!confirm("Obrisati unos?")) return;
    try{
        await api.deleteNote(id);
        await loadNotes();
        await loadReminderAlerts();
    }catch(error){
        alert(errorMessage(error, "Greška pri brisanju"));
    }
}

export function initNotes(){
    $("notesList").addEventListener("click", (event) => {
        const edit = event.target.closest("button[data-edit]");
        const del = event.target.closest("button[data-delete]");
        if(edit) editNote(edit.dataset.edit);
        if(del) deleteNote(del.dataset.delete);
    });
}
