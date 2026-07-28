// Supabase Edge Function: confirm-toss-payment
// 클라이언트가 토스 결제창에서 돌아오면 {orderId, paymentKey, amount}를 보낸다.
// 여기서 토스 승인(confirm) API를 서버측 비밀키로 호출하고, 성공하면
// 결제 주문(toss_orders)을 완료 처리하고 수강권/수강료 등록을 자동으로 반영한다.
// 필요한 시크릿: TOSS_SECRET_KEY (Supabase 대시보드에서 설정)
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY는 Supabase가 자동으로 넣어줌.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function sbHeaders(extra: Record<string, string> = {}) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, ...extra };
}

function ymAdd(ym: string, delta: number) {
  let [y, m] = ym.split("-").map(Number);
  m += delta;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function computePaymentMonths(payDate: string, months: number) {
  const startYM = payDate.slice(0, 7);
  const out: string[] = [];
  for (let i = 0; i < months; i++) out.push(ymAdd(startYM, i));
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const jsonRes = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  try {
    const { orderId, paymentKey, amount } = await req.json();
    if (!orderId || !paymentKey || !amount) {
      return jsonRes({ error: "orderId, paymentKey, amount가 필요합니다" }, 400);
    }

    // 1) 대기중인 주문 조회
    const orderRes = await fetch(
      `${supabaseUrl}/rest/v1/toss_orders?order_id=eq.${encodeURIComponent(orderId)}&status=eq.pending&select=*`,
      { headers: sbHeaders() },
    );
    const orders = await orderRes.json();
    const order = (orders || [])[0];
    if (!order) {
      return jsonRes({ error: "대기중인 주문을 찾을 수 없습니다" }, 400);
    }

    // 2) 금액 위변조 방지 — 주문 생성 시 저장해둔 금액과 실제 결제 금액이 같은지 확인
    if (Number(order.amount) !== Number(amount)) {
      return jsonRes({ error: "결제 금액이 주문 금액과 일치하지 않습니다" }, 400);
    }

    // 3) 토스페이먼츠 결제 승인 API 호출
    const secretKey = Deno.env.get("TOSS_SECRET_KEY");
    if (!secretKey) {
      return jsonRes({ error: "TOSS_SECRET_KEY가 설정되지 않았습니다" }, 500);
    }
    const basicAuth = "Basic " + btoa(secretKey + ":");
    const tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: { Authorization: basicAuth, "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, paymentKey, amount }),
    });
    const tossData = await tossRes.json();

    if (!tossRes.ok || tossData.status !== "DONE") {
      await fetch(`${supabaseUrl}/rest/v1/toss_orders?order_id=eq.${encodeURIComponent(orderId)}`, {
        method: "PATCH",
        headers: sbHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ status: "failed" }),
      });
      return jsonRes({ error: tossData.message || "결제 승인에 실패했습니다" }, 400);
    }

    // 4) 주문 완료 처리
    await fetch(`${supabaseUrl}/rest/v1/toss_orders?order_id=eq.${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      headers: sbHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ status: "paid", payment_key: paymentKey, paid_at: new Date().toISOString() }),
    });

    const today = new Date().toISOString().slice(0, 10);

    if (order.product_type === "course") {
      // 온라인 강의 수강권 자동 부여 (1년 접근권)
      const expires = new Date();
      expires.setFullYear(expires.getFullYear() + 1);
      const expiresAt = expires.toISOString().slice(0, 10);

      const exRes = await fetch(
        `${supabaseUrl}/rest/v1/course_subscriptions?student_id=eq.${order.student_id}&course_id=eq.${order.course_id}&course_type=eq.일반&select=id`,
        { headers: sbHeaders() },
      );
      const existing = await exRes.json();

      if (existing?.[0]?.id) {
        await fetch(`${supabaseUrl}/rest/v1/course_subscriptions?id=eq.${existing[0].id}`, {
          method: "PATCH",
          headers: sbHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ starts_at: today, expires_at: expiresAt, payment_memo: "토스페이먼츠 결제" }),
        });
      } else {
        await fetch(`${supabaseUrl}/rest/v1/course_subscriptions`, {
          method: "POST",
          headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
          body: JSON.stringify({
            student_id: order.student_id,
            course_id: order.course_id,
            starts_at: today,
            expires_at: expiresAt,
            payment_memo: "토스페이먼츠 결제",
            granted_by: order.student_id,
            course_type: "일반",
            plan: "1년",
          }),
        });
      }
    } else if (order.product_type === "enrollment") {
      // 수강료 결제 → payments 기록 + 해당 개월 enrollments 자동 등록
      const months = order.months || 1;
      await fetch(`${supabaseUrl}/rest/v1/payments`, {
        method: "POST",
        headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
        body: JSON.stringify({
          student_id: order.student_id,
          amount: order.amount,
          pay_date: today,
          months,
          memo: "토스페이먼츠 자동결제",
        }),
      });
      for (const ym of computePaymentMonths(today, months)) {
        const exRes = await fetch(
          `${supabaseUrl}/rest/v1/enrollments?student_id=eq.${order.student_id}&year_month=eq.${ym}&select=id`,
          { headers: sbHeaders() },
        );
        const existing = await exRes.json();
        if (existing?.[0]?.id) {
          await fetch(`${supabaseUrl}/rest/v1/enrollments?id=eq.${existing[0].id}`, {
            method: "PATCH",
            headers: sbHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ enrolled: true }),
          });
        } else {
          await fetch(`${supabaseUrl}/rest/v1/enrollments`, {
            method: "POST",
            headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
            body: JSON.stringify({ student_id: order.student_id, year_month: ym, enrolled: true }),
          });
        }
      }
    }

    return jsonRes({ success: true });
  } catch (e) {
    return jsonRes({ error: String(e) }, 500);
  }
});
