// Vraća fajlove iz raspakovanog bekapa (<folder>/<bucket>/<putanja>) u Storage novog projekta.
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node storage-restore.mjs <folder>
import { createClient } from "@supabase/supabase-js";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, extname } from "path";

const MIME = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".heic": "image/heic", ".heif": "image/heif" };
const root = process.argv[2];
if(!root || !existsSync(root)) throw new Error("Navedite folder sa raspakovanim bekapom fajlova");
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function walk(dir, rel = ""){
    return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
        e.isDirectory() ? walk(join(dir, e.name), rel ? `${rel}/${e.name}` : e.name) : [rel ? `${rel}/${e.name}` : e.name]);
}

for(const bucket of readdirSync(root)){
    const files = walk(join(root, bucket));
    const queue = [...files];
    await Promise.all(Array.from({ length: 3 }, async () => {
        while(queue.length){
            const p = queue.shift();
            // Mali (nano) projekat ume da odbije pri navali zahteva: ponovi sa pauzom.
            let error;
            for(let attempt = 1; attempt <= 6; attempt++){
                ({ error } = await sb.storage.from(bucket).upload(p, readFileSync(join(root, bucket, p)),
                    { contentType: MIME[extname(p).toLowerCase()] || "application/octet-stream", upsert: true }));
                if(!error) break;
                await new Promise(r => setTimeout(r, attempt * 2000));
            }
            if(error) throw new Error(`${bucket}/${p}: ${error.message}`);
        }
    }));
    console.log(`${bucket}: ${files.length}`);
}
