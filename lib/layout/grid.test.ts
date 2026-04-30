/**
 * grid.ts 수치 검증 — 머릿속 계산값과 코드 출력이 맞는지 강하게 어서션.
 * M2.5 단계의 단위 테스트 대용. M3에서 vitest 도입 시 정식 테스트로 옮길 것.
 */

import { realize, type RealizeInput } from "./grid";
import type { CompositionPattern, PageBlueprint } from "./composition";

// ─────────────────────────────────────────────────────────────
// 공용: A4 portrait 기준
// ─────────────────────────────────────────────────────────────
//   210 × 297 mm, 12 columns, gutter 4, bleed 3, margin top/bottom 20, inside 25 outside 15
//
// 좌측 페이지 환산:
//   resolvedMargins = { top: 20, bottom: 20, left: 15 (outside), right: 25 (inside) }
//   contentX = 15
//   contentY = 20
//   contentW = 210 - 15 - 25 = 170
//   contentH = 297 - 20 - 20 = 257
//   colW = (170 - 4*11) / 12 = (170 - 44) / 12 = 126 / 12 = 10.5
//   gutter = 4
//
// 12행 패턴 가정: rowH = 257 / 12 = 21.41666...

const A4_FORMAT: RealizeInput["format"] = {
  width: 210,
  height: 297,
  columns: 12,
  gutter: 4,
  bleed: { top: 3, right: 3, bottom: 3, left: 3 },
};
const LEFT_PAGE_MARGINS = { top: 20, bottom: 20, left: 15, right: 25 };
const RIGHT_PAGE_MARGINS = { top: 20, bottom: 20, left: 25, right: 15 };

function approx(actual: number, expected: number, label: string, eps = 1e-6) {
  if (Math.abs(actual - expected) > eps) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
  console.log(`  OK  ${label} = ${actual}`);
}

// ─────────────────────────────────────────────────────────────
// 1. 본문 1단 패턴 — 풀폭 텍스트 박스
// ─────────────────────────────────────────────────────────────

console.log("Test 1: body-1col 풀폭 텍스트");
{
  const pattern: CompositionPattern = {
    slug: "body-1col",
    name: "본문 1단",
    description: "풀폭 본문",
    role: "body",
    totalRows: 12,
    slots: [
      {
        id: "body",
        kind: "text",
        label: "본문",
        paragraphStyleId: "body",
        area: { column: 1, columnSpan: 12, row: 1, rowSpan: -1 },
      },
    ],
  };
  const blueprint: PageBlueprint = {
    pattern: "body-1col",
    content: { body: "Lorem ipsum dolor sit amet." },
  };
  const frames = realize({
    blueprint,
    pattern,
    format: A4_FORMAT,
    resolvedMargins: LEFT_PAGE_MARGINS,
    side: "left",
  });

  if (frames.length !== 1) throw new Error(`expected 1 frame, got ${frames.length}`);
  const f = frames[0];
  approx(f.x, 15, "body.x");
  approx(f.y, 20, "body.y");
  approx(f.width, 170, "body.width"); // 12*10.5 + 11*4 = 126 + 44 = 170
  approx(f.height, 257, "body.height"); // 12 * (257/12) = 257
}

// ─────────────────────────────────────────────────────────────
// 2. 좌이미지+우텍스트 — balanced 변형
// ─────────────────────────────────────────────────────────────

console.log("\nTest 2: left-image-right-text balanced");
{
  const pattern: CompositionPattern = {
    slug: "left-image-right-text",
    name: "좌 이미지 + 우 텍스트",
    description: "",
    role: "body",
    totalRows: 12,
    slots: [
      {
        id: "hero",
        kind: "image",
        label: "이미지",
        area: { column: 1, columnSpan: 6, row: 1, rowSpan: -1 },
      },
      {
        id: "body",
        kind: "text",
        label: "본문",
        paragraphStyleId: "body",
        area: { column: 7, columnSpan: 6, row: 1, rowSpan: -1 },
      },
    ],
    variants: [
      {
        id: "imageWeight",
        label: "이미지 비중",
        defaultValue: "balanced",
        options: [
          {
            value: "narrow",
            override: { hero: { columnSpan: 4 }, body: { column: 5, columnSpan: 8 } },
          },
          { value: "balanced" },
          {
            value: "wide",
            override: { hero: { columnSpan: 8 }, body: { column: 9, columnSpan: 4 } },
          },
        ],
      },
    ],
  };
  const blueprint: PageBlueprint = {
    pattern: "left-image-right-text",
    variants: { imageWeight: "balanced" },
    content: { hero: { src: "https://example.com/x.jpg" }, body: "본문 텍스트" },
  };
  const frames = realize({
    blueprint,
    pattern,
    format: A4_FORMAT,
    resolvedMargins: LEFT_PAGE_MARGINS,
    side: "left",
  });

  // hero: column 1, span 6 → x=15, w=6*10.5+5*4 = 63+20 = 83
  const hero = frames.find((f) => f.id === "hero")!;
  approx(hero.x, 15, "hero.x");
  approx(hero.width, 83, "hero.width (6 cols)");
  // body: column 7, span 6 → x = 15 + 6*(10.5+4) = 15 + 6*14.5 = 15+87 = 102; w = 83
  const body = frames.find((f) => f.id === "body")!;
  approx(body.x, 102, "body.x");
  approx(body.width, 83, "body.width (6 cols)");
}

// ─────────────────────────────────────────────────────────────
// 3. 같은 패턴, narrow 변형 — override 적용 확인
// ─────────────────────────────────────────────────────────────

console.log("\nTest 3: left-image-right-text narrow (이미지 4칸 / 텍스트 8칸)");
{
  const pattern: CompositionPattern = {
    slug: "lir",
    name: "",
    description: "",
    role: "body",
    totalRows: 12,
    slots: [
      {
        id: "hero",
        kind: "image",
        label: "",
        area: { column: 1, columnSpan: 6, row: 1, rowSpan: -1 },
      },
      {
        id: "body",
        kind: "text",
        label: "",
        paragraphStyleId: "body",
        area: { column: 7, columnSpan: 6, row: 1, rowSpan: -1 },
      },
    ],
    variants: [
      {
        id: "w",
        label: "",
        defaultValue: "balanced",
        options: [
          {
            value: "narrow",
            override: { hero: { columnSpan: 4 }, body: { column: 5, columnSpan: 8 } },
          },
          { value: "balanced" },
        ],
      },
    ],
  };
  const blueprint: PageBlueprint = {
    pattern: "lir",
    variants: { w: "narrow" },
    content: { hero: { src: "x" }, body: "y" },
  };
  const frames = realize({
    blueprint,
    pattern,
    format: A4_FORMAT,
    resolvedMargins: LEFT_PAGE_MARGINS,
    side: "left",
  });
  const hero = frames.find((f) => f.id === "hero")!;
  approx(hero.width, 4 * 10.5 + 3 * 4, "hero.width (4 cols, narrow)"); // 42 + 12 = 54
  const body = frames.find((f) => f.id === "body")!;
  approx(body.x, 15 + 4 * (10.5 + 4), "body.x (col=5, narrow)"); // 15 + 4*14.5 = 73
  approx(body.width, 8 * 10.5 + 7 * 4, "body.width (8 cols, narrow)"); // 84 + 28 = 112
}

// ─────────────────────────────────────────────────────────────
// 4. EdgeAffinity — insideEdge 가 좌·우 페이지에서 자동 미러링
// ─────────────────────────────────────────────────────────────

console.log("\nTest 4: insideEdge 미러링");
{
  // 페이지 번호처럼 "안쪽 가장자리에 붙는" 작은 박스를
  // 왼쪽 페이지에서는 우측, 오른쪽 페이지에서는 좌측에 자동 배치.
  const pattern: CompositionPattern = {
    slug: "edge-test",
    name: "",
    description: "",
    role: "body",
    totalRows: 12,
    slots: [
      {
        id: "page-num",
        kind: "text",
        label: "",
        paragraphStyleId: "caption",
        area: { column: 1, columnSpan: 2, row: 12, rowSpan: 1 },
        edge: "insideEdge",
      },
    ],
  };
  const blueprint: PageBlueprint = { pattern: "edge-test", content: { "page-num": "1" } };

  // 왼쪽 페이지: insideEdge = 우측 → column 1이 column 11로 미러링
  const leftFrames = realize({
    blueprint,
    pattern,
    format: A4_FORMAT,
    resolvedMargins: LEFT_PAGE_MARGINS,
    side: "left",
  });
  const leftBox = leftFrames[0];
  // 미러링 후 column = 12 - (1+2-1) + 1 = 12 - 2 + 1 = 11
  // x = 15 + (11-1) * (10.5 + 4) = 15 + 10*14.5 = 15 + 145 = 160
  approx(leftBox.x, 160, "left page insideEdge.x → 우측");

  // 오른쪽 페이지: insideEdge = 좌측 → 미러링 안 함, column 1 그대로
  const rightFrames = realize({
    blueprint,
    pattern,
    format: A4_FORMAT,
    resolvedMargins: RIGHT_PAGE_MARGINS,
    side: "right",
  });
  const rightBox = rightFrames[0];
  // 오른쪽 페이지의 마진은 left=25 (inside), right=15 (outside)
  // contentX = 25, x = 25 + 0 = 25
  approx(rightBox.x, 25, "right page insideEdge.x → 좌측 (마진 inside=25 적용)");
}

// ─────────────────────────────────────────────────────────────
// 5. 풀블리드 — bleedToEdge
// ─────────────────────────────────────────────────────────────

console.log("\nTest 5: bleedToEdge 풀블리드");
{
  const pattern: CompositionPattern = {
    slug: "full-bleed",
    name: "",
    description: "",
    role: "media",
    totalRows: 12,
    slots: [
      {
        id: "hero",
        kind: "image",
        label: "",
        area: { column: 1, columnSpan: 12, row: 1, rowSpan: -1 },
        bleedToEdge: true,
      },
    ],
  };
  const blueprint: PageBlueprint = { pattern: "full-bleed", content: { hero: { src: "x" } } };
  const frames = realize({
    blueprint,
    pattern,
    format: A4_FORMAT,
    resolvedMargins: LEFT_PAGE_MARGINS,
    side: "left",
  });
  const f = frames[0];
  approx(f.x, -3, "bleed.x = -bleed.left");
  approx(f.y, -3, "bleed.y = -bleed.top");
  approx(f.width, 216, "bleed.width = 210 + 3 + 3");
  approx(f.height, 303, "bleed.height = 297 + 3 + 3");
}

// ─────────────────────────────────────────────────────────────
// 6. 필수 슬롯 콘텐츠 누락 → 명확한 에러
// ─────────────────────────────────────────────────────────────

console.log("\nTest 6: 필수 슬롯 누락 시 에러");
{
  const pattern: CompositionPattern = {
    slug: "x",
    name: "",
    description: "",
    role: "body",
    totalRows: 12,
    slots: [
      {
        id: "title",
        kind: "text",
        label: "",
        paragraphStyleId: "h1",
        area: { column: 1, columnSpan: 12, row: 1, rowSpan: 2 },
      },
    ],
  };
  const blueprint: PageBlueprint = { pattern: "x", content: {} };
  let threw = false;
  try {
    realize({
      blueprint,
      pattern,
      format: A4_FORMAT,
      resolvedMargins: LEFT_PAGE_MARGINS,
      side: "left",
    });
  } catch (e) {
    threw = true;
    console.log(`  OK  threw: ${(e as Error).message}`);
  }
  if (!threw) throw new Error("expected throw on missing required slot content");
}

// ─────────────────────────────────────────────────────────────
// 7. 결정론 — 같은 입력 두 번 호출 시 동일 출력
// ─────────────────────────────────────────────────────────────

console.log("\nTest 7: 결정론");
{
  const pattern: CompositionPattern = {
    slug: "d",
    name: "",
    description: "",
    role: "body",
    totalRows: 12,
    slots: [
      {
        id: "body",
        kind: "text",
        label: "",
        paragraphStyleId: "body",
        area: { column: 1, columnSpan: 12, row: 1, rowSpan: -1 },
      },
    ],
  };
  const bp: PageBlueprint = { pattern: "d", content: { body: "x" } };
  const a = realize({
    blueprint: bp,
    pattern,
    format: A4_FORMAT,
    resolvedMargins: LEFT_PAGE_MARGINS,
    side: "left",
  });
  const b = realize({
    blueprint: bp,
    pattern,
    format: A4_FORMAT,
    resolvedMargins: LEFT_PAGE_MARGINS,
    side: "left",
  });
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error("non-deterministic output");
  }
  console.log("  OK  identical output");
}

console.log("\n전체 7개 테스트 모두 통과.");
