-- logo_path was unused (no reads); brand uses brand_profile.logoUrl or page theme.
ALTER TABLE public.flux_prospects DROP COLUMN IF EXISTS logo_path;
