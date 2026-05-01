/**
 * 업로드 관련 공통 타입.
 *
 * 흐름:
 *   클라이언트 → /api/uploads/sign (POST) → 서명 URL 받음
 *   클라이언트 → 서명 URL 에 PUT (Storage 직접) → 업로드 완료
 *   클라이언트 → /api/classify-and-create (POST, storagePath만) → 분류 + 프로젝트 생성
 *   서버 → admin client 로 storage 에서 다운로드 → 파싱
 *
 * 이 흐름이 Vercel 함수 body 4.5MB 한도를 우회. Storage 자체 한도(기본 50MB) 까지 가능.
 */

/**
 * 지원하는 업로드 파일 종류 — 라우트의 mimetype 검증과 일치.
 */
export const SUPPORTED_UPLOAD_EXTENSIONS = [
  ".docx",
  ".pptx",
  ".hwpx",
] as const;
// PDF는 pdf-parse 라이브러리 교체 후 추가.

export type SupportedUploadExtension = (typeof SUPPORTED_UPLOAD_EXTENSIONS)[number];

/**
 * 파일 크기 한도 — Storage 버킷 자체 정책.
 * 기본 Supabase Storage 무료 50MB 까지. 우리는 보수적으로 30MB로 둠 (회사소개서·매뉴얼 충분).
 * 더 늘리려면 이 상수 + Storage 정책 동시 변경.
 */
export const MAX_UPLOAD_SIZE_BYTES = 30 * 1024 * 1024;

/**
 * 서명 URL 발급 요청 입력.
 */
export type SignUploadRequest = {
  filename: string;
  /** 파일 byte size — 사전 검증용 */
  size: number;
};

/**
 * 서명 URL 발급 응답.
 */
export type SignUploadResponse = {
  /** Storage 안의 경로. 분류 라우트에 이 값을 넘김 */
  storagePath: string;
  /** 클라이언트가 PUT 할 서명 URL */
  uploadUrl: string;
  /** 서명 URL 만료 시각 (ISO) */
  expiresAt: string;
};
