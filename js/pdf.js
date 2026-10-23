import { UserError } from "./util.js";

// HTML dokument → PDF u pregledaču (html2pdf.js), u skrivenom iframe-u da stilovi
// dokumenta ne utiču na aplikaciju. Iframe se krije omotačem height:0/overflow:hidden,
// ne pomeranjem van ekrana (html2canvas tada crta prazno).
const HTML2PDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";

export async function htmlToPdfBlob(html, { orientation = "portrait", margin = 10 } = {}){
    const wrap = document.createElement("div");
    wrap.style.cssText = "overflow:hidden;height:0;width:0;";
    const frame = document.createElement("iframe");
    frame.style.cssText = `width:${orientation === "landscape" ? 1123 : 794}px;height:1123px;border:0;`;
    wrap.appendChild(frame);
    document.body.appendChild(wrap);

    try{
        await new Promise((resolve) => { frame.onload = resolve; frame.srcdoc = html; });
        const doc = frame.contentDocument;
        await new Promise((resolve, reject) => {
            const script = doc.createElement("script");
            script.src = HTML2PDF_URL;
            script.onload = resolve;
            script.onerror = () => reject(new UserError("PDF biblioteka nije učitana. Proverite internet."));
            doc.head.appendChild(script);
        });
        await Promise.all([...doc.images].map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));

        // Sadržaj body-ja u omotač, da pravila za html/body (širina, overflow) ne seku PDF.
        const root = doc.createElement("div");
        while(doc.body.firstChild) root.appendChild(doc.body.firstChild);
        doc.body.appendChild(root);

        return await frame.contentWindow.html2pdf().set({
            margin,
            image: { type: "jpeg", quality: 0.98 },
            html2canvas: { scale: 2, backgroundColor: "#ffffff", useCORS: true },
            jsPDF: { unit: "mm", format: "a4", orientation },
            pagebreak: { mode: ["css", "legacy"] }
        }).from(root).outputPdf("blob");
    }finally{
        wrap.remove();
    }
}
