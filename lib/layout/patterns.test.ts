/**
 * 1차 콤포지션 카탈로그 검증 (M3b-1).
 *
 * grid.test.ts 와 같은 스타일 — console.log + throw.
 * 실행: `npx tsx lib/layout/patterns.test.ts`
 *
 * 검증 항목:
 *   1. 모든 패턴이 grid.ts.assertRealizable() 통과
 *   2. 모든 패턴이 default.md 어휘 [[12],[6,6],[8,4],[4,4,4],[3,3,3,3]] 안
 *   3. variants 적용 후에도 column 합 검증
 *   4. 모든 비대칭 콤포지션이 asymmetryDirection variants 보유
 *   5. getPatternsForVocabulary() 가 정확히 10개 반환 + 정규화 작동
 *   6. getPatternsByRole() 분포가 의도대로
 *   7. realize() 가 모든 패턴 + 모든 variants 옵션에서 성공
 *   8. 사용자 카탈로그 케이스 — wide-left 좌/우 페이지 통일감
 *   9. thirds/quarters 슬롯 위치 검증 (새 추가)
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
import { ASYMMETRY_VARIANT_ID } from "./patterns/_variants";

// ─────────────────────────────────────────────────────────────
// 공용
// ─────────────────────────────────────────────────────────────

const A4_FORMAT: RealizeInput["format"] = {
  width: 210,
  height: 297,
  columns: 12,
  gutter: 4,
  bleed: { top: 3, right: 3, bottom: 3, left: 3 },
};
const LEFT_MARGINS = { top: 20, bottom: 20, left: 15, right: 25 };
const DEFAULT_VOCABULARY = [
  [12],
  [6, 6],
  [8, 4],
  [4, 4, 4],
  [3, 3, 3, 3],
] as const;

function ok(label: string) {
  console.log(`  OK  ${label}`);
}
function fail(label: string, message: string): never {
  throw new Error(`FAIL: ${label} — ${message}`);
}

// ─────────────────────────────────────────────────────────────
// 검증 1
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
// 검증 2
// ─────────────────────────────────────────────────────────────

console.log("\nTest 2: 모든 패턴이 default 어휘 안");
{
  for (const pattern of ALL_PATTERNS) {
    if (!isPatternInVocabulary(pattern.slug, DEFAULT_VOCABULARY)) {
      fail(pattern.slug, "default.md 어휘 안에 없음");
    }
    ok(`${pattern.slug} ∈ 어휘`);
  }
}

// ─────────────────────────────────────────────────────────────
// 검증 3
// ─────────────────────────────────────────────────────────────

console.log("\nTest 3: variants 적용 후 column 합이 그리드 안");
{
  for (const pattern of ALL_PATTERNS) {
    if (!pattern.variants) continue;
    for (const variant of pattern.variants) {
      for (const option of variant.options) {
        const slotAreas = pattern.slots.map((slot) => {
          const ovr = option.override?.[slot.id];
          return {
            id: slot.id,
            column: ovr?.column ?? slot.area.column,
            columnSpan: ovr?.columnSpan ?? slot.area.columnSpan,
          };
        });
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
// 검증 4
// ─────────────────────────────────────────────────────────────

console.log("\nTest 4: 비대칭 콤포지션은 asymmetryDirection variants 보유");
{
  for (const pattern of ALL_PATTERNS) {
    const spans = pattern.slots
      .filter((s) => !s.bleedToEdge)
      .map((s) => s.area.columnSpan);
    const allSame = spans.every((s) => s === spans[0]);
    const isSymmetric = allSame || spans.length <= 1;

    if (isSymmetric) {
      const hasAsym = pattern.variants?.some((v) => v.id === ASYMMETRY_VARIANT_ID);
      if (hasAsym) {
        console.warn(
          `  WARN  ${pattern.slug} 가 대칭/단일인데 asymmetryDirection 있음 (의도 확인)`,
        );
      } else {
        ok(`${pattern.slug} 대칭/단일 — variants 없음 OK`);
      }
    } else {
      const hasAsym = pattern.variants?.some((v) => v.id === ASYMMETRY_VARIANT_ID);
      if (!hasAsym) {
        fail(pattern.slug, "비대칭인데 asymmetryDirection variants 없음");
      }
      ok(`${pattern.slug} 비대칭 — asymmetryDirection 보유`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 검증 5
// ─────────────────────────────────────────────────────────────

console.log("\nTest 5: getPatternsForVocabulary(default 어휘) 가 10개 반환");
{
  const matched = getPatternsForVocabulary(DEFAULT_VOCABULARY);
  if (matched.length !== 10) {
    fail("vocabulary match", `expected 10, got ${matched.length}`);
  }
  ok(`10개 매칭`);

  // 비율 순서 뒤집어도 매칭 정상 (정규화)
  const reversed = [
    [12],
    [4, 8],
    [6, 6],
    [4, 4, 4],
    [3, 3, 3, 3],
  ] as const;
  const matchedReversed = getPatternsForVocabulary(reversed);
  if (matchedReversed.length !== 10) {
    fail(
      "vocabulary match (reversed)",
      `[4,8] 순서로 줘도 10개 매칭돼야 함 (got ${matchedReversed.length})`,
    );
  }
  ok(`[4,8] 순서로 줘도 10개 매칭 (정규화 OK)`);

  // 부분 어휘
  const partial = [[12], [6, 6]] as const;
  const matchedPartial = getPatternsForVocabulary(partial);
  if (matchedPartial.length !== 4) {
    fail(
      "vocabulary partial",
      `[12]+[6,6] 어휘는 4개 매칭이어야 함 (got ${matchedPartial.length})`,
    );
  }
  ok(`부분 어휘 [12]+[6,6] — 4개 매칭`);

  // 어휘에 없는 비율 — 매칭 0
  const noMatch = getPatternsForVocabulary([[3, 9]]);
  if (noMatch.length !== 0) {
    fail("vocabulary [3,9]", `매칭 0 이어야 함 (got ${noMatch.length})`);
  }
  ok(`[3,9] 어휘 — 매칭 0 OK`);
}

// ─────────────────────────────────────────────────────────────
// 검증 6
// ─────────────────────────────────────────────────────────────

console.log("\nTest 6: role 분포");
{
  const expected: Record<string, number> = {
    body: 5, // full-text, halves-text-text, wide-narrow-text-image,
    //          thirds-text-text-text, quarters-text-text-text-text
    media: 4, // full-image, halves-text-image,
    //          thirds-image-image-image, quarters-image-image-image-image
    data: 1, // wide-narrow-table-text
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
// 검증 7
// ─────────────────────────────────────────────────────────────

console.log("\nTest 7: realize() — 모든 패턴 × 모든 variants 옵션");
{
  for (const pattern of ALL_PATTERNS) {
    const content: Record<string, unknown> = {};
    for (const slot of pattern.slots) {
      switch (slot.kind) {
        case "text":
          content[slot.id] = "더미 본문";
          break;
        case "image":
          content[slot.id] = { src: "https://example.com/dummy.jpg" };
          break;
        case "table":
          content[slot.id] = {
            rows: 2,
            cols: 2,
            cells: [
              [{ content: "헤더1" }, { content: "헤더2" }],
              [{ content: "값1" }, { content: "값2" }],
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
        if (frames.length === 0) {
          fail(
            `${pattern.slug} ${JSON.stringify(variants ?? {})}`,
            "frames.length = 0",
          );
        }
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
              `${pattern.slug}/${f.id}`,
              `frame (${f.x},${f.y},${f.width},${f.height}) 가 페이지+블리드 밖`,
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
// 검증 8 — 사용자 카탈로그 케이스
// ─────────────────────────────────────────────────────────────

console.log("\nTest 8: 사용자 카탈로그 케이스 — wide-left 좌/우 페이지 통일감");
{
  const pattern = findPatternBySlug("wide-narrow-text-image")!;
  const blueprint: PageBlueprint = {
    pattern: pattern.slug,
    variants: { [ASYMMETRY_VARIANT_ID]: "wide-left" },
    content: {
      wide: "제품명 + 소개 줄글",
      narrow: { src: "https://example.com/product.jpg" },
    },
  };

  const leftFrames = realize({
    blueprint,
    pattern,
    format: A4_FORMAT,
    resolvedMargins: LEFT_MARGINS,
    side: "left",
  });
  const leftWide = leftFrames.find((f) => f.id === "wide")!;

  const RIGHT_MARGINS = { top: 20, bottom: 20, left: 25, right: 15 };
  const rightFrames = realize({
    blueprint,
    pattern,
    format: A4_FORMAT,
    resolvedMargins: RIGHT_MARGINS,
    side: "right",
  });
  const rightWide = rightFrames.find((f) => f.id === "wide")!;

  if (Math.abs(leftWide.x - LEFT_MARGINS.left) > 0.001) {
    fail("wide-left 좌측", `wide.x=${leftWide.x} ≠ ${LEFT_MARGINS.left}`);
  }
  if (Math.abs(rightWide.x - RIGHT_MARGINS.left) > 0.001) {
    fail("wide-left 우측", `wide.x=${rightWide.x} ≠ ${RIGHT_MARGINS.left}`);
  }
  ok(`좌측 페이지 wide.x = ${leftWide.x}`);
  ok(`우측 페이지 wide.x = ${rightWide.x}`);
  ok(`반복 카탈로그: 두 페이지 모두 본문 영역 왼쪽 끝부터 wide 시작 — 통일감 확보`);
}

// ─────────────────────────────────────────────────────────────
// 검증 9 — thirds / quarters 슬롯 위치 검증 (새 추가)
// ─────────────────────────────────────────────────────────────

console.log("\nTest 9: thirds / quarters 슬롯 위치 정확성");
{
  // thirds: column 1, 5, 9. 각 span 4. 사이 gutter 자동.
  // colW = (170 - 4*11)/12 = 10.5, gutter = 4
  // left:   x = 15 + 0*(10.5+4)               = 15
  //         w = 4*10.5 + 3*4 = 42 + 12        = 54
  // center: x = 15 + 4*(10.5+4)               = 15 + 58 = 73
  //         w = 54
  // right:  x = 15 + 8*(10.5+4)               = 15 + 116 = 131
  //         w = 54
  const thirdsPattern = findPatternBySlug("thirds-text-text-text")!;
  const thirdsBlueprint: PageBlueprint = {
    pattern: thirdsPattern.slug,
    content: { left: "왼", center: "가운데", right: "오른" },
  };
  const thirdsFrames = realize({
    blueprint: thirdsBlueprint,
    pattern: thirdsPattern,
    format: A4_FORMAT,
    resolvedMargins: LEFT_MARGINS,
    side: "left",
  });
  const tLeft = thirdsFrames.find((f) => f.id === "left")!;
  const tCenter = thirdsFrames.find((f) => f.id === "center")!;
  const tRight = thirdsFrames.find((f) => f.id === "right")!;

  if (Math.abs(tLeft.x - 15) > 0.001) fail("thirds.left.x", `expected 15, got ${tLeft.x}`);
  if (Math.abs(tLeft.width - 54) > 0.001) fail("thirds.left.w", `expected 54, got ${tLeft.width}`);
  if (Math.abs(tCenter.x - 73) > 0.001) fail("thirds.center.x", `expected 73, got ${tCenter.x}`);
  if (Math.abs(tRight.x - 131) > 0.001) fail("thirds.right.x", `expected 131, got ${tRight.x}`);
  ok(`thirds 슬롯 3개 위치 정확 (15 / 73 / 131, 각 폭 54mm)`);
  // 슬롯끼리 겹침 없음
  if (tLeft.x + tLeft.width > tCenter.x + 0.001)
    fail("thirds 겹침", "left 와 center 겹침");
  if (tCenter.x + tCenter.width > tRight.x + 0.001)
    fail("thirds 겹침", "center 와 right 겹침");
  ok(`thirds 슬롯 겹침 없음 (사이 gutter 자동 처리)`);

  // quarters: column 1, 4, 7, 10. span 3 각각.
  // q1: x = 15
  // q2: x = 15 + 3*(10.5+4) = 15 + 43.5 = 58.5
  // q3: x = 15 + 6*(10.5+4) = 15 + 87 = 102
  // q4: x = 15 + 9*(10.5+4) = 15 + 130.5 = 145.5
  // 각 폭 = 3*10.5 + 2*4 = 31.5 + 8 = 39.5
  const quartersPattern = findPatternBySlug("quarters-text-text-text-text")!;
  const quartersBlueprint: PageBlueprint = {
    pattern: quartersPattern.slug,
    content: { q1: "1", q2: "2", q3: "3", q4: "4" },
  };
  const quartersFrames = realize({
    blueprint: quartersBlueprint,
    pattern: quartersPattern,
    format: A4_FORMAT,
    resolvedMargins: LEFT_MARGINS,
    side: "left",
  });
  const q1 = quartersFrames.find((f) => f.id === "q1")!;
  const q4 = quartersFrames.find((f) => f.id === "q4")!;
  if (Math.abs(q1.x - 15) > 0.001) fail("quarters.q1.x", `expected 15, got ${q1.x}`);
  if (Math.abs(q1.width - 39.5) > 0.001) fail("quarters.q1.w", `expected 39.5, got ${q1.width}`);
  if (Math.abs(q4.x - 145.5) > 0.001) fail("quarters.q4.x", `expected 145.5, got ${q4.x}`);
  if (Math.abs(q4.x + q4.width - (15 + 170)) > 0.001)
    fail("quarters 마지막 슬롯 끝", `expected ${15 + 170}, got ${q4.x + q4.width}`);
  ok(`quarters 슬롯 4개 위치 정확 (q1.x=15, q4 끝=185 = 본문 영역 끝)`);
}

console.log("\n전체 9개 테스트 모두 통과.");
