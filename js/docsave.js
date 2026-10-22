// Čuvanje HTML dokumenta kao PDF u Storage + red u `documents`.
import * as api from "./api.js";
import { htmlToPdfBlob } from "./pdf.js";
import { CATEGORIES, storageKey } from "./files.js";

// subfolder: npr. id transakcije, da isti naziv za dve transakcije ne prepiše fajl.
// Isti category + subfolder + fileName → isti fajl se prepisuje (upsert).
export async function savePdfDocument({ html, category, fileName, subfolder = "", orientation = "portrait", margin = 10 }){
    const blob = await htmlToPdfBlob(html, { orientation, margin });
    const cat = CATEGORIES[category];
    const path = [cat.folder, subfolder, storageKey(fileName)].filter(Boolean).join("/");
    await api.uploadFile(cat.bucket, path, blob, { contentType: "application/pdf", upsert: true });
    await api.upsertDocument(category, path, fileName);
    return { bucket: cat.bucket, path, fileName };
}

// Otvara fajl u novom tabu; prozor se otvara odmah (pre await) da ga pregledač ne blokira.
// Sa downloadName fajl se preuzima (Content-Disposition), stranica ostaje ista.
export async function openStorageFile(bucket, path, downloadName){
    if(downloadName){
        location.href = await api.signedUrl(bucket, path, downloadName);
        return;
    }
    const win = window.open("", "_blank");
    try{
        const url = await api.signedUrl(bucket, path, downloadName);
        if(win) win.location.href = url;
        else location.href = url;
    }catch(error){
        if(win) win.close();
        throw error;
    }
}
