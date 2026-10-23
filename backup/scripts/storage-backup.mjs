// Preuzima sve fajlove iz Storage bucket-a u lokalni folder: <out>/<bucket>/<putanja>.
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node storage-backup.mjs <out>
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const BUCKETS = ["documents", "receipts", "statements"];
const out = process.argv[2] || "storage";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function list(bucket, prefix = ""){
    const paths = [];
    for(let offset = 0; ; offset += 1000){
        const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000, offset });
        if(error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
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
    await Promise.all(Array.from({ length: 6 }, async () => {
        while(queue.length){
            const p = queue.shift();
            let data, error;
            for(let i = 0; i < 3; i++){
                ({ data, error } = await sb.storage.from(bucket).download(p));
                if(!error) break;
            }
            if(error) throw new Error(`${bucket}/${p}: ${error.message}`);
            const buf = Buffer.from(await data.arrayBuffer());
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
