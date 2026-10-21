-- plan_catalog.description já existe (migration admin-planos-sync).
-- Refresh seed de descrição (idempotente) — Euzim zlzgkivktvnyvehjwcjw

update public.plan_catalog
set
  description = '2 personagens e 2 histórias por mês para começar a aventura.',
  updated_at = now()
where plan_key = 'starter';

update public.plan_catalog
set
  description = '2 avatares e 5 histórias por mês para criar com regularidade.',
  updated_at = now()
where plan_key = 'family';

update public.plan_catalog
set
  description = '2 avatares e 10 histórias por mês para criar sem freio.',
  updated_at = now()
where plan_key = 'plus';
