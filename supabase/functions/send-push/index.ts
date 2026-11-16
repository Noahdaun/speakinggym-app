// Supabase Edge Function: send-push
// {user_id, title, body} 를 받아서, 그 사용자가 구독해둔 모든 기기로 웹 푸시 알림을 보낸다.
// VAPID_PRIVATE_KEY만 시크릿으로 설정하면 됨 — SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY는 Supabase가 자동으로 넣어줌.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import webpush from "npm:web-push@3.6.7";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VAPID_PUBLIC_KEY = "BJE3HgXlhVQ6bYbg94Nemv2vtP8NGecr6b6bJ8Wz2kadYd1EXkvwM9FnygNA8W8aBnaz0RIQfdWTlprmdXDWveY";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const jsonErr = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), {
      status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  try {
    const { user_id, title, body, url } = await req.json();
    if (!user_id || !body) {
      return jsonErr(400, "user_id, body가 필요합니다");
    }
    // 필터 주입 방지: user_id는 UUID 형식만 허용
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(user_id))) {
      return jsonErr(400, "user_id 형식이 올바르지 않습니다");
    }

    // ── 보낸 사람 확인: 공개 키(anon)만으로는 호출 불가, 로그인한 사용자의 토큰이 있어야 함 ──
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const sUrl = Deno.env.get("SUPABASE_URL")!;
    const sKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const aKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const meRes = await fetch(`${sUrl}/auth/v1/user`, { headers: { apikey: aKey, Authorization: `Bearer ${token}` } });
    if (!token || !meRes.ok) return jsonErr(401, "로그인이 필요합니다");
    const me = await meRes.json();
    if (!me?.id) return jsonErr(401, "로그인이 필요합니다");

    const svc = { apikey: sKey, Authorization: `Bearer ${sKey}` };
    const meProf = await (await fetch(`${sUrl}/rest/v1/profiles?id=eq.${me.id}&select=role`, { headers: svc })).json();
    const isAdmin = meProf?.[0]?.role === "admin";
    if (!isAdmin) {
      // 학생은 원장님(관리자)에게만 알림을 보낼 수 있음 (질문 메시지 알림용)
      const target = await (await fetch(`${sUrl}/rest/v1/profiles?id=eq.${user_id}&role=eq.admin&select=id`, { headers: svc })).json();
      if (!target?.length) return jsonErr(403, "보낼 수 없는 대상입니다");
    }
    // 알림 클릭 시 이동 주소는 우리 앱 안으로만 허용, 길이도 제한
    const safeUrl = typeof url === "string" && url.startsWith("/speakinggym-app/") ? url : "/speakinggym-app/";
    const safeTitle = String(title ?? "Speaking Gym").slice(0, 80);
    const safeBody = String(body).slice(0, 300);

    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!vapidPrivateKey) {
      return new Response(JSON.stringify({ error: "VAPID_PRIVATE_KEY가 설정되지 않았습니다" }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    webpush.setVapidDetails("mailto:noreply@speakinggym.app", VAPID_PUBLIC_KEY, vapidPrivateKey);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const subsRes = await fetch(
      `${supabaseUrl}/rest/v1/push_subscriptions?user_id=eq.${user_id}&select=*`,
      { headers: { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}` } },
    );
    const subs = await subsRes.json();

    const payload = JSON.stringify({
      title: safeTitle,
      body: safeBody,
      url: safeUrl,
    });

    const results = await Promise.allSettled(
      (subs || []).map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          );
        } catch (err) {
          // 구독이 만료/취소됐으면(410/404) 정리해서 다음부터 재시도 안 하게 함
          const statusCode = (err as { statusCode?: number })?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?id=eq.${s.id}`, {
              method: "DELETE",
              headers: { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}` },
            });
          }
          throw err;
        }
      }),
    );

    return new Response(JSON.stringify({ targeted: (subs || []).length, results: results.length }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
