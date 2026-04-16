ALTER TABLE company_google_ads_verifications
  ADD COLUMN latest_ad_last_shown_at DATE;

COMMENT ON COLUMN company_google_ads_verifications.latest_ad_last_shown_at IS
  'Date parsed from the first unique Google Ads creative in Ads Transparency Center results, using the creative detail page''s "Last shown" label.';
