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
