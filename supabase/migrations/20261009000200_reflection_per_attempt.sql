-- One reflection per attempt (spec §56): saving the reflection card twice (a retry, a double
-- click) keeps the first instead of creating duplicates. Archive import already inserts with
-- "on conflict do nothing", so a duplicate in an archive is skipped rather than failing.
create unique index reflections_attempt_unique on public.reflections (attempt_id);
