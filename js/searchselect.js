// Padajući meni sa pretragom: preko postojećeg <select> stavlja polje u koje se kuca, a lista se filtrira.
// <select> ostaje u DOM-u (vizuelno sakriven) i i dalje je izvor vrednosti: izbor postavlja select.value
// i šalje "change", pa postojeći kod (onchange, .value) radi bez izmena.
const norm = (v) => String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "dj");

export function makeSearchable(select){
    if(!select || select.dataset.searchable) return;
    select.dataset.searchable = "1";
    select.classList.add("ss-native");

    const wrap = document.createElement("div");
    wrap.className = "ss";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "ss-input";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "false");
    const list = document.createElement("div");
    list.className = "ss-list";
    list.setAttribute("role", "listbox");
    list.hidden = true;
    select.after(wrap);
    wrap.append(input, list);

    let matches = [];
    let active = -1;

    const placeholder = () => [...select.options].find(o => o.value === "")?.textContent || "Izaberite…";
    const sync = () => {
        const opt = select.selectedOptions[0];
        input.value = opt && opt.value !== "" ? opt.textContent : "";
        input.placeholder = placeholder() + " — kucajte za pretragu";
        input.disabled = select.disabled;
    };

    function render(){
        const q = norm(input.value.trim());
        matches = [...select.options].filter(o => o.value !== "" && (!q || norm(o.textContent).includes(q)));
        active = matches.length ? 0 : -1;
        list.innerHTML = "";
        if(!matches.length){
            const empty = document.createElement("div");
            empty.className = "ss-empty";
            empty.textContent = "Nema rezultata";
            list.append(empty);
        }
        matches.forEach((o, i) => {
            const item = document.createElement("div");
            item.className = "ss-item" + (i === active ? " active" : "") + (o.value === select.value ? " selected" : "");
            item.setAttribute("role", "option");
            item.textContent = o.textContent;
            item.addEventListener("mousedown", (e) => { e.preventDefault(); choose(o); });
            list.append(item);
        });
    }
    function open(){ render(); list.hidden = false; input.setAttribute("aria-expanded", "true"); }
    function close(){ list.hidden = true; input.setAttribute("aria-expanded", "false"); }
    function highlight(i){
        const items = list.querySelectorAll(".ss-item");
        if(!items.length) return;
        active = (i + items.length) % items.length;
        items.forEach((el, k) => el.classList.toggle("active", k === active));
        items[active].scrollIntoView({ block: "nearest" });
    }
    function choose(o){
        select.value = o.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        sync();
        close();
    }

    input.addEventListener("focus", () => { input.select(); open(); });
    input.addEventListener("input", open);
    input.addEventListener("blur", () => { close(); sync(); });
    input.addEventListener("keydown", (e) => {
        if(e.key === "ArrowDown"){ e.preventDefault(); list.hidden ? open() : highlight(active + 1); }
        else if(e.key === "ArrowUp"){ e.preventDefault(); highlight(active - 1); }
        else if(e.key === "Enter"){ if(!list.hidden && matches[active]){ e.preventDefault(); choose(matches[active]); } }
        else if(e.key === "Escape"){ if(!list.hidden){ e.preventDefault(); e.stopPropagation(); close(); sync(); } }
    });
    select.addEventListener("change", sync);
    // Nove opcije (učitavanje liste) ili programsko postavljanje vrednosti preko select.value = "".
    new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    select.searchSync = sync;
    sync();
}

export function focusSearchable(select){
    const input = select?.nextElementSibling?.querySelector?.(".ss-input");
    (input || select)?.focus();
}
