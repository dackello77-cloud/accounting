// Skeniranje fotografije računa: pronalazi list (svetliji od podloge), korisnik po potrebi pomera
// 4 ugla, pa se list ispravlja (perspektiva) i dobija izgled skenera (sivo, bela pozadina, bez senki).
const $ = (id) => document.getElementById(id);
const WORK_MAX = 2400;   // najduža strana slike za obradu
const DETECT_MAX = 360;  // najduža strana za pronalaženje lista
const REFINE_MAX = 1000; // najduža strana za doterivanje ivica
const INSET = 0.015;     // uglovi 1,5% ka sredini lista

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

// Kandidati: svetle oblasti (više pragova) i oblast zatvorena ivicama (senka je ne prekida).
// Bira se kandidat koji najviše liči na list, ivice se doteruju po gradijentu, uglovi idu malo unutra.
function detectCorners(src){
    const fallback = [[.06, .06], [.94, .06], [.94, .94], [.06, .94]].map(([fx, fy]) => ({ x: src.width * fx, y: src.height * fy }));
    const k = Math.min(1, DETECT_MAX / Math.max(src.width, src.height));
    const { gray, w, h } = shrink(src, k, 2);
    const t = otsu(gray);
    const candidates = [-30, -15, 0, 15].map(d => largestRegion(w, h, p => gray[p] > t + d));
    const grad = sobel(gray, w, h);
    const edges = edgeMask(grad);
    const outside = fillFromBorder(edges, w, h);
    candidates.push(largestRegion(w, h, p => !outside[p]));

    let best = null, bestScore = 0;
    for(const c of candidates){
        const score = c && sheetScore(c, gray, w, h);
        if(score > bestScore){ best = c; bestScore = score; }
    }
    if(!best) return fallback;

    let quad = best.quad.map(([x, y]) => ({ x: (x + 0.5) / k, y: (y + 0.5) / k }));
    quad = refineEdges(src, quad);
    // Malo unutra, da u kropu ne ostane traka podloge.
    const cx = quad.reduce((s, p) => s + p.x, 0) / 4, cy = quad.reduce((s, p) => s + p.y, 0) / 4;
    return quad.map(p => ({ x: p.x + (cx - p.x) * INSET, y: p.y + (cy - p.y) * INSET }));
}

function shrink(src, k, blur){
    const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(src, 0, 0, w, h);
    return { gray: boxBlur(grayOf(c), w, h, blur), w, h };
}

// Najveća povezana oblast za koju važi inside(p): veličina (i sa popunjenim rupama), dodir sa ivicom slike, uglovi (x+y, x−y).
function largestRegion(w, h, inside){
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let best = null;
    for(let start = 0; start < seen.length; start++){
        if(seen[start] || !inside(start)) continue;
        let top = 0, size = 0, border = 0;
        let tl = [0, 0, Infinity], br = [0, 0, -Infinity], tr = [0, 0, -Infinity], bl = [0, 0, Infinity];
        stack[top++] = start;
        seen[start] = 1;
        while(top){
            const p = stack[--top];
            const x = p % w, y = (p - x) / w;
            size++;
            if(x === 0 || y === 0 || x === w - 1 || y === h - 1) border++;
            if(x + y < tl[2]) tl = [x, y, x + y];
            if(x + y > br[2]) br = [x, y, x + y];
            if(x - y > tr[2]) tr = [x, y, x - y];
            if(x - y < bl[2]) bl = [x, y, x - y];
            if(x > 0 && !seen[p - 1] && inside(p - 1)){ seen[p - 1] = 1; stack[top++] = p - 1; }
            if(x < w - 1 && !seen[p + 1] && inside(p + 1)){ seen[p + 1] = 1; stack[top++] = p + 1; }
            if(y > 0 && !seen[p - w] && inside(p - w)){ seen[p - w] = 1; stack[top++] = p - w; }
            if(y < h - 1 && !seen[p + w] && inside(p + w)){ seen[p + w] = 1; stack[top++] = p + w; }
        }
        if(!best || size > best.size) best = { size, border, start, quad: [tl, tr, br, bl] };
    }
    if(best) best.filled = filledSize(w, h, inside, best.start);
    return best;
}

// Veličina oblasti sa popunjenim rupama (npr. senka ili tekst na listu): sve što nije podloga
// dostupna sa ivice slike bez prelaska preko oblasti.
function filledSize(w, h, inside, start){
    const mask = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let top = 0;
    const grow = (p) => { if(!mask[p] && inside(p)){ mask[p] = 1; stack[top++] = p; } };
    grow(start);
    while(top){
        const p = stack[--top], x = p % w;
        if(x > 0) grow(p - 1);
        if(x < w - 1) grow(p + 1);
        if(p >= w) grow(p - w);
        if(p < w * (h - 1)) grow(p + w);
    }
    return w * h - fillFromBorder({ edge: mask }, w, h).reduce((s, v) => s + v, 0);
}

// Koliko oblast liči na list: duž sve četiri stranice svetlina se menja preko ivice (najslabija
// stranica odlučuje; slova daju promenu samo mestimično), razumne je veličine i ne leži na ivici slike.
function sheetScore(c, gray, w, h){
    const q = c.quad;
    let area = 0;
    for(let i = 0; i < 4; i++){ const a = q[i], b = q[(i + 1) % 4]; area += a[0] * b[1] - b[0] * a[1]; }
    area = Math.abs(area) / 2;
    const coverage = area / (w * h);
    if(coverage < 0.1 || coverage > 0.97) return 0;
    const fill = Math.min(1, c.filled / area);
    if(fill < 0.4) return 0;
    const at = (x, y) => gray[Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))];
    let support = 1;
    for(let e = 0; e < 4; e++){
        const [ax, ay] = q[e], [bx, by] = q[(e + 1) % 4];
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const nx = -(by - ay) / len * 3, ny = (bx - ax) / len * 3;
        let hits = 0;
        for(let s = 0; s < 24; s++){
            const t = 0.1 + 0.8 * s / 23;
            const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
            // Najveća razlika preko stranice u pojasu ±2 piksela (grub ugao nije savršeno na ivici).
            let diff = 0;
            for(let d = -2; d <= 2; d++){
                const ox = px + nx / 3 * d, oy = py + ny / 3 * d;
                diff = Math.max(diff, Math.abs(at(ox + nx, oy + ny) - at(ox - nx, oy - ny)));
            }
            if(diff > 10) hits++;
        }
        support = Math.min(support, hits / 24);
    }
    return support + 0.2 * fill + 0.1 * coverage - 3 * c.border / (2 * (w + h));
}

function sobel(gray, w, h){
    const g = new Float32Array(w * h);
    for(let y = 1; y < h - 1; y++){
        for(let x = 1; x < w - 1; x++){
            const i = y * w + x;
            const gx = gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1] - gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1];
            const gy = gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1] - gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1];
            g[i] = Math.hypot(gx, gy);
        }
    }
    return { g, w, h };
}

// Jake ivice (prag iz raspodele gradijenta), podebljane za 1 piksel da se zatvore male rupe.
function edgeMask({ g, w, h }){
    let sum = 0, sq = 0;
    for(const v of g){ sum += v; sq += v * v; }
    const mean = sum / g.length, std = Math.sqrt(Math.max(0, sq / g.length - mean * mean));
    const t = Math.max(30, mean + 1.5 * std);
    const edge = new Uint8Array(w * h);
    for(let y = 1; y < h - 1; y++){
        for(let x = 1; x < w - 1; x++){
            const i = y * w + x;
            if(g[i] > t) edge[i] = edge[i - 1] = edge[i + 1] = edge[i - w] = edge[i + w] = 1;
        }
    }
    return { edge, t, w, h };
}

// Podloga = sve do čega se od ivice slike stiže bez prelaska preko jake ivice.
function fillFromBorder({ edge }, w, h){
    const out = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let top = 0;
    const push = (p) => { if(!out[p] && !edge[p]){ out[p] = 1; stack[top++] = p; } };
    for(let x = 0; x < w; x++){ push(x); push((h - 1) * w + x); }
    for(let y = 0; y < h; y++){ push(y * w); push(y * w + w - 1); }
    while(top){
        const p = stack[--top];
        const x = p % w;
        if(x > 0) push(p - 1);
        if(x < w - 1) push(p + 1);
        if(p >= w) push(p - w);
        if(p < w * (h - 1)) push(p + w);
    }
    return out;
}

// Svaka stranica: duž nje, poprečno, traži se najjača ivica; kroz te tačke prava (uz odbacivanje
// odstupanja); novi uglovi su preseci susednih pravih. Ako doterivanje odluta, ostaje grub ugao.
function refineEdges(src, quad){
    const k = Math.min(1, REFINE_MAX / Math.max(src.width, src.height));
    const { gray, w, h } = shrink(src, k, 1);
    const { g } = sobel(gray, w, h);
    const q = quad.map(p => ({ x: p.x * k, y: p.y * k }));
    const reach = Math.max(4, Math.round(Math.max(w, h) * 0.025));
    const lines = [];
    for(let e = 0; e < 4; e++){
        const a = q[e], b = q[(e + 1) % 4];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
        const pts = [];
        for(let s = 1; s < 24; s++){
            const t = 0.08 + 0.84 * s / 24;
            const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
            let bestV = 0, bx = 0, by = 0;
            for(let d = -reach; d <= reach; d++){
                const x = Math.round(px + nx * d), y = Math.round(py + ny * d);
                if(x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
                const v = g[y * w + x];
                if(v > bestV){ bestV = v; bx = x; by = y; }
            }
            if(bestV > 40) pts.push({ x: bx, y: by });
        }
        lines.push(pts.length >= 8 ? fitLine(pts) : null);
    }
    return quad.map((p, i) => {
        const l1 = lines[(i + 3) % 4], l2 = lines[i];
        const c = l1 && l2 && intersect(l1, l2);
        if(!c || Math.hypot(c.x - q[i].x, c.y - q[i].y) > reach * 2) return p;
        return { x: c.x / k, y: c.y / k };
    });
}

// Prava kroz tačke (glavna osa), pa ponovo bez tačaka daleko od prave.
function fitLine(pts){
    const fit = (ps) => {
        const mx = ps.reduce((s, p) => s + p.x, 0) / ps.length, my = ps.reduce((s, p) => s + p.y, 0) / ps.length;
        let sxx = 0, syy = 0, sxy = 0;
        for(const p of ps){ sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); }
        const angle = Math.atan2(2 * sxy, sxx - syy) / 2;
        return { x: mx, y: my, dx: Math.cos(angle), dy: Math.sin(angle) };
    };
    let line = fit(pts);
    const dist = (p) => Math.abs((p.x - line.x) * line.dy - (p.y - line.y) * line.dx);
    const sorted = pts.map(dist).sort((a, b) => a - b);
    const limit = Math.max(1.5, 2.5 * sorted[sorted.length >> 1]);
    const kept = pts.filter(p => dist(p) <= limit);
    if(kept.length >= 6) line = fit(kept);
    return line;
}

function intersect(a, b){
    const det = a.dx * b.dy - a.dy * b.dx;
    if(Math.abs(det) < 1e-6) return null;
    const t = ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / det;
    return { x: a.x + a.dx * t, y: a.y + a.dy * t };
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
