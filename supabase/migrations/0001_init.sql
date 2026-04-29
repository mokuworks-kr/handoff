-- =============================================================================
-- Handoff 0001_init.sql
-- 모든 테이블 + RLS + deduct_credits 함수 + 신규 가입 자동 프로필 생성 트리거.
-- 스펙 §8 그대로.
--
-- 실행 방법:
--   1) Supabase 대시보드 > SQL Editor > New query
--   2) 이 파일 전체 붙여넣기 → Run
--   3) Storage 버킷은 0002_storage.sql 별도 실행
-- =============================================================================

-- 사용자 프로필 ---------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  display_name text,
  credit_balance bigint not null default 1000,
  created_at timestamptz default now()
);

-- 크레딧 거래 원장 ------------------------------------------------------------
create table if not exists credit_transactions (
  id bigserial primary key,
  user_id uuid not null references profiles(id),
  delta bigint not null,                          -- 양수=충전, 음수=차감
  type text not null,                             -- 'purchase' | 'usage' | 'refund' | 'bonus' | 'signup'
  related_project_id uuid,
  related_payment_id text,
  api_input_tokens int,
  api_output_tokens int,
  api_cache_read_tokens int,
  model text,
  raw_cost_usd numeric(10,6),
  metadata jsonb,
  idempotency_key text unique,                    -- 이중 차감 방지
  created_at timestamptz default now()
);

create index if not exists credit_transactions_user_idx
  on credit_transactions(user_id, created_at desc);

-- 디자인 프로젝트 -------------------------------------------------------------
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  title text not null default '제목 없음',
  thumbnail_url text,
  format jsonb not null,
  design_tokens jsonb,
  document jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists projects_user_idx on projects(user_id, updated_at desc);

-- 자동 저장된 버전 ------------------------------------------------------------
create table if not exists project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  document jsonb not null,
  message text,
  created_at timestamptz default now()
);

create index if not exists project_versions_idx
  on project_versions(project_id, created_at desc);

-- 자연어 수정 대화 내역 -------------------------------------------------------
create table if not exists project_chats (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  role text not null,
  content text not null,
  tool_calls jsonb,
  created_at timestamptz default now()
);

create index if not exists project_chats_idx on project_chats(project_id, created_at);

-- 출력 산출물 이력 ------------------------------------------------------------
create table if not exists exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  format text not null,                           -- 'pdf-print' | 'pdf-digital' | 'indesign-jsx' | 'illustrator-jsx'
  file_url text not null,
  created_at timestamptz default now()
);

-- 플립북 공유 링크 ------------------------------------------------------------
create table if not exists shares (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references profiles(id),
  token text unique not null,
  password_hash text,
  expires_at timestamptz,
  allow_download boolean default false,
  watermark_text text,
  view_count int not null default 0,
  document_snapshot jsonb not null,
  created_at timestamptz default now(),
  revoked_at timestamptz
);

create index if not exists shares_token_active_idx
  on shares(token) where revoked_at is null;
create index if not exists shares_user_idx on shares(user_id, created_at desc);

-- 플립북 조회 이벤트 ----------------------------------------------------------
create table if not exists share_views (
  id bigserial primary key,
  share_id uuid not null references shares(id) on delete cascade,
  visitor_id text not null,
  page_index int,
  duration_ms int,
  event_type text not null,                       -- 'open' | 'page_view' | 'download' | 'close'
  user_agent text,
  ip_country text,                                -- IP에서 국가만 (개인정보 최소화)
  created_at timestamptz default now()
);

create index if not exists share_views_idx on share_views(share_id, created_at desc);
create index if not exists share_views_visitor_idx on share_views(share_id, visitor_id);

-- =============================================================================
-- RLS
-- =============================================================================

alter table profiles enable row level security;
alter table credit_transactions enable row level security;
alter table projects enable row level security;
alter table project_versions enable row level security;
alter table project_chats enable row level security;
alter table exports enable row level security;
alter table shares enable row level security;
alter table share_views enable row level security;

-- 멱등 적용을 위해 drop-then-create 패턴
drop policy if exists "users read own profile" on profiles;
create policy "users read own profile" on profiles
  for select using (auth.uid() = id);

drop policy if exists "users update own profile" on profiles;
create policy "users update own profile" on profiles
  for update using (auth.uid() = id);

drop policy if exists "users read own transactions" on credit_transactions;
create policy "users read own transactions" on credit_transactions
  for select using (auth.uid() = user_id);
-- credit_transactions의 insert/update는 service_role만 (정책 없음 = 차단)

drop policy if exists "users crud own projects" on projects;
create policy "users crud own projects" on projects
  for all using (auth.uid() = user_id);

drop policy if exists "users crud own project versions" on project_versions;
create policy "users crud own project versions" on project_versions
  for all using (
    auth.uid() = (select user_id from projects where id = project_id)
  );

drop policy if exists "users crud own project chats" on project_chats;
create policy "users crud own project chats" on project_chats
  for all using (
    auth.uid() = (select user_id from projects where id = project_id)
  );

drop policy if exists "users read own exports" on exports;
create policy "users read own exports" on exports
  for select using (
    auth.uid() = (select user_id from projects where id = project_id)
  );

drop policy if exists "users crud own shares" on shares;
create policy "users crud own shares" on shares
  for all using (auth.uid() = user_id);

drop policy if exists "users read own share views" on share_views;
create policy "users read own share views" on share_views
  for select using (
    auth.uid() = (select user_id from shares where id = share_id)
  );

-- =============================================================================
-- 크레딧 차감 함수 (원자적 처리)
-- =============================================================================

create or replace function deduct_credits(
  p_user_id uuid,
  p_credits bigint,
  p_project_id uuid,
  p_input_tokens int,
  p_output_tokens int,
  p_cache_read_tokens int,
  p_model text,
  p_raw_cost_usd numeric,
  p_idempotency_key text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  -- 멱등성 체크
  if exists (select 1 from credit_transactions where idempotency_key = p_idempotency_key) then
    return;
  end if;

  -- 잔액 확인 + 잠금
  select credit_balance into v_balance
  from profiles where id = p_user_id
  for update;

  if v_balance is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  if v_balance < p_credits then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  -- 차감
  update profiles
  set credit_balance = credit_balance - p_credits
  where id = p_user_id;

  -- 원장 기록
  insert into credit_transactions (
    user_id, delta, type, related_project_id,
    api_input_tokens, api_output_tokens, api_cache_read_tokens,
    model, raw_cost_usd, idempotency_key
  ) values (
    p_user_id, -p_credits, 'usage', p_project_id,
    p_input_tokens, p_output_tokens, p_cache_read_tokens,
    p_model, p_raw_cost_usd, p_idempotency_key
  );
end;
$$;

-- service_role과 authenticated 모두 실행 가능 (단, 내부적으로 RLS 우회는 SECURITY DEFINER가 처리)
grant execute on function deduct_credits(uuid, bigint, uuid, int, int, int, text, numeric, text)
  to authenticated, service_role;

-- =============================================================================
-- 신규 가입 시 프로필 자동 생성 + 무료 크레딧 1,000 + signup 트랜잭션 기록
-- =============================================================================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_display_name text;
begin
  v_email := coalesce(new.email, '');
  v_display_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(v_email, '@', 1)
  );

  insert into profiles (id, email, display_name, credit_balance)
  values (new.id, v_email, v_display_name, 1000)
  on conflict (id) do nothing;

  -- 멱등키: 'signup:<user_id>' — 같은 유저에 대한 중복 보너스 방지
  insert into credit_transactions (
    user_id, delta, type, idempotency_key
  ) values (
    new.id, 1000, 'signup', 'signup:' || new.id::text
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
