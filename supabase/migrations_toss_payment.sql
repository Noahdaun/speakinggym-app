-- 토스페이먼츠 연동을 위한 스키마 추가
-- Supabase 대시보드 > SQL Editor 에서 이 파일 내용을 그대로 실행하세요.

-- 1) 반(class)별 고정 월 수강료
alter table classes add column if not exists price integer;

-- 2) 결제 주문 테이블 (온라인강의 구매 / 수강료 결제 공용)
create table if not exists toss_orders (
  id uuid primary key default gen_random_uuid(),
  order_id text unique not null,
  student_id uuid not null references profiles(id),
  product_type text not null check (product_type in ('enrollment','course')),
  course_id uuid references online_courses(id),
  months int,
  amount integer not null,
  order_name text not null,
  status text not null default 'pending' check (status in ('pending','paid','failed')),
  payment_key text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

alter table toss_orders enable row level security;

-- 학생 본인이 자기 주문을 만들 수 있음 (금액은 서버에서 검증하므로 여기선 자유롭게 생성 가능)
drop policy if exists "students insert own pending order" on toss_orders;
create policy "students insert own pending order" on toss_orders
  for insert to authenticated
  with check (student_id = auth.uid() and status = 'pending');

-- 학생 본인 주문만 조회 가능
drop policy if exists "students select own orders" on toss_orders;
create policy "students select own orders" on toss_orders
  for select to authenticated
  using (student_id = auth.uid());

-- update/delete 정책 없음: 결제 확정(status 변경)은 edge function(service role)만 수행
