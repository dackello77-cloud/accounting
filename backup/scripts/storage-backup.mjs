// Preuzima sve fajlove iz Storage bucket-a u lokalni folder: <out>/<bucket>/<putanja>.
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node storage-backup.mjs <out>
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const BUCKETS = ["documents", "receipts", "statements"];
const out = process.argv[2] || "storage";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Mali (nano) projekat ume da odbije pri navali zahteva ("Too many connections"): ponovi sa pauzom.
async function retry(fn, what){
    let last;
    for(let attempt = 1; attempt <= 6; attempt++){
        try{
            const { data, error } = await fn();
            if(!error) return data;
            last = error;
        }catch(e){ last = e; }               // prekinuta veza (ECONNRESET) usred preuzimanja
        await new Promise(r => setTimeout(r, attempt * 2000));
    }
    throw new Error(`${what}: ${last.message}`);
}

async function list(bucket, prefix = ""){
    const paths = [];
    for(let offset = 0; ; offset += 1000){
        const data = await retry(() => sb.storage.from(bucket).list(prefix, { limit: 1000, offset }), `${bucket}/${prefix}`);
        for(const f of data){
            const p = prefix ? `${prefix}/${f.name}` : f.name;
            if(f.id) paths.push(p); else paths.push(...await list(bucket, p));
        }
        if(data.length < 1000) break;
    }
    return paths;
}

let total = 0, bytes = 0;
for(const bucket of BUCKETS){
    const paths = await list(bucket);
    const queue = [...paths];
    await Promise.all(Array.from({ length: 3 }, async () => {
        while(queue.length){
            const p = queue.shift();
            const buf = await retry(async () => {
                const { data, error } = await sb.storage.from(bucket).download(p);
                return error ? { error } : { data: Buffer.from(await data.arrayBuffer()) };
            }, `${bucket}/${p}`);
            const target = join(out, bucket, p);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, buf);
            bytes += buf.length;
        }
    }));
    console.log(`${bucket}: ${paths.length}`);
    total += paths.length;
}
console.log(`Ukupno: ${total} fajlova, ${(bytes / 1048576).toFixed(1)} MB`);
if(total === 0) throw new Error("Nijedan fajl — proveriti ključ i projekat");
