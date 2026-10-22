// Sav pristup Supabase-u (baza, Storage, Edge Function) na jednom mestu.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

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
