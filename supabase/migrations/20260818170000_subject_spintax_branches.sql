-- Per-content metadata for each top-level spintax group in the subject.
-- Used by the RPC to compute which branch a given lead received.
CREATE TABLE IF NOT EXISTS public.copy_content_spintax_groups (
  content_id uuid NOT NULL REFERENCES public.copy_contents(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'subject',
  group_index smallint NOT NULL,
  option_count smallint NOT NULL CHECK (option_count > 0),
  options_raw text NOT NULL,
  PRIMARY KEY (content_id, scope, group_index)
);

-- Maps a fully resolved branch combination to the subject piece that was
-- created for it. branch_key encodes the per-group option indices joined
-- by dashes, e.g. '1-0' means group 0 option 1, group 1 option 0.
CREATE TABLE IF NOT EXISTS public.copy_content_subject_branches (
  content_id uuid NOT NULL REFERENCES public.copy_contents(id) ON DELETE CASCADE,
  branch_key text NOT NULL,
  piece_id uuid NOT NULL REFERENCES public.copy_pieces(id) ON DELETE CASCADE,
  PRIMARY KEY (content_id, branch_key)
);

CREATE INDEX IF NOT EXISTS idx_ccsb_piece
  ON public.copy_content_subject_branches (piece_id);

-- FNV-1a 32-bit hash matching the JS implementation in processSpintax.ts.
-- Operates on Unicode code points (matching JS charCodeAt for BMP characters).
CREATE OR REPLACE FUNCTION public.fnv1a32(input text)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE STRICT
AS $$
DECLARE
  h bigint := 2166136261;
  i int;
  c int;
BEGIN
  FOR i IN 1..char_length(input) LOOP
    c := ascii(substr(input, i, 1));
    h := (h # c);
    h := (h * 16777619) & 4294967295;
  END LOOP;
  RETURN h;
END;
$$;

-- RLS policies
ALTER TABLE public.copy_content_spintax_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copy_content_subject_branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ccsg_select_member ON public.copy_content_spintax_groups;
CREATE POLICY ccsg_select_member
  ON public.copy_content_spintax_groups FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.copy_contents cc
      JOIN public.account_users au ON au.account_id = cc.account_id
      WHERE cc.id = copy_content_spintax_groups.content_id
        AND au.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS ccsb_select_member ON public.copy_content_subject_branches;
CREATE POLICY ccsb_select_member
  ON public.copy_content_subject_branches FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.copy_contents cc
      JOIN public.account_users au ON au.account_id = cc.account_id
      WHERE cc.id = copy_content_subject_branches.content_id
        AND au.user_id = auth.uid()
    )
  );

REVOKE ALL ON TABLE
  public.copy_content_spintax_groups,
  public.copy_content_subject_branches
FROM anon, authenticated;

GRANT SELECT ON TABLE
  public.copy_content_spintax_groups,
  public.copy_content_subject_branches
TO authenticated;

GRANT ALL ON TABLE
  public.copy_content_spintax_groups,
  public.copy_content_subject_branches
TO service_role;

REVOKE ALL ON FUNCTION public.fnv1a32(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fnv1a32(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fnv1a32(text) TO authenticated;
