-- Criação/Leitura UI — views, likes counters, pedidos de visibilidade em collab
-- Projeto: zlzgkivktvnyvehjwcjw only (NUNCA Best Piece)
-- Aplicar no SQL Editor do Management / Dashboard Euzim.

-- ---------------------------------------------------------------------------
-- Contadores denormalizados em stories
-- ---------------------------------------------------------------------------
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS like_count integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stories_view_count_check'
  ) THEN
    ALTER TABLE public.stories
      ADD CONSTRAINT stories_view_count_check CHECK (view_count >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stories_like_count_check'
  ) THEN
    ALTER TABLE public.stories
      ADD CONSTRAINT stories_like_count_check CHECK (like_count >= 0);
  END IF;
END $$;

-- Backfill likes a partir de story_likes
UPDATE public.stories s
SET like_count = COALESCE(c.cnt, 0)
FROM (
  SELECT story_id, COUNT(*)::integer AS cnt
  FROM public.story_likes
  GROUP BY story_id
) c
WHERE s.id = c.story_id;

-- ---------------------------------------------------------------------------
-- story_views — 1 linha por (story, viewer) para dedupe; anônimos por session
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.story_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES public.stories (id) ON DELETE CASCADE,
  viewer_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  session_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT story_views_viewer_or_session CHECK (
    viewer_id IS NOT NULL OR (session_key IS NOT NULL AND length(session_key) > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS story_views_story_viewer_uidx
  ON public.story_views (story_id, viewer_id)
  WHERE viewer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS story_views_story_session_uidx
  ON public.story_views (story_id, session_key)
  WHERE session_key IS NOT NULL AND viewer_id IS NULL;

CREATE INDEX IF NOT EXISTS story_views_story_idx
  ON public.story_views (story_id);

ALTER TABLE public.story_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS story_views_select_own_story ON public.story_views;
CREATE POLICY story_views_select_own_story
  ON public.story_views FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.stories s
      WHERE s.id = story_id
        AND (s.parent_id = auth.uid() OR private.is_admin())
    )
  );

DROP POLICY IF EXISTS story_views_insert_auth ON public.story_views;
CREATE POLICY story_views_insert_auth
  ON public.story_views FOR INSERT TO authenticated
  WITH CHECK (viewer_id IS NULL OR viewer_id = auth.uid());

GRANT SELECT, INSERT ON public.story_views TO authenticated;
GRANT ALL ON public.story_views TO service_role;

-- Sync like_count on insert/delete
CREATE OR REPLACE FUNCTION public.sync_story_like_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.stories
    SET like_count = like_count + 1
    WHERE id = NEW.story_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.stories
    SET like_count = GREATEST(0, like_count - 1)
    WHERE id = OLD.story_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS story_likes_sync_count ON public.story_likes;
CREATE TRIGGER story_likes_sync_count
  AFTER INSERT OR DELETE ON public.story_likes
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_story_like_count();

CREATE OR REPLACE FUNCTION public.sync_story_view_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.stories
  SET view_count = view_count + 1
  WHERE id = NEW.story_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS story_views_sync_count ON public.story_views;
CREATE TRIGGER story_views_sync_count
  AFTER INSERT ON public.story_views
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_story_view_count();

-- ---------------------------------------------------------------------------
-- Pedidos de mudança de visibilidade (collab)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.story_visibility_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES public.stories (id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  from_visibility text NOT NULL CHECK (from_visibility IN ('private', 'friends', 'public')),
  to_visibility text NOT NULL CHECK (to_visibility IN ('private', 'friends', 'public')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT story_visibility_requests_change CHECK (from_visibility IS DISTINCT FROM to_visibility)
);

CREATE TABLE IF NOT EXISTS public.story_visibility_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.story_visibility_requests (id) ON DELETE CASCADE,
  collaborator_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  decision text CHECK (decision IS NULL OR decision IN ('approved', 'rejected')),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, collaborator_id)
);

CREATE INDEX IF NOT EXISTS story_visibility_requests_story_idx
  ON public.story_visibility_requests (story_id, status);

CREATE INDEX IF NOT EXISTS story_visibility_approvals_collab_idx
  ON public.story_visibility_approvals (collaborator_id, decision);

ALTER TABLE public.story_visibility_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_visibility_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS svr_select_related ON public.story_visibility_requests;
CREATE POLICY svr_select_related
  ON public.story_visibility_requests FOR SELECT TO authenticated
  USING (
    requester_id = auth.uid()
    OR private.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.story_visibility_approvals a
      WHERE a.request_id = id AND a.collaborator_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS svr_insert_owner ON public.story_visibility_requests;
CREATE POLICY svr_insert_owner
  ON public.story_visibility_requests FOR INSERT TO authenticated
  WITH CHECK (
    requester_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.stories s
      WHERE s.id = story_id AND s.parent_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS svr_update_related ON public.story_visibility_requests;
CREATE POLICY svr_update_related
  ON public.story_visibility_requests FOR UPDATE TO authenticated
  USING (
    requester_id = auth.uid()
    OR private.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.story_visibility_approvals a
      WHERE a.request_id = id AND a.collaborator_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS sva_select_related ON public.story_visibility_approvals;
CREATE POLICY sva_select_related
  ON public.story_visibility_approvals FOR SELECT TO authenticated
  USING (
    collaborator_id = auth.uid()
    OR private.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.story_visibility_requests r
      WHERE r.id = request_id AND r.requester_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS sva_update_own ON public.story_visibility_approvals;
CREATE POLICY sva_update_own
  ON public.story_visibility_approvals FOR UPDATE TO authenticated
  USING (collaborator_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.story_visibility_requests TO authenticated;
GRANT SELECT, UPDATE ON public.story_visibility_approvals TO authenticated;
GRANT ALL ON public.story_visibility_requests TO service_role;
GRANT ALL ON public.story_visibility_approvals TO service_role;
