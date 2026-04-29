/**
 * 크레딧을 사람이 읽기 좋게 포맷.
 * 스펙 §9: "토큰" 개념은 사용자에게 절대 노출 금지. 정수 크레딧만.
 */
export function formatCredits(credits: number): string {
  return new Intl.NumberFormat("ko-KR").format(Math.max(0, Math.floor(credits)));
}
