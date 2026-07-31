-- 스케줄러(scheduler.html)용 테이블 — Supabase SQL Editor에서 전체 실행
-- 새 테이블만 추가하며, 기존 학생관리 앱이 쓰는 테이블은 전혀 건드리지 않습니다.

create table if not exists scheduler_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  memo text,
  all_day boolean not null default false,
  start_date date not null,
  end_date date not null,
  start_time time,
  end_time time,
  color text not null default '#1D9E75',
  repeat_type text not null default 'none' check (repeat_type in ('none','daily','weekly','monthly','yearly')),
  repeat_until date,
  repeat_days text,
  skip_holidays boolean not null default false,
  repeat_exceptions text,
  created_at timestamptz not null default now()
);
alter table scheduler_events add column if not exists repeat_type text not null default 'none';
alter table scheduler_events add column if not exists repeat_until date;
alter table scheduler_events add column if not exists repeat_days text;
alter table scheduler_events add column if not exists skip_holidays boolean not null default false;
alter table scheduler_events add column if not exists repeat_exceptions text;

create index if not exists idx_scheduler_events_range on scheduler_events (start_date, end_date);

alter table scheduler_events enable row level security;

drop policy if exists "scheduler_events_select" on scheduler_events;
drop policy if exists "scheduler_events_insert" on scheduler_events;
drop policy if exists "scheduler_events_update" on scheduler_events;
drop policy if exists "scheduler_events_delete" on scheduler_events;
create policy "scheduler_events_select" on scheduler_events for select using (true);
create policy "scheduler_events_insert" on scheduler_events for insert with check (true);
create policy "scheduler_events_update" on scheduler_events for update using (true);
create policy "scheduler_events_delete" on scheduler_events for delete using (true);

-- 일간/주간/월간 목표 체크리스트
create table if not exists scheduler_goals (
  id uuid primary key default gen_random_uuid(),
  period_type text not null check (period_type in ('day','week','month')),
  period_key text not null, -- day: 'YYYY-MM-DD', week: 그 주 일요일 날짜, month: 'YYYY-MM'
  text text not null,
  done boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_scheduler_goals_period on scheduler_goals (period_type, period_key);

alter table scheduler_goals enable row level security;

drop policy if exists "scheduler_goals_select" on scheduler_goals;
drop policy if exists "scheduler_goals_insert" on scheduler_goals;
drop policy if exists "scheduler_goals_update" on scheduler_goals;
drop policy if exists "scheduler_goals_delete" on scheduler_goals;
create policy "scheduler_goals_select" on scheduler_goals for select using (true);
create policy "scheduler_goals_insert" on scheduler_goals for insert with check (true);
create policy "scheduler_goals_update" on scheduler_goals for update using (true);
create policy "scheduler_goals_delete" on scheduler_goals for delete using (true);
