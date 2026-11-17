// فنجان — دالة إرسال إشعارات الموبايل لكل الموظفين (نسخة مُحسّنة بتقارير أخطاء).
// Supabase Edge Functions. الأسرار المطلوبة: VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VPUB = Deno.env.get("VAPID_PUBLIC") || "";
const VPRIV = Deno.env.get("VAPID_PRIVATE") || "";
const VSUB = Deno.env.get("VAPID_SUBJECT") || "mailto:owner@fenjan.app";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  if (!VPUB || !VPRIV) return json({ error: "missing_vapid", note: "تأكد إن VAPID_PUBLIC و VAPID_PRIVATE متحطين في Secrets" });
  try { webpush.setVapidDetails(VSUB, VPUB, VPRIV); }
  catch (e) { return json({ error: "vapid_setup", detail: String((e as Error)?.message || e) }); }

  // لازم اللي بيبعت يكون إدارة
  const auth = req.headers.get("Authorization") || "";
  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data: staff, error: staffErr } = await asUser.rpc("is_staff");
  if (staffErr) return json({ error: "auth", detail: staffErr.message });
  if (!staff) return json({ error: "forbidden", note: "لازم تكون داخل بحساب إدارة" });

  const { body } = await req.json().catch(() => ({ body: "" }));
  const admin = createClient(URL, SERVICE);
  const { data: subs, error: subErr } = await admin.from("push_subscriptions").select("endpoint, sub");
  if (subErr) return json({ error: "db", detail: subErr.message });
  const total = (subs || []).length;
  if (!total) return json({ total: 0, sent: 0, failed: 0, note: "مفيش اشتراكات — لازم الموظفين يفعّلوا الإشعارات الأول" });

  const payload = JSON.stringify({ title: "فنجان — إعلان", body: String(body || "").slice(0, 180) });
  let sent = 0, failed = 0, sample_error = "";
  await Promise.all((subs || []).map(async (s: any) => {
    try { await webpush.sendNotification(s.sub, payload); sent++; }
    catch (e: any) {
      failed++;
      const c = e?.statusCode;
      if (!sample_error) sample_error = `${c || ""} ${e?.body || e?.message || String(e)}`.slice(0, 220);
      if (c === 404 || c === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
    }
  }));
  return json({ total, sent, failed, sample_error });
});
