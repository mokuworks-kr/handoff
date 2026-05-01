/**
 * 1차 콤포지션 카탈로그 검증.
 *
 * grid.test.ts 와 같은 스타일 (vitest 미도입 1차) — console.log + throw.
 * 실행: `npx tsx lib/layout/patterns.test.ts` (미래 vitest 도입 시 자동화).
 *
 * 검증 항목 (§16.3 자동 검증 정신):
 *   1. 모든 패턴이 grid.ts.assertRealizable() 통과
 *   2. 모든 패턴이 default.md 어휘 [[12],[6,6],[8,4]] 안에 있음
 *   3. variants 적용 후에도 column 합이 그리드 안 (위험 3 대응)
 *   4. 모든 비대칭 콤포지션이 asymmetryDirection variants 가짐
 *   5. getPatternsForVocabulary() 가 정확히 6개 반환
 *   6. getPatternsByRole() 분포가 의도대로
 *   7. realize() 호출이 모든 패턴 + 모든 variants 옵션에서 성공
 *
 * 박힌 결정과의 정합성:
 *   - §11 약속 1번 (어휘 단위 고정): 검증 2 / 5 가 보장
 *   - 위험 3 (variants 적용 후 검증): 검증 3 / 7 이 보장
 *   - 위험 4 (어휘 매칭 정규화): 검증 5 가 검증 (다른 순서 비율도 매칭)
 */

import { realize, assertRealizable, type RealizeInput } from "./grid";
import {
  ALL_PATTERNS,
  getPatternsForVocabulary,
  getPatternsByRole,
  isPatternInVocabulary,
  findPatternBySlug,
} from "./patterns";
import type { CompositionPattern, PageBlueprint } from "./composition";
import { ASYMMETRY_VARIANT_ID, ASYMMETRY_OPTION_VALUES } from "./patterns/_variants";

// ─────────────────────────────────────────────────────────────
// 공용 — A4 portrait, 좌측 페이지 마진
// ─────────────────────────────────────────────────────────────

const A4_FORMAT: RealizeInput["format"] = {
  width: 210,
  height: 297,
  columns: 12,
  gutter: 4,
  bleed: { top: 3, right: 3, bottom: 3, left: 3 },
};
const LEFT_MARGINS = { top: 20, bottom: 20, left: 15, right: 25 };
const DEFAULT_VOCABULARY = [[12], [6, 6], [8, 4]] as const;

function ok(label: string) {
  console.log(`  OK  ${label}`);
}
function fail(label: string, message: string): never {
  throw new Error(`FAIL: ${label} — ${message}`);
}

// ─────────────────────────────────────────────────────────────
// 검증 1 — assertRealizable
// ─────────────────────────────────────────────────────────────

console.log("Test 1: 모든 패턴 assertRealizable 통과");
{
  for (const pattern of ALL_PATTERNS) {
    try {
      assertRealizable({ pattern, format: A4_FORMAT });
      ok(`${pattern.slug}`);
    } catch (e) {
      fail(`${pattern.slug}`, (e as Error).message);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 검증 2 — 모든 패턴이 default 어휘 안
// ─────────────────────────────────────────────────────────────

console.log("\nTest 2: 모든 패턴이 default 어휘 안");
{
  for (const pattern of ALL_PATTERNS) {
    if (!isPatternInVocabulary(pattern.slug, DEFAULT_VOCABULARY)) {
      fail(pattern.slug, "default.md 어휘 [[12],[6,6],[8,4]] 안에 없음");
    }
    ok(`${pattern.slug} ∈ 어휘`);
  }
}

// ─────────────────────────────────────────────────────────────
// 검증 3 — variants 적용 후 column 합 검증
// ─────────────────────────────────────────────────────────────

console.log("\nTest 3: variants 적용 후 column 합이 어휘 안");
{
  for (const pattern of ALL_PATTERNS) {
    if (!pattern.variants) continue;
    for (const variant of pattern.variants) {
      for (const option of variant.options) {
        // 슬롯별 base + override 합쳐서 columnSpan 합 검사
        const slotAreas = pattern.slots.map((slot) => {
          const ovr = option.override?.[slot.id];
          return {
            id: slot.id,
            column: ovr?.column ?? slot.area.column,
            columnSpan: ovr?.columnSpan ?? slot.area.columnSpan,
          };
        });
        // 풀블리드 슬롯 제외 (어휘 외)
        const nonBleedSpans = slotAreas
          .filter((s) => {
            const slot = pattern.slots.find((sl) => sl.id === s.id);
            return !slot?.bleedToEdge;
          })
          .map((s) => s.columnSpan);
        const sum = nonBleedSpans.reduce((a, b) => a + b, 0);
        if (sum !== A4_FORMAT.columns) {
          fail(
            `${pattern.slug}/${variant.id}/${option.value}`,
            `column 합 ${sum} ≠ ${A4_FORMAT.columns}`,
          );
        }
        // 각 슬롯이 그리드 안인지
        for (const s of slotAreas) {
          if (s.column < 1 || s.column + s.columnSpan - 1 > A4_FORMAT.columns) {
            fail(
              `${pattern.slug}/${variant.id}/${option.value}/${s.id}`,
              `col ${s.column} span ${s.columnSpan} 가 1..${A4_FORMAT.columns} 범위 밖`,
            );
          }
        }
        ok(`${pattern.slug}/${variant.id}/${option.value} (합=${sum})`);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 검증 4 — 비대칭 콤포지션이 asymmetryDirection 가짐
// ─────────────────────────────────────────────────────────────

console.log("\nTest 4: 비대칭 콤포지션은 asymmetryDirection variants 보유");
{
  for (const pattern of ALL_PATTERNS) {
    // 비대칭 판정: 슬롯들의 columnSpan 이 서로 다름 (풀블리드 제외)
    const spans = pattern.slots
      .filter((s) => !s.bleedToEdge)
      .map((s) => s.area.columnSpan);
    const allSame = spans.every((s) => s === spans[0]);
    const isSymmetric = allSame || spans.length <= 1;

    if (isSymmetric) {
      // 대칭이면 asymmetryDirection 없어야 함 (있어도 에러는 아니지만 의미 없음)
      const hasAsym = pattern.variants?.some((v) => v.id === ASYMMETRY_VARIANT_ID);
      if (hasAsym) {
        console.warn(
          `  WARN  ${pattern.slug} 가 대칭/단일 비율인데 asymmetryDirection variants 있음 (의도 확인)`,
        );
      } else {
        ok(`${pattern.slug} 대칭/단일 — variants 없음 OK`);
      }
    } else {
      // 비대칭이면 asymmetryDirection 필수
      const hasAsym = pattern.variants?.some((v) => v.id === ASYMMETRY_VARIANT_ID);
      if (!hasAsym) {
        fail(pattern.slug, "비대칭인데 asymmetryDirection variants 없음");
      }
      ok(`${pattern.slug} 비대칭 — asymmetryDirection 보유`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 검증 5 — getPatternsForVocabulary 정확히 6개 반환
// ─────────────────────────────────────────────────────────────

console.log("\nTest 5: getPatternsForVocabulary(default 어휘) 가 6개 반환");
{
  const matched = getPatternsForVocabulary(DEFAULT_VOCABULARY);
  if (matched.length !== 6) {
    fail("vocabulary match", `expected 6, got ${matched.length}`);
  }
  ok(`6개 매칭`);

  // 어휘 비율 순서 뒤집어도 같은 결과 (위험 4 — 정규화)
  const reversed = [[12], [4, 8], [6, 6]] as const;
  const matchedReversed = getPatternsForVocabulary(reversed);
  if (matchedReversed.length !== 6) {
    fail(
      "vocabulary match (reversed)",
      `[4,8] 순서로 줘도 6개 매칭돼야 함 (got ${matchedReversed.length})`,
    );
  }
  ok(`[4,8] 순서로 줘도 6개 매칭 (정규화 OK)`);

  // 어휘에 없는 비율 — 매칭 0
  const noMatch = getPatternsForVocabulary([[3, 9]]);
  if (noMatch.length !== 0) {
    fail("vocabulary [3,9]", `매칭 0 이어야 함 (got ${noMatch.length})`);
  }
  ok(`[3,9] 어휘 — 매칭 0 OK`);
}

// ─────────────────────────────────────────────────────────────
// 검증 6 — role 분포 의도대로
// ─────────────────────────────────────────────────────────────

console.log("\nTest 6: role 분포");
{
  const expected: Record<string, number> = {
    body: 3, // grid-12-text, grid-6-6-text-text, grid-8-4-text-image
    media: 2, // grid-12-image, grid-6-6-text-image
    data: 1, // grid-8-4-table-text
  };
  for (const [role, count] of Object.entries(expected)) {
    const matched = getPatternsByRole(role as CompositionPattern["role"]);
    if (matched.length !== count) {
      fail(`role=${role}`, `expected ${count}, got ${matched.length}`);
    }
    ok(`${role}: ${count}개`);
  }
}

// ─────────────────────────────────────────────────────────────
// 검증 7 — realize() 가 모든 패턴 + 모든 variants 옵션에서 성공
// ─────────────────────────────────────────────────────────────

console.log("\nTest 7: realize() — 모든 패턴 × 모든 variants 옵션");
{
  for (const pattern of ALL_PATTERNS) {
    // 슬롯별 더미 콘텐츠 생성
    const content: Record<string, unknown> = {};
    for (const slot of pattern.slots) {
      switch (slot.kind) {
        case "text":
          content[slot.id] = "더미 본문 텍스트";
          break;
        case "image":
          content[slot.id] = { src: "https://example.com/dummy.jpg" };
          break;
        case "table":
          content[slot.id] = {
            rows: 2,
            cols: 2,
            cells: [
              [
                { content: "헤더1" },
                { content: "헤더2" },
              ],
              [
                { content: "값1" },
                { content: "값2" },
              ],
            ],
          };
          break;
        case "chart":
          content[slot.id] = {
            chartType: "bar",
            data: [{ x: "A", y: 1 }],
            config: { xKey: "x", yKeys: ["y"] },
          };
          break;
        case "shape":
          content[slot.id] = {};
          break;
      }
    }

    // variants 옵션별로 — 없으면 기본만
    const variantCombos: Array<Record<string, string> | undefined> = [];
    if (pattern.variants && pattern.variants.length > 0) {
      for (const variant of pattern.variants) {
        for (const option of variant.options) {
          variantCombos.push({ [variant.id]: option.value });
        }
      }
    } else {
      variantCombos.push(undefined);
    }

    for (const variants of variantCombos) {
      const blueprint: PageBlueprint = {
        pattern: pattern.slug,
        content,
        ...(variants ? { variants } : {}),
      };
      try {
        const frames = realize({
          blueprint,
          pattern,
          format: A4_FORMAT,
          resolvedMargins: LEFT_MARGINS,
          side: "left",
        });
        // 프레임이 비어있지 않아야 (필수 슬롯 있는 콤포지션은 최소 1개)
        if (frames.length === 0) {
          fail(
            `${pattern.slug} ${JSON.stringify(variants ?? {})}`,
            "frames.length = 0",
          );
        }
        // 모든 프레임 좌표가 페이지 + 블리드 박스 안인지
        // 풀블리드는 음수 좌표라 페이지 - bleed 까지 허용
        const minX = -A4_FORMAT.bleed.left;
        const minY = -A4_FORMAT.bleed.top;
        const maxX = A4_FORMAT.width + A4_FORMAT.bleed.right;
        const maxY = A4_FORMAT.height + A4_FORMAT.bleed.bottom;
        for (const f of frames) {
          if (
            f.x < minX - 0.001 ||
            f.y < minY - 0.001 ||
            f.x + f.width > maxX + 0.001 ||
            f.y + f.height > maxY + 0.001
          ) {
            fail(
              `${pattern.slug} ${JSON.stringify(variants ?? {})}/${f.id}`,
              `frame 박스 (${f.x},${f.y},${f.width},${f.height}) 가 페이지+블리드 (${minX},${minY},${maxX},${maxY}) 밖`,
            );
          }
        }
        const variantStr = variants
          ? Object.entries(variants).map(([k, v]) => `${k}=${v}`).join(",")
          : "(no variants)";
        ok(`${pattern.slug} [${variantStr}] frames=${frames.length}`);
      } catch (e) {
        fail(
          `${pattern.slug} ${JSON.stringify(variants ?? {})}`,
          (e as Error).message,
        );
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 검증 8 — 사용자 카탈로그 케이스 (좌우 일관성 시뮬레이션)
// ─────────────────────────────────────────────────────────────

console.log("\nTest 8: 사용자 카탈로그 케이스 — wide-left 가 좌/우 페이지 모두 같은 위치");
{
  const pattern = findPatternBySlug("grid-8-4-text-image")!;
  const blueprint: PageBlueprint = {
    pattern: pattern.slug,
    variants: { [ASYMMETRY_VARIANT_ID]: "wide-left" },
    content: {
      wide: "제품명 + 소개 줄글",
      narrow: { src: "https://example.com/product.jpg" },
    },
  };

  // 좌측 페이지에서 wide-left
  const leftFrames = realize({
    blueprint,
    pattern,
    format: A4_FORMAT,
    resolvedMargins: LEFT_MARGINS,
    side: "left",
  });
  const leftWide = leftFrames.find((f) => f.id === "wide")!;

  // 우측 페이지 마진 (inside/outside 거울)
  const RIGHT_MARGINS = { top: 20, bottom: 20, left: 25, right: 15 };
  const rightFrames = realize({
    blueprint,
    pattern,
    format: A4_FORMAT,
    resolvedMargins: RIGHT_MARGINS,
    side: "right",
  });
  const rightWide = rightFrames.find((f) => f.id === "wide")!;

  // wide-left 는 EdgeAffinity 안 쓰므로 좌/우 페이지에서 column 인덱스 동일.
  // 단 마진이 다르니 contentX 가 달라져 절대 x 좌표는 다를 수 있음.
  // 우리가 검증하는 건 "wide 가 페이지 본문 영역의 왼쪽 끝부터 시작" — 즉 contentX 와 같아야 함.
  if (Math.abs(leftWide.x - LEFT_MARGINS.left) > 0.001) {
    fail("wide-left 좌측", `wide.x=${leftWide.x} ≠ LEFT_MARGINS.left=${LEFT_MARGINS.left}`);
  }
  if (Math.abs(rightWide.x - RIGHT_MARGINS.left) > 0.001) {
    fail("wide-left 우측", `wide.x=${rightWide.x} ≠ RIGHT_MARGINS.left=${RIGHT_MARGINS.left}`);
  }
  ok(`좌측 페이지 wide.x = ${leftWide.x} (마진 left=${LEFT_MARGINS.left})`);
  ok(`우측 페이지 wide.x = ${rightWide.x} (마진 left=${RIGHT_MARGINS.left})`);
  ok(`반복 카탈로그: 두 페이지 모두 본문 영역 왼쪽 끝부터 wide 시작 — 통일감 확보`);
}

console.log("\n전체 8개 테스트 모두 통과.");
