-- Competitor audit map PNGs: allow server-side uploads (worker uses service_role JWT).
-- The initial migration only added public SELECT; without INSERT/UPDATE, storage.objects RLS can block uploads.

CREATE POLICY "flux_competitor_map_objects_insert"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'flux-competitor-map');

CREATE POLICY "flux_competitor_map_objects_update"
  ON storage.objects FOR UPDATE
  TO service_role
  USING (bucket_id = 'flux-competitor-map')
  WITH CHECK (bucket_id = 'flux-competitor-map');

CREATE POLICY "flux_competitor_map_objects_delete"
  ON storage.objects FOR DELETE
  TO service_role
  USING (bucket_id = 'flux-competitor-map');
