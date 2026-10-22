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
