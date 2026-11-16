// فنجان — دالة إرسال إشعارات الموبايل لكل الموظفين.
// تتنفذ على Supabase Edge Functions. محتاجة الأسرار: VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VPUB = Deno.env.get("VAPID_PUBLIC")!;
const VPRIV = Deno.env.get("VAPID_PRIVATE")!;
const VSUB = Deno.env.get("VAPID_SUBJECT") || "mailto:owner@fenjan.app";
webpush.setVapidDetails(VSUB, VPUB, VPRIV);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("method", { status: 405, headers: cors });
  const auth = req.headers.get("Authorization") || "";

  // لازم اللي بيبعت يكون إدارة
  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data: staff } = await asUser.rpc("is_staff");
  if (!staff) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });

  const { body } = await req.json().catch(() => ({ body: "" }));
  const admin = createClient(URL, SERVICE);
  const { data: subs } = await admin.from("push_subscriptions").select("endpoint, sub");
  const payload = JSON.stringify({ title: "فنجان — إعلان", body: String(body || "").slice(0, 180) });

  let sent = 0;
  await Promise.all((subs || []).map(async (s: any) => {
    try { await webpush.sendNotification(s.sub, payload); sent++; }
    catch (e: any) { const c = e?.statusCode; if (c === 404 || c === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint); }
  }));
  return new Response(JSON.stringify({ sent }), { headers: { ...cors, "Content-Type": "application/json" } });
});
