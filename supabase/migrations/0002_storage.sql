-- Supabase-only: RLS policies on the mirror tables plus the private photo
-- bucket. This migration is not part of the local Postgres dev schema - the
-- `authenticated` role and storage schema only exist on a real Supabase
-- project, where object storage replaces the sync API's filesystem adapter.
--
-- Objects live under <user_id>/<week_id>/... so a single path-prefix check is
-- the whole authorization story, identical to the API's own check.

-- When connected through PostgREST with a user JWT, a user sees only their
-- own rows. The sync API connects as a service role and enforces the same
-- boundary itself.
CREATE POLICY users_self   ON public.users
  FOR ALL TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY entries_self ON public.entries
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY photos_self  ON public.photos
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY goals_self   ON public.goals
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY completions_self ON public.goal_completions
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('journal-photos', 'journal-photos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY photos_owner_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'journal-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY photos_owner_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'journal-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
