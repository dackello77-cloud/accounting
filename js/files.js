// Nazivi fajlova kao u 1.x i bezbedne putanje za Storage.
import { todayIso } from "./util.js";

export const MONTHS = ["Januar","Februar","Mart","April","Maj","Jun","Jul","Avgust","Septembar","Oktobar","Novembar","Decembar"];

// Kategorija dokumenta → bucket i folder u Storage-u.
export const CATEGORIES = {
    transakcije:     { bucket: "documents",  folder: "transakcije", label: "Transakcije",      hint: "PDF dokumenti transakcija" },
    kartice:         { bucket: "documents",  folder: "kartice",     label: "Kartice",          hint: "PDF kartice i pregledi" },
    izvodi_dinarski: { bucket: "statements", folder: "dinarski",    label: "Izvodi - Dinarski", hint: "Dinarski bankovni izvodi", upload: true },
    izvodi_devizni:  { bucket: "statements", folder: "devizni",     label: "Izvodi - Devizni",  hint: "Devizni bankovni izvodi", upload: true },
    obracun_r:       { bucket: "documents",  folder: "obracun-r",   label: "Obračun - R",      hint: "PDF obračuni R" },
    obracun_k:       { bucket: "documents",  folder: "obracun-k",   label: "Obračun - K",      hint: "PDF obračuni K" },
    racuni:          { bucket: "receipts",   folder: "",            label: "Računi",           hint: "Sačuvani i povezani računi" },
    fakture:         { bucket: "documents",  folder: "fakture",     label: "Fakture",          hint: "Izdate i sačuvane fakture" }
};

export const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif"];
export const MAX_FILE_SIZE = 15 * 1024 * 1024;

export function sanitizeFileName(value){
    return String(value || "").replace(/[\\/?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim();
}

function firstWord(value, fallback){
    return sanitizeFileName(String(value || fallback).trim().split(/\s+/)[0] || fallback);
}

// Storage dozvoljava samo ASCII u ključu; prikazni naziv (sa č, ć…) čuva se u bazi.
const TRANSLIT = { č:"c", ć:"c", š:"s", đ:"dj", ž:"z", Č:"C", Ć:"C", Š:"S", Đ:"Dj", Ž:"Z" };
export function storageKey(name){
    return String(name || "fajl")
        .replace(/[čćšđžČĆŠĐŽ]/g, ch => TRANSLIT[ch])
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^\w/!\-.*'() &$@=;:+,]/g, "-")
        .replace(/\s+/g, " ").trim() || "fajl";
}

export function shortId(){
    return crypto.randomUUID().slice(0, 8);
}

// Transakcija i kartica: "MM-dd-yyyy - Ime - Faktura.pdf"
export function documentFileName(isoDate, name, invoiceNumber){
    const [y, m, d] = String(isoDate || todayIso()).split("-");
    return `${m}-${d}-${y} - ${firstWord(name, "Dokument")} - ${sanitizeFileName(invoiceNumber || "BEZ-FAKTURE")}.pdf`;
}

// Račun: "dd-MM-yyyy - napomena - original"
export function receiptFileName(note, originalName){
    const [y, m, d] = todayIso().split("-");
    return `${d}-${m}-${y} - ${firstWord(note, "Racun")} - ${sanitizeFileName(originalName || "racun")}`;
}

export function invoiceFileName(number){
    return `Invoice_${sanitizeFileName(String(number || "invoice").replace("/", "_"))}.pdf`;
}

export function payrollFileName(type, monthName, year){
    return `OBRAČUN - ${type} - ${sanitizeFileName(monthName)} ${sanitizeFileName(year)}.pdf`;
}

export function extensionOf(name){
    const m = String(name || "").match(/\.[A-Za-z0-9]{1,5}$/);
    return m ? m[0].toLowerCase() : "";
}

export function checkUploadFile(file){
    const ext = extensionOf(file.name);
    const okType = ALLOWED_TYPES.includes(file.type) || [".heic", ".heif", ".pdf", ".jpg", ".jpeg", ".png"].includes(ext);
    if(!okType) return "Dozvoljeni su samo PDF, JPG, PNG i HEIC fajlovi.";
    if(file.size > MAX_FILE_SIZE) return "Fajl je veći od 15 MB.";
    return "";
}

export function contentTypeOf(file){
    if(ALLOWED_TYPES.includes(file.type)) return file.type;
    const ext = extensionOf(file.name);
    return { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".heic": "image/heic", ".heif": "image/heif" }[ext] || "application/octet-stream";
}
