-- Verify attachment metadata compatibility after parser/backfill changes.
-- Ensures attachment fetch API can still use part + imapUid.

SELECT
  em.id AS message_id,
  em.parse_version,
  jsonb_array_length(COALESCE(em.attachments, '[]'::jsonb)) AS attachment_count,
  CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(em.attachments, '[]'::jsonb)) att
      WHERE att->>'part' IS NULL
         OR att->>'imapUid' IS NULL
    )
    THEN 'PASS'
    ELSE 'FAIL'
  END AS part_metadata_status
FROM email_messages em
WHERE em.direction = 'received'
ORDER BY em.received_at DESC
LIMIT 200;

