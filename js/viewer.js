// Galerija dokumenata: pregled fajla preko celog ekrana, strelice levo/desno (i tasteri ← →), preuzimanje, Esc zatvara.
import * as api from "./api.js";
import { errorMessage } from "./util.js";
import { extensionOf } from "./files.js";

const $ = (id) => document.getElementById(id);
const IMAGE_EXT = [".jpg", ".jpeg", ".png"];
let items = [];
let index = 0;
let loadToken = 0;

// list: [{ bucket, path, name }]
export function openViewer(list, startIndex = 0){
    items = list;
    index = startIndex;
    $("docViewer").hidden = false;
    document.body.classList.add("viewer-open");
    show();
}

export function closeViewer(){
    $("docViewer").hidden = true;
    document.body.classList.remove("viewer-open");
    $("viewerStage").innerHTML = "";
    loadToken++;
}

function step(delta){
    if(items.length < 2) return;
    index = (index + delta + items.length) % items.length;
    show();
}

async function show(){
    const f = items[index];
    const token = ++loadToken;
    $("viewerName").textContent = f.name;
    $("viewerCount").textContent = `${index + 1} / ${items.length}`;
    $("viewerPrev").disabled = $("viewerNext").disabled = items.length < 2;
    const stage = $("viewerStage");
    stage.innerHTML = `<div class="viewer-msg">Učitavam…</div>`;
    try{
        const url = await api.signedUrl(f.bucket, f.path);
        if(token !== loadToken) return;
        const ext = extensionOf(f.path);
        if(ext === ".pdf"){
            const frame = document.createElement("iframe");
            frame.src = url;
            frame.title = f.name;
            stage.replaceChildren(frame);
        }else if(IMAGE_EXT.includes(ext)){
            const img = document.createElement("img");
            img.src = url;
            img.alt = f.name;
            stage.replaceChildren(img);
        }else{
            stage.innerHTML = `<div class="viewer-msg">Pregled ovog tipa fajla nije dostupan u pregledaču.<br>Koristite <strong>Preuzmi</strong>.</div>`;
        }
    }catch(error){
        if(token !== loadToken) return;
        stage.innerHTML = "";
        const msg = document.createElement("div");
        msg.className = "viewer-msg";
        msg.textContent = errorMessage(error, "Fajl nije moguće otvoriti.");
        stage.append(msg);
    }
}

async function download(){
    const f = items[index];
    if(!f) return;
    try{
        location.href = await api.signedUrl(f.bucket, f.path, f.name);
    }catch(error){
        alert(errorMessage(error, "Preuzimanje nije uspelo."));
    }
}

export function initViewer(){
    $("viewerPrev").addEventListener("click", () => step(-1));
    $("viewerNext").addEventListener("click", () => step(1));
    $("viewerClose").addEventListener("click", closeViewer);
    $("viewerDownload").addEventListener("click", download);
    $("docViewer").addEventListener("click", (event) => { if(event.target.id === "docViewer") closeViewer(); });
    document.addEventListener("keydown", (event) => {
        if($("docViewer").hidden) return;
        if(event.key === "ArrowLeft"){ event.preventDefault(); step(-1); }
        else if(event.key === "ArrowRight"){ event.preventDefault(); step(1); }
        else if(event.key === "Escape"){ event.preventDefault(); closeViewer(); }
    });
}
