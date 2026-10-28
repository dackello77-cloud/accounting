// Skeniranje fotografije računa: pronalazi list (svetliji od podloge), korisnik po potrebi pomera
// 4 ugla, pa se list ispravlja (perspektiva) i dobija izgled skenera (sivo, bela pozadina, bez senki).
const $ = (id) => document.getElementById(id);
const WORK_MAX = 2400;   // najduža strana slike za obradu
const DETECT_MAX = 360;  // najduža strana za pronalaženje lista

let source = null;       // canvas sa fotografijom (WORK_MAX)
let corners = [];        // [tl, tr, br, bl] u koordinatama fotografije
let dragging = -1;
let finish = null;

// Vraća skeniran JPEG (File) ili null ako korisnik odustane.
export async function scanImage(file){
    source = await loadImage(file);
    corners = detectCorners(source);
    const view = $("scanCanvas");
    view.width = source.width;
    view.height = source.height;
    view.getContext("2d").drawImage(source, 0, 0);
    $("scanStatus").textContent = "";
    $("scanModal").style.display = "flex";
    requestAnimationFrame(drawOverlay);
    return new Promise(resolve => { finish = resolve; });
}

export function cancelScan(){ close(null); }

export async function confirmScan(){
    $("scanStatus").textContent = "Obrađujem...";
    // Pusti pregledač da prikaže poruku pre teškog računanja.
    await new Promise(r => setTimeout(r, 30));
    try{
        const canvas = scanLook(warp(grayOf(source), source.width, source.height, corners));
        const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.85));
        close(new File([blob], "sken.jpg", { type: "image/jpeg" }));
    }catch(error){
        console.error(error);
        $("scanStatus").textContent = "Obrada slike nije uspela. Pokušajte ponovo.";
    }
}

function close(result){
    $("scanModal").style.display = "none";
    source = null;
    const done = finish;
    finish = null;
    done?.(result);
}

// <img> poštuje EXIF orijentaciju telefona; slika se smanjuje na WORK_MAX.
async function loadImage(file){
    const url = URL.createObjectURL(file);
    try{
        const img = new Image();
        img.src = url;
        await img.decode();
        const k = Math.min(1, WORK_MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        return c;
    }finally{
        URL.revokeObjectURL(url);
    }
}

function grayOf(canvas){
    const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    const gray = new Uint8ClampedArray(canvas.width * canvas.height);
    for(let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    return gray;
}

// ---------- Pronalaženje lista ----------

// Najveća svetla oblast (Otsu prag) → krajnje tačke po x+y i x−y kao uglovi.
function detectCorners(src){
    const k = Math.min(1, DETECT_MAX / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
    const small = document.createElement("canvas");
    small.width = w;
    small.height = h;
    small.getContext("2d").drawImage(src, 0, 0, w, h);
    const gray = boxBlur(grayOf(small), w, h, 2);
    const t = otsu(gray);

    const label = new Int32Array(w * h).fill(-1);
    const stack = new Int32Array(w * h);
    let best = null;
    for(let start = 0; start < gray.length; start++){
        if(label[start] !== -1 || gray[start] <= t) continue;
        let top = 0, size = 0;
        const c = { size: 0, tl: [0, 0, Infinity], br: [0, 0, -Infinity], tr: [0, 0, -Infinity], bl: [0, 0, Infinity] };
        stack[top++] = start;
        label[start] = start;
        while(top){
            const p = stack[--top];
            const x = p % w, y = (p - x) / w;
            size++;
            if(x + y < c.tl[2]) c.tl = [x, y, x + y];
            if(x + y > c.br[2]) c.br = [x, y, x + y];
            if(x - y > c.tr[2]) c.tr = [x, y, x - y];
            if(x - y < c.bl[2]) c.bl = [x, y, x - y];
            for(const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]){
                if(q >= 0 && label[q] === -1 && gray[q] > t){ label[q] = start; stack[top++] = q; }
            }
        }
        c.size = size;
        if(!best || size > best.size) best = c;
    }

    const inset = (fx, fy) => ({ x: src.width * fx, y: src.height * fy });
    if(!best || best.size < w * h * 0.12) return [inset(.06, .06), inset(.94, .06), inset(.94, .94), inset(.06, .94)];
    return [best.tl, best.tr, best.br, best.bl].map(([x, y]) => ({ x: (x + 0.5) / k, y: (y + 0.5) / k }));
}

function boxBlur(gray, w, h, r){
    const tmp = new Uint8ClampedArray(gray.length), out = new Uint8ClampedArray(gray.length);
    for(let y = 0; y < h; y++) for(let x = 0; x < w; x++){
        let s = 0, n = 0;
        for(let d = -r; d <= r; d++){ const xx = x + d; if(xx >= 0 && xx < w){ s += gray[y * w + xx]; n++; } }
        tmp[y * w + x] = s / n;
    }
    for(let y = 0; y < h; y++) for(let x = 0; x < w; x++){
        let s = 0, n = 0;
        for(let d = -r; d <= r; d++){ const yy = y + d; if(yy >= 0 && yy < h){ s += tmp[yy * w + x]; n++; } }
        out[y * w + x] = s / n;
    }
    return out;
}

function otsu(gray){
    const hist = new Array(256).fill(0);
    for(const v of gray) hist[v]++;
    let sum = 0;
    for(let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, threshold = 127;
    for(let i = 0; i < 256; i++){
        wB += hist[i];
        if(!wB) continue;
        const wF = gray.length - wB;
        if(!wF) break;
        sumB += i * hist[i];
        const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
        if(between > best){ best = between; threshold = i; }
    }
    return threshold;
}

// ---------- Ispravljanje perspektive i izgled skenera ----------

// Homografija koja tačke izlaza (pravougaonik) preslikava u uglove na fotografiji.
function homography(from, to){
    const A = [], b = [];
    for(let i = 0; i < 4; i++){
        const { x, y } = from[i], { x: u, y: v } = to[i];
        A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
        A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    for(let c = 0; c < 8; c++){
        let p = c;
        for(let r = c + 1; r < 8; r++) if(Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
        [A[c], A[p]] = [A[p], A[c]];
        [b[c], b[p]] = [b[p], b[c]];
        for(let r = 0; r < 8; r++){
            if(r === c) continue;
            const f = A[r][c] / A[c][c];
            for(let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
            b[r] -= f * b[c];
        }
    }
    return b.map((v, i) => v / A[i][i]);
}

function warp(gray, sw, sh, q){
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const w = Math.max(1, Math.round(Math.max(dist(q[0], q[1]), dist(q[3], q[2]))));
    const h = Math.max(1, Math.round(Math.max(dist(q[0], q[3]), dist(q[1], q[2]))));
    const H = homography([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], q);
    const out = new Uint8ClampedArray(w * h);
    for(let y = 0; y < h; y++){
        for(let x = 0; x < w; x++){
            const d = H[6] * x + H[7] * y + 1;
            const u = Math.min(sw - 1.001, Math.max(0, (H[0] * x + H[1] * y + H[2]) / d));
            const v = Math.min(sh - 1.001, Math.max(0, (H[3] * x + H[4] * y + H[5]) / d));
            const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, i = y0 * sw + x0;
            out[y * w + x] = (gray[i] * (1 - fx) + gray[i + 1] * fx) * (1 - fy) + (gray[i + sw] * (1 - fx) + gray[i + sw + 1] * fx) * fy;
        }
    }
    return { gray: out, w, h };
}

// Deljenje lokalnim prosekom uklanja senke; papir postaje beo, tekst taman.
function scanLook({ gray, w, h }){
    const r = Math.max(8, Math.round(Math.max(w, h) / 25));
    const W = w + 1;
    const integral = new Uint32Array(W * (h + 1));
    for(let y = 1; y <= h; y++){
        let row = 0;
        for(let x = 1; x <= w; x++){
            row += gray[(y - 1) * w + x - 1];
            integral[y * W + x] = integral[(y - 1) * W + x] + row;
        }
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(w, h);
    const lo = 0.55, hi = 0.9;
    for(let y = 0; y < h; y++){
        const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
        for(let x = 0; x < w; x++){
            const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
            const mean = (integral[y1 * W + x1] - integral[y0 * W + x1] - integral[y1 * W + x0] + integral[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
            const n = gray[y * w + x] / Math.max(mean, 1);
            const v = 255 * Math.min(1, Math.max(0, (n - lo) / (hi - lo))) ** 1.4;
            const o = (y * w + x) * 4;
            img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
            img.data[o + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

// ---------- Pomeranje uglova ----------

function drawOverlay(){
    if(!source) return;
    const svg = $("scanOverlay");
    svg.setAttribute("viewBox", `0 0 ${source.width} ${source.height}`);
    const handle = Math.max(source.width, source.height) / 28;
    svg.innerHTML = `<polygon points="${corners.map(c => `${c.x},${c.y}`).join(" ")}" class="scan-quad" style="stroke-width:${handle / 5}"/>`
        + corners.map((c, i) => `<circle cx="${c.x}" cy="${c.y}" r="${handle}" data-corner="${i}" class="scan-handle" style="stroke-width:${handle / 5}"/>`).join("");
}

function toImage(event){
    const rect = $("scanOverlay").getBoundingClientRect();
    return {
        x: Math.min(source.width, Math.max(0, (event.clientX - rect.left) / rect.width * source.width)),
        y: Math.min(source.height, Math.max(0, (event.clientY - rect.top) / rect.height * source.height))
    };
}

export function initScan(){
    const svg = $("scanOverlay");
    svg.addEventListener("pointerdown", (event) => {
        if(!source) return;
        // Najbliži ugao u krugu od 20% dijagonale (lakše na telefonu nego pogađanje kružića).
        const p = toImage(event);
        const d = corners.map(c => Math.hypot(c.x - p.x, c.y - p.y));
        const best = d.indexOf(Math.min(...d));
        if(d[best] > Math.hypot(source.width, source.height) * 0.2) return;
        dragging = best;
        corners[dragging] = p;
        svg.setPointerCapture(event.pointerId);
        drawOverlay();
        event.preventDefault();
    });
    svg.addEventListener("pointermove", (event) => {
        if(dragging < 0 || !source) return;
        corners[dragging] = toImage(event);
        drawOverlay();
    });
    const stop = () => { dragging = -1; };
    svg.addEventListener("pointerup", stop);
    svg.addEventListener("pointercancel", stop);
}
