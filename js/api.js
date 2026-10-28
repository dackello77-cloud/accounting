// Sav pristup Supabase-u (baza, Storage, Edge Function) na jednom mestu.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { UserError } from "./util.js";

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

const LOGIN_ERROR = "Pogrešan username/email ili lozinka.";

// Poziva se kad sesija istekne ili je odbijena; aplikacija tada prikazuje prijavu preko ekrana.
let onAuthRequired = () => {};
export function setAuthRequiredHandler(fn){ onAuthRequired = fn; }

function isAuthError(error){
    if(!error) return false;
    const status = Number(error.status || error.statusCode || 0);
    return status === 401 || error.code === "PGRST301" || error.code === "PGRST302"
        || /jwt|not authenticated|nemate pristup/i.test(String(error.message || ""));
}

// Jedinstveno rukovanje greškama: auth greška → prijava preko otvorenih prozora.
async function run(promise){
    const { data, error } = await promise;
    if(error){
        if(isAuthError(error)) onAuthRequired();
        throw error;
    }
    return data;
}

// ---------- Prijava ----------

export async function signIn(identifier, password){
    let email = String(identifier || "").trim();
    if(!email || !password) throw new Error(LOGIN_ERROR);

    if(!email.includes("@")){
        const { data, error } = await sb.rpc("email_for_username", { p_username: email });
        if(error || !data) throw new Error(LOGIN_ERROR);
        email = data;
    }

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if(error) throw new Error(LOGIN_ERROR);

    const active = await isActiveUser();
    if(!active){
        await sb.auth.signOut();
        throw new Error(LOGIN_ERROR);
    }
    return data.session;
}

export async function signOut(){
    await sb.auth.signOut();
}

export async function getSession(){
    const { data } = await sb.auth.getSession();
    return data.session;
}

export function onAuthChange(fn){
    return sb.auth.onAuthStateChange((event, session) => fn(event, session));
}

export async function isActiveUser(){
    const { data, error } = await sb.rpc("is_active_user");
    return !error && data === true;
}

// ---------- Dashboard ----------

export function dashboardSummary(year){
    return run(sb.rpc("dashboard_summary", { p_year: year }));
}

// ---------- Partneri i artikli ----------

export function listPartners(groupType, { activeOnly = false } = {}){
    let q = sb.from("partners").select("*").order("name");
    if(groupType) q = q.eq("group_type", groupType);
    if(activeOnly) q = q.eq("active", true);
    return run(q);
}

export function savePartner(id, fields){
    return id
        ? run(sb.from("partners").update(fields).eq("id", id).select().single())
        : run(sb.from("partners").insert(fields).select().single());
}

export function listArticles({ activeOnly = false } = {}){
    let q = sb.from("articles").select("*").order("name");
    if(activeOnly) q = q.eq("active", true);
    return run(q);
}

export function saveArticle(id, fields){
    return id
        ? run(sb.from("articles").update(fields).eq("id", id).select().single())
        : run(sb.from("articles").insert(fields).select().single());
}

// ---------- Transakcije ----------

export function addTransaction(fields){
    return run(sb.from("transactions").insert(fields).select().single());
}

export function listTransactions(from, to){
    let q = sb.from("transactions").select("*")
        .order("tx_date", { ascending: false })
        .order("created_at", { ascending: false });
    if(from) q = q.gte("tx_date", from);
    if(to) q = q.lte("tx_date", to);
    return run(q);
}

export function stornoTransaction(id){
    return run(sb.rpc("storno_transaction", { p_id: id }));
}

export function card(partnerId, type, from, to, view){
    return run(sb.rpc("card", {
        p_partner: partnerId || null, p_type: type || null,
        p_from: from || null, p_to: to || null, p_view: view || "single"
    }));
}

// ---------- Notes / podsetnici ----------

export function listNotes(){
    return run(sb.from("notes").select("*").eq("status", "active").order("created_at", { ascending: false }));
}

export function saveNote(id, fields){
    return id
        ? run(sb.from("notes").update(fields).eq("id", id))
        : run(sb.from("notes").insert(fields));
}

export function deleteNote(id){
    return run(sb.from("notes").update({ status: "deleted" }).eq("id", id));
}

// Aktivni podsetnici do 24 h unapred (i oni koji su prošli), kao 1.x.
export function reminderAlerts(){
    const limit = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    return run(sb.from("notes").select("*")
        .eq("status", "active").eq("type", "reminder")
        .not("remind_at", "is", null).lte("remind_at", limit)
        .order("remind_at"));
}

// ---------- Email primaoci ----------

export function listEmailRecipients(){
    return run(sb.from("email_recipients").select("*").order("email"));
}

export function addEmailRecipient(email, name){
    return run(sb.from("email_recipients").insert({ email: String(email).trim(), name: name || null }).select().single());
}

// ---------- Storage i dokumenti ----------

export async function uploadFile(bucket, path, body, { contentType, upsert = false } = {}){
    return run(sb.storage.from(bucket).upload(path, body, { contentType, upsert, cacheControl: "60" }));
}

// Signed URL važi 60 s; sa downloadName pregledač preuzima fajl pod tim imenom.
export async function signedUrl(bucket, path, downloadName){
    const data = await run(sb.storage.from(bucket).createSignedUrl(path, 60, downloadName ? { download: downloadName } : undefined));
    return data.signedUrl;
}

export async function downloadFile(bucket, path){
    return run(sb.storage.from(bucket).download(path));
}

export function moveFile(bucket, from, to){
    return run(sb.storage.from(bucket).move(from, to));
}

export function upsertDocument(category, storagePath, fileName){
    return run(sb.from("documents").upsert({ category, storage_path: storagePath, file_name: fileName }, { onConflict: "storage_path" }));
}

export function listDocuments(category){
    return run(sb.from("documents").select("*").eq("category", category).order("created_at", { ascending: false }));
}

export function setTransactionDocument(id, path){
    return run(sb.from("transactions").update({ document_path: path }).eq("id", id));
}

// ---------- Računi (skenirani) ----------

export function addReceipt(fields){
    return run(sb.from("receipts").insert(fields).select().single());
}

export function listInboxReceipts(){
    return run(sb.from("receipts").select("*").is("transaction_id", null).order("uploaded_at", { ascending: false }));
}

export function listAllReceipts(){
    return run(sb.from("receipts").select("*").order("uploaded_at", { ascending: false }));
}

export function attachReceipt(id, transactionId, storagePath){
    return run(sb.from("receipts").update({ transaction_id: transactionId, storage_path: storagePath }).eq("id", id));
}

// Kompanija, broj fakture i iznos računa (sva tri ili nijedan).
export function setReceiptClaim(id, fields){
    return run(sb.from("receipts").update(fields).eq("id", id).select().single());
}

// ---------- Potraživanja ----------

export function listReceivables(){
    return run(sb.from("v_receivables").select("*").order("partner_name").order("uploaded_at", { ascending: false }));
}

export function listReceivablePayments(receiptId){
    return run(sb.from("transactions").select("id, tx_date, amount, notes, created_at")
        .eq("receipt_id", receiptId).eq("status", "active").order("tx_date").order("created_at"));
}

// ---------- Fakture ----------

export function nextInvoiceNumber(year){
    return run(sb.rpc("next_invoice_number", { p_year: year }));
}

export function saveInvoice(invoice, items){
    return run(sb.rpc("save_invoice", { p_invoice: invoice, p_items: items }));
}

export function setInvoicePdf(id, path){
    return run(sb.from("invoices").update({ pdf_path: path }).eq("id", id));
}

export function listInvoiceCompanies(){
    return run(sb.from("partners").select("*").in("group_type", ["ulaz", "porezi", "klijenti"]).eq("active", true).order("name"));
}

// ---------- Obračuni R i K ----------

// Bez sesije RLS vraća prazan rezultat bez greške; tada bi se prazan nacrt upisao preko sačuvanog.
export async function getDraft(type){
    if(!await getSession()){
        onAuthRequired();
        throw new UserError("Niste prijavljeni. Prijavite se i otvorite obračun ponovo.");
    }
    return run(sb.from("calc_drafts").select("data").eq("type", type).maybeSingle());
}

export function saveDraft(type, data){
    return run(sb.from("calc_drafts").upsert({ type, data }, { onConflict: "type" }));
}

// Jedan red po mesecu: ponovno čuvanje istog meseca ažurira red.
export async function savePayroll(table, fields){
    const existing = await run(sb.from(table).select("id").eq("month", fields.month).eq("year", fields.year)
        .order("created_at", { ascending: false }).limit(1));
    if(existing.length){
        return run(sb.from(table).update(fields).eq("id", existing[0].id).select().single());
    }
    return run(sb.from(table).insert(fields).select().single());
}

// ---------- Mejl ----------

export async function sendEmail(payload){
    const { data, error } = await sb.functions.invoke("send-email", { body: payload });
    if(error){
        let message = "Greška pri slanju mejla.";
        try{
            const body = await error.context?.json();
            if(body?.error) message = body.error;
        }catch{}
        if(error.context?.status === 401) onAuthRequired();
        if(error.context?.status === 404) message = "Funkcija send-email nije postavljena na Supabase.";
        throw new UserError(message);
    }
    return data;
}
