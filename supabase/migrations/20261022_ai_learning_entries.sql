-- Euzim — Admin Aprendizado (livros PDF + feedbacks → memória IA)
-- Projeto OBRIGATÓRIO: zlzgkivktvnyvehjwcjw
-- NÃO aplicar em Best Piece nem outro projeto.

-- ---------------------------------------------------------------------------
-- ai_learning_entries
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_learning_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('book', 'feedback')),
  title text NOT NULL DEFAULT '',
  added_by_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  added_by_email text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  error_message text,
  -- Livro
  source_filename text,
  storage_path text,
  page_count integer,
  -- Feedback
  source_feedback_id uuid REFERENCES public.story_page_feedback (id) ON DELETE SET NULL,
  story_id uuid REFERENCES public.stories (id) ON DELETE SET NULL,
  page_index integer,
  page_image_url text,
  page_text text,
  user_feedback text,
  -- IA
  ai_observation text,
  ai_summary text,
  ai_lessons jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT ai_learning_entries_page_index_nonneg CHECK (
    page_index IS NULL OR page_index >= 0
  )
);

CREATE INDEX IF NOT EXISTS ai_learning_entries_type_created_idx
  ON public.ai_learning_entries (type, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_learning_entries_status_idx
  ON public.ai_learning_entries (status, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_learning_entries_feedback_idx
  ON public.ai_learning_entries (source_feedback_id)
  WHERE source_feedback_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_learning_entries_ready_themes_idx
  ON public.ai_learning_entries (status)
  WHERE status = 'ready';

ALTER TABLE public.ai_learning_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_learning_entries_admin_all ON public.ai_learning_entries;
CREATE POLICY ai_learning_entries_admin_all
  ON public.ai_learning_entries
  FOR ALL
  TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_learning_entries TO authenticated;
GRANT ALL ON public.ai_learning_entries TO service_role;

-- Bucket Storage `learning` (privado) — criar via API se não existir.
-- Path canônico: books/{entryId}.pdf
