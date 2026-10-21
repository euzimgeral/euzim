-- Admin Planos + pontos de indicação (Euzim / zlzgkivktvnyvehjwcjw)
-- Idempotente. Não alterar Best Piece.

-- 1) Catálogo editável dos 3 planos
create table if not exists public.plan_catalog (
  plan_key text primary key
    check (plan_key in ('starter', 'family', 'plus')),
  name text not null,
  price_cents integer not null check (price_cents > 0),
  stories_per_month integer not null check (stories_per_month > 0),
  avatars_included integer not null check (avatars_included >= 0),
  extra_story_cents integer not null check (extra_story_cents > 0),
  extra_avatar_cents integer not null check (extra_avatar_cents > 0),
  gift_points_first integer not null default 0
    check (gift_points_first >= 0),
  gift_points_recur integer not null default 0
    check (gift_points_recur >= 0),
  stripe_price_id_live text,
  stripe_price_id_test text,
  stripe_product_id_live text,
  stripe_product_id_test text,
  description text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.plan_catalog is
  'Fonte da verdade dos planos Euzim (Admin → Planos). Sync Stripe live+test no Salvar.';

-- 2) Saldo de pontos do indicador (1pt = 1 história; 2pt = 1 avatar)
alter table public.users
  add column if not exists referral_points integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_referral_points_nonneg'
  ) then
    alter table public.users
      add constraint users_referral_points_nonneg
      check (referral_points >= 0);
  end if;
end $$;

-- 3) Ledger idempotente (first/recur / redeem)
create table if not exists public.referral_points_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  delta integer not null,
  reason text not null,
  source_key text not null,
  plan_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint referral_points_ledger_user_source unique (user_id, source_key)
);

create index if not exists referral_points_ledger_user_idx
  on public.referral_points_ledger (user_id, created_at desc);

-- 4) Seed a partir dos valores atuais + pontos derivados dos gifts
-- starter gifts: 2 hist XOR 1 avatar → 2 pts
-- family/plus gifts: 4 hist XOR 2 avatars XOR (1+2) → 4 pts
-- recur: mesmo valor (assinatura recorrente do indicado)
insert into public.plan_catalog (
  plan_key,
  name,
  price_cents,
  stories_per_month,
  avatars_included,
  extra_story_cents,
  extra_avatar_cents,
  gift_points_first,
  gift_points_recur,
  stripe_price_id_live,
  stripe_product_id_live,
  description,
  sort_order
) values
  (
    'starter',
    'Para Aventureiros',
    2490,
    2,
    2,
    1190,
    990,
    2,
    2,
    'price_1URZD42RGWYUXReL1LuaJkHI',
    'prod_VSUBri2FlAVcly',
    '2 personagens e 2 histórias por mês para começar a aventura.',
    1
  ),
  (
    'family',
    'Para Realizadores',
    4990,
    5,
    2,
    990,
    990,
    4,
    4,
    'price_1URZD42RGWYUXReLwWbPWFkf',
    'prod_VSUBYLdM2LhWTn',
    '2 avatares e 5 histórias por mês para criar com regularidade.',
    2
  ),
  (
    'plus',
    'Para Exploradores Plus',
    7990,
    10,
    2,
    790,
    990,
    4,
    4,
    'price_1USgrd2RGWYUXReLZ2xl5DpA',
    'prod_VTe94QxabUnvqm',
    '2 avatares e 10 histórias por mês para criar sem freio.',
    3
  )
on conflict (plan_key) do update set
  name = excluded.name,
  price_cents = excluded.price_cents,
  stories_per_month = excluded.stories_per_month,
  avatars_included = excluded.avatars_included,
  extra_story_cents = excluded.extra_story_cents,
  extra_avatar_cents = excluded.extra_avatar_cents,
  gift_points_first = excluded.gift_points_first,
  gift_points_recur = excluded.gift_points_recur,
  stripe_price_id_live = coalesce(
    public.plan_catalog.stripe_price_id_live,
    excluded.stripe_price_id_live
  ),
  stripe_product_id_live = coalesce(
    public.plan_catalog.stripe_product_id_live,
    excluded.stripe_product_id_live
  ),
  description = excluded.description,
  sort_order = excluded.sort_order,
  updated_at = now();

-- RLS: leitura pública do catálogo (landing); escrita só service role / admin API
alter table public.plan_catalog enable row level security;

drop policy if exists plan_catalog_select_all on public.plan_catalog;
create policy plan_catalog_select_all
  on public.plan_catalog
  for select
  to anon, authenticated
  using (true);

alter table public.referral_points_ledger enable row level security;

drop policy if exists referral_points_ledger_select_own on public.referral_points_ledger;
create policy referral_points_ledger_select_own
  on public.referral_points_ledger
  for select
  to authenticated
  using (user_id = auth.uid());
