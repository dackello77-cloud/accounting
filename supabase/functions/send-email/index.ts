// M4: send-email — Gmail SMTP smtp.gmail.com:465 (SSL), spec. odeljak 4.4.
// Secrets: GMAIL_USER, GMAIL_APP_PASSWORD; na DEV-u i TEST_EMAIL_TO (svi mejlovi samo tamo, naslov sa [TEST]).
// SUPABASE_URL, SUPABASE_ANON_KEY i SUPABASE_SERVICE_ROLE_KEY Supabase postavlja sam.
import nodemailer from "npm:nodemailer@6.9.16";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const KINDS: Record<string, string> = { faktura: "invoices", obracun_r: "payroll_r", obracun_k: "payroll_k" };
const BUCKETS = ["receipts", "documents", "statements"];
const MAX_ATTACHMENTS = 5;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// Uklanja <script> i on* atribute iz HTML-a mejla.
function sanitizeHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Dozvoljen je samo POST" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });

  const { data: userData } = await userClient.auth.getUser();
  const { data: active } = await userClient.rpc("is_active_user");
  if (!userData?.user || active !== true) return json({ error: "Nemate pristup" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Neispravan zahtev" }, 400);
  }

  const to = Array.isArray(body.to) ? body.to.map((x) => String(x).trim()).filter(Boolean) : [];
  const subject = String(body.subject ?? "").trim();
  const html = String(body.html ?? "");
  const kind = String(body.kind ?? "");
  const recordId = body.record_id ? String(body.record_id) : null;
  const attachments = Array.isArray(body.attachments) ? body.attachments as Record<string, string>[] : [];

  if (!to.length) return json({ error: "Dodajte bar jednog primaoca." }, 400);
  if (!subject || !html) return json({ error: "Nedostaje naslov ili sadržaj mejla." }, 400);
  if (!(kind in KINDS)) return json({ error: "Nepoznata vrsta mejla." }, 400);
  if (attachments.length > MAX_ATTACHMENTS) return json({ error: "Previše priloga." }, 400);

  // Svaka adresa mora postojati u email_recipients.
  const { data: recipients, error: recError } = await userClient.from("email_recipients").select("email");
  if (recError) return json({ error: "Greška pri čitanju liste primalaca." }, 500);
  const known = new Set((recipients ?? []).map((r) => String(r.email).toLowerCase()));
  const unknown = to.filter((email) => !known.has(email.toLowerCase()));
  if (unknown.length) return json({ error: "Adresa nije u listi primalaca: " + unknown.join(", ") }, 400);

  // Prilozi iz Storage-a, preuzeti sa pravima korisnika (RLS).
  const files = [];
  for (const a of attachments) {
    const bucket = String(a.bucket ?? "");
    const path = String(a.path ?? "");
    if (!BUCKETS.includes(bucket) || !path) return json({ error: "Neispravan prilog." }, 400);
    const { data, error } = await userClient.storage.from(bucket).download(path);
    if (error || !data) return json({ error: "Prilog nije pronađen: " + (a.filename || path) }, 400);
    files.push({
      filename: String(a.filename || path.split("/").pop()),
      content: new Uint8Array(await data.arrayBuffer()),
      contentType: data.type || "application/pdf",
    });
  }

  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!gmailUser || !gmailPassword) return json({ error: "Gmail nije podešen (GMAIL_USER / GMAIL_APP_PASSWORD)." }, 500);

  const testTo = Deno.env.get("TEST_EMAIL_TO");
  let finalTo = to;
  let finalSubject = subject;
  let finalHtml = sanitizeHtml(html);
  if (testTo) {
    finalTo = [testTo];
    finalSubject = "[TEST] " + subject;
    finalHtml = '<div style="font-family:Arial,sans-serif;background:#fef3c7;border:1px solid #f59e0b;padding:10px 14px;margin-bottom:12px;">'
      + "<strong>TEST</strong> — pravi primaoci: " + escapeHtml(to.join(", ")) + "</div>" + finalHtml;
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailPassword },
  });

  try {
    await transporter.sendMail({
      from: '"M&M Safety" <' + gmailUser + ">",
      to: finalTo.join(", "),
      subject: finalSubject,
      html: finalHtml,
      attachments: [
        ...files,
        { filename: "logo.png", content: LOGO_PNG_BASE64, encoding: "base64", cid: "mmlogo" },
      ],
    });
  } catch (error) {
    console.error("SMTP", error);
    return json({ error: "Gmail je odbio slanje: " + (error instanceof Error ? error.message : String(error)) }, 502);
  }

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  await admin.from("audit_log").insert({
    user_id: userData.user.id,
    action: "send_email",
    table_name: KINDS[kind],
    record_id: recordId,
    details: { kind, to, sent_to: finalTo, subject: finalSubject, attachments: attachments.map((a) => a.path), test: !!testTo },
  });

  return json({ ok: true, test: !!testTo, sent_to: finalTo });
});

const LOGO_PNG_BASE64 = "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";
