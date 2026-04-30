/**
 * 이메일 화이트리스트 — /lab/* 같은 비공개 검증 페이지/API 보호용.
 *
 * 환경변수 LAB_ALLOWED_EMAILS에 콤마로 구분된 이메일 목록.
 * 비어있으면 아무도 통과 못함 (안전한 기본값).
 *
 * 사용 예 (Server Component / Route Handler):
 *
 *   const supabase = await createClient();
 *   const { data: { user } } = await supabase.auth.getUser();
 *   if (!isLabAllowed(user?.email)) {
 *     redirect("/dashboard");  // 또는 404
 *   }
 *
 * 환경변수:
 *   LAB_ALLOWED_EMAILS="alice@example.com,bob@example.com"
 *
 * NEXT_PUBLIC_ 접두사 없음 — 클라이언트로 노출 안 됨.
 * 즉 Server Component / Route Handler / Server Action 에서만 사용 가능.
 */

let cachedAllowed: Set<string> | null = null;

/**
 * 이 이메일이 lab 페이지에 접근할 수 있는지.
 * 대소문자 무시 비교.
 */
export function isLabAllowed(email: string | null | undefined): boolean {
  if (typeof window !== "undefined") {
    throw new Error("isLabAllowed()는 서버에서만 호출 가능합니다.");
  }
  if (!email) return false;

  if (cachedAllowed === null) {
    const raw = process.env.LAB_ALLOWED_EMAILS ?? "";
    cachedAllowed = new Set(
      raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0),
    );
  }

  return cachedAllowed.has(email.toLowerCase());
}

/**
 * 테스트나 환경변수 핫리로드 시 캐시 초기화. 보통 안 씀.
 */
export function _resetAllowedCache(): void {
  cachedAllowed = null;
}
