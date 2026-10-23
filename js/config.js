// Javni podaci projekata (publishable ključ je javan po dizajnu).
// Objavljena aplikacija (GitHub Pages) radi na PROD-u; localhost (razvoj i testovi) na DEV-u,
// osim uz ?env=prod (provera prod-a sa računara pre objave).
const PROJECTS = {
    prod: { url: "https://gpobgnrorinvrjzyhuif.supabase.co", key: "sb_publishable_bwOjBfk4QIomIfTkwC6bxg_nrSEqIDL" },
    dev:  { url: "https://qflpgxonpkzgcdbrolfz.supabase.co", key: "sb_publishable_sSvSEDRaishEcmoCiDfE9w_cBost7_D" }
};
const isLocal = ["localhost", "127.0.0.1", ""].includes(location.hostname);
export const ENV = isLocal && new URLSearchParams(location.search).get("env") !== "prod" ? "dev" : "prod";
export const SUPABASE_URL = PROJECTS[ENV].url;
export const SUPABASE_ANON_KEY = PROJECTS[ENV].key;
