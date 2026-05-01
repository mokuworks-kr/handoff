-- =============================================================================
-- Handoff 0003_manuscript_jsonb.sql
--
-- M3a-3 시점에 박는 마이그레이션. 스키마 변경은 *없음* — projects.document JSONB
-- 안에 manuscript 필드와 origin 필드가 추가되지만 JSONB 컬럼이 이미 있어
-- 컬럼 추가 불필요.
--
-- 박는 것:
--   1) JSONB 안의 origin.designSlug 빠른 조회를 위한 GIN 인덱스
--      — 미래 "이 디자인을 쓴 프로젝트들" 검색에 사용
--   2) JSONB 안의 manuscript.source.format 빠른 조회를 위한 인덱스
--      — 통계/검색 용도
--   3) document.schemaVersion 인덱스 — 마이그레이션 대상 빠른 식별
--
-- 모두 부분 인덱스로 박아 NULL 안전.
-- 이 마이그레이션은 idempotent — 여러 번 실행해도 안전.
--
-- 실행 방법:
--   Supabase 대시보드 > SQL Editor > New query
--   이 파일 전체 붙여넣기 → Run
-- =============================================================================

-- 1) origin.designSlug 인덱스 — 디자인별 프로젝트 카운트, 커뮤니티 통계
create index if not exists projects_origin_design_slug_idx
  on projects ((document -> 'origin' ->> 'designSlug'))
  where document -> 'origin' ->> 'designSlug' is not null;

-- 2) origin.source 인덱스 — builtin/community/user 분포 통계
create index if not exists projects_origin_source_idx
  on projects ((document -> 'origin' ->> 'source'))
  where document -> 'origin' ->> 'source' is not null;

-- 3) manuscript.source.format 인덱스 — 입력 형식별 분포 (docx vs pptx 등)
create index if not exists projects_manuscript_format_idx
  on projects ((document -> 'manuscript' -> 'source' ->> 'format'))
  where document -> 'manuscript' -> 'source' ->> 'format' is not null;

-- 4) schemaVersion 인덱스 — 미래 마이그레이션 대상 빠른 식별
create index if not exists projects_schema_version_idx
  on projects (((document ->> 'schemaVersion')::int))
  where document ->> 'schemaVersion' is not null;

-- =============================================================================
-- 메모: 컬럼 추가 안 하는 이유
--
-- design_tokens 컬럼은 0001_init.sql 에서 이미 박혀있고 manuscript/origin 둘 다
-- document JSONB 안에 들어가는 게 맞음. top-level 컬럼으로 분리하면:
--   - 양쪽 동기화 비용
--   - schemaVersion 마이그레이션 시 컬럼 추가 작업 추가
-- 가 발생. 검색이 필요한 키만 JSONB 인덱스로 박는 것이 비용 효율적.
-- =============================================================================
