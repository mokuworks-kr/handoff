-- =============================================================================
-- Handoff 0002_storage.sql
-- Storage 버킷 4종 생성 + RLS 정책.
-- 스펙 §8 Storage 버킷 부분.
--
-- 실행 방법:
--   Supabase 대시보드 > SQL Editor > New query
--   이 파일 전체 붙여넣기 → Run
--
-- 참고: Supabase Storage RLS는 storage.objects 테이블에 정책을 거는 식으로 동작.
-- 모든 버킷 private. 사용자별 폴더 prefix로 접근 제한.
-- =============================================================================

-- 버킷 생성 (멱등) -----------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('originals',      'originals',      false),
  ('exports',        'exports',        false),
  ('thumbnails',     'thumbnails',     false),
  ('shared-images',  'shared-images',  false)
on conflict (id) do nothing;

-- 정책 -----------------------------------------------------------------------
-- 경로 컨벤션: <bucket>/<user_id>/<project_id>/...
-- 첫 번째 path 세그먼트가 user_id여야 함.

drop policy if exists "originals: owner read"   on storage.objects;
drop policy if exists "originals: owner write"  on storage.objects;
drop policy if exists "originals: owner update" on storage.objects;
drop policy if exists "originals: owner delete" on storage.objects;

create policy "originals: owner read" on storage.objects
  for select using (
    bucket_id = 'originals'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "originals: owner write" on storage.objects
  for insert with check (
    bucket_id = 'originals'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "originals: owner update" on storage.objects
  for update using (
    bucket_id = 'originals'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "originals: owner delete" on storage.objects
  for delete using (
    bucket_id = 'originals'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "exports: owner read"   on storage.objects;
drop policy if exists "exports: owner write"  on storage.objects;
drop policy if exists "exports: owner delete" on storage.objects;
-- exports는 일반적으로 서버(서비스 롤)가 쓰고 사용자는 서명 URL로 다운로드.
-- 사용자 직접 read만 열어둠.
create policy "exports: owner read" on storage.objects
  for select using (
    bucket_id = 'exports'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "exports: owner write" on storage.objects
  for insert with check (
    bucket_id = 'exports'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "exports: owner delete" on storage.objects
  for delete using (
    bucket_id = 'exports'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "thumbnails: owner read"   on storage.objects;
drop policy if exists "thumbnails: owner write"  on storage.objects;
drop policy if exists "thumbnails: owner update" on storage.objects;
drop policy if exists "thumbnails: owner delete" on storage.objects;
create policy "thumbnails: owner read" on storage.objects
  for select using (
    bucket_id = 'thumbnails'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "thumbnails: owner write" on storage.objects
  for insert with check (
    bucket_id = 'thumbnails'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "thumbnails: owner update" on storage.objects
  for update using (
    bucket_id = 'thumbnails'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "thumbnails: owner delete" on storage.objects
  for delete using (
    bucket_id = 'thumbnails'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- shared-images: 이름은 "공유 가능" 같지만 실제로는 비공개 + 서명 URL로만 노출.
-- 클라이언트 직접 접근 정책 없음 → service_role만 read/write.
-- (마일스톤 4 공유 라우트에서 서명 URL 발급)
