/**
 * 디자인 카탈로그 로더 — `public/design-md/<slug>.md` → DesignTokens.
 *
 * ─────────────────────────────────────────────────────────────
 * 정책 (lib/types/document.ts §10)
 * ─────────────────────────────────────────────────────────────
 *
 * - 카탈로그 (`public/design-md/<slug>.md`) 는 read-only.
 * - 새 프로젝트 생성 시 1회 복사 → Document.designTokens 에 박힘.
 * - 사용자 편집은 인스턴스(Document.designTokens)에만 반영, 카탈로그 안 건드림.
 * - 카탈로그 수정은 *기존* 프로젝트에 영향 없음. 새 프로젝트만 새 카탈로그 시드.
 *
 * ─────────────────────────────────────────────────────────────
 * 파일 형식 (default.md 기준)
 * ─────────────────────────────────────────────────────────────
 *
 * 1) YAML 프론트매터 (--- ... ---) — slug, name, description, version, license, author
 * 2) 본문 마크다운 — 사람이 읽는 가이드 (style 가이드, voice 등)
 * 3) YAML 코드블록 (```yaml ... ```) — 구조화 데이터 (gridVocabulary, paragraphStyles 등)
 * 4) 단순 키-밸류 (- key: value) — palette, typography
 *
 * 1차 default.md 만 지원. 카탈로그 형식이 늘어나면 yaml 패키지 도입 검토.
 * 의존성 0 — 자체 미니 파서.
 *
 * ─────────────────────────────────────────────────────────────
 * 사용
 * ─────────────────────────────────────────────────────────────
 *
 *   const tokens = await loadDesignTokens("default");
 *   // 새 프로젝트 시 createProject() 가 이걸 designTokens 에 박음
 *
 * 이 함수는 서버 전용 (fs.readFile). 빌드 시점이 아니라 런타임에 읽음.
 * Vercel Node 런타임에서 public/ 경로 OK. Edge 런타임은 미지원.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DesignTokens } from "@/lib/types/design-tokens";
import type {
  ParagraphStyle,
  CharacterStyle,
  Color,
  Font,
} from "@/lib/types/styles";

// ─────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────

export class DesignTokenLoadError extends Error {
  readonly code:
    | "FILE_NOT_FOUND"
    | "FRONTMATTER_INVALID"
    | "PARSE_FAILED"
    | "INVALID_SHAPE";
  constructor(code: DesignTokenLoadError["code"], message: string) {
    super(message);
    this.name = "DesignTokenLoadError";
    this.code = code;
  }
}

/**
 * 디자인 카탈로그 1개를 읽어 DesignTokens 로 변환.
 *
 * @param slug  카탈로그 슬러그. `public/design-md/{slug}.md` 가 실제 파일.
 * @returns     DesignTokens (gridVocabulary, rhythmGuide, palette, print 모두 채워짐)
 */
export async function loadDesignTokens(slug: string): Promise<DesignTokens> {
  const path = join(process.cwd(), "public", "design-md", `${slug}.md`);

  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (e) {
    throw new DesignTokenLoadError(
      "FILE_NOT_FOUND",
      `디자인 카탈로그 파일을 찾을 수 없습니다: ${path}`,
    );
  }

  return parseDesignMd(raw);
}

/**
 * 카탈로그 마크다운 문자열을 DesignTokens 로 파싱.
 * 테스트에서 파일 없이 직접 문자열로 호출 가능.
 */
export function parseDesignMd(raw: string): DesignTokens {
  // 1) 프론트매터 추출
  const frontmatter = extractFrontmatter(raw);

  // 2) 본문에서 색상 (palette) 추출 — "# 2. Color" 섹션의 - key: value
  const palette = extractPalette(raw);

  // 3) 본문에서 타이포그래피 — "# 3. Typography"
  const typography = extractTypography(raw);

  // 4) YAML 코드블록 모두 모아서 키별 매핑
  const yamlBlocks = extractYamlBlocks(raw);

  // 5) gridVocabulary — Grid Vocabulary 섹션 다음의 yaml 블록
  const gridVocabulary = extractGridVocabulary(raw, yamlBlocks);

  // 6) rhythmGuide — Rhythm 섹션의 본문 (자연어)
  const rhythmGuide = extractRhythmGuide(raw);

  // 7) print 섹션 — Paragraph Styles, Character Styles, Fonts, Colors, CMYK
  const print = extractPrint(raw, yamlBlocks);

  return {
    slug: frontmatter.slug,
    name: frontmatter.name,
    description: frontmatter.description,
    version: frontmatter.version,
    license: frontmatter.license,
    author: frontmatter.author
      ? {
          id: frontmatter.author,
          name: frontmatter.author === "handoff-builtin" ? "Handoff" : frontmatter.author,
        }
      : undefined,
    palette,
    typography,
    gridVocabulary,
    rhythmGuide,
    print,
  };
}

// ─────────────────────────────────────────────────────────────
// 프론트매터 (--- ... ---)
// ─────────────────────────────────────────────────────────────

type Frontmatter = {
  slug: string;
  name: string;
  description?: string;
  version?: string;
  author?: string;
  license?: string;
};

function extractFrontmatter(raw: string): Frontmatter {
  // 파일 첫줄이 "---" 이고 다음 "---" 까지가 프론트매터
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) {
    throw new DesignTokenLoadError(
      "FRONTMATTER_INVALID",
      "프론트매터 (--- ... ---) 가 파일 시작에 없습니다.",
    );
  }

  const lines = match[1].split("\n");
  const fm: Partial<Frontmatter> = {};
  for (const line of lines) {
    const m = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim();
    if (key === "slug") fm.slug = value;
    else if (key === "name") fm.name = value;
    else if (key === "description") fm.description = value;
    else if (key === "version") fm.version = value;
    else if (key === "author") fm.author = value;
    else if (key === "license") fm.license = value;
  }

  if (!fm.slug || !fm.name) {
    throw new DesignTokenLoadError(
      "FRONTMATTER_INVALID",
      "프론트매터에 slug 또는 name 이 없습니다.",
    );
  }

  return fm as Frontmatter;
}

// ─────────────────────────────────────────────────────────────
// 색상 팔레트 (# 2. Color 섹션)
// ─────────────────────────────────────────────────────────────

function extractPalette(raw: string): DesignTokens["palette"] {
  // "# 2. Color" 섹션의 다음 섹션 전까지
  const section = extractMarkdownSection(raw, "Color");
  if (!section) {
    throw new DesignTokenLoadError(
      "INVALID_SHAPE",
      "# 2. Color 섹션을 찾지 못했습니다.",
    );
  }

  const palette: Record<string, string> = {};
  // "- key: #HEX" 추출
  for (const line of section.split("\n")) {
    const m = line.match(/^\s*-\s*([a-zA-Z]+):\s*(#[0-9a-fA-F]{3,8})/);
    if (m) {
      palette[m[1]] = m[2];
    }
  }

  // 필수 키 6 개
  const required = [
    "background",
    "surface",
    "text",
    "textMuted",
    "accent",
    "border",
  ] as const;
  for (const k of required) {
    if (!palette[k]) {
      throw new DesignTokenLoadError(
        "INVALID_SHAPE",
        `palette.${k} 값이 카탈로그에 없습니다.`,
      );
    }
  }

  return {
    background: palette.background,
    surface: palette.surface,
    text: palette.text,
    textMuted: palette.textMuted,
    accent: palette.accent,
    border: palette.border,
  };
}

// ─────────────────────────────────────────────────────────────
// 타이포그래피 (# 3. Typography 섹션)
// ─────────────────────────────────────────────────────────────

function extractTypography(raw: string): DesignTokens["typography"] {
  const section = extractMarkdownSection(raw, "Typography");
  if (!section) {
    throw new DesignTokenLoadError(
      "INVALID_SHAPE",
      "# 3. Typography 섹션을 찾지 못했습니다.",
    );
  }

  const map: Record<string, string> = {};
  for (const line of section.split("\n")) {
    // "- key: value" 또는 "- key:    value" — value 는 string/number 모두
    const m = line.match(/^\s*-\s*([a-zA-Z]+):\s*(.+?)\s*$/);
    if (m) {
      map[m[1]] = m[2];
    }
  }

  const headingFamily = map.headingFamily;
  const bodyFamily = map.bodyFamily;
  const monoFamily = map.monoFamily;
  const bodySize = parseFloat(map.bodySize);
  const bodyLineHeight = parseFloat(map.bodyLineHeight);

  if (!headingFamily || !bodyFamily) {
    throw new DesignTokenLoadError(
      "INVALID_SHAPE",
      "typography.headingFamily / bodyFamily 가 카탈로그에 없습니다.",
    );
  }
  if (Number.isNaN(bodySize) || Number.isNaN(bodyLineHeight)) {
    throw new DesignTokenLoadError(
      "INVALID_SHAPE",
      "typography.bodySize / bodyLineHeight 가 숫자가 아닙니다.",
    );
  }

  return {
    headingFamily,
    bodyFamily,
    monoFamily,
    bodySize,
    bodyLineHeight,
  };
}

// ─────────────────────────────────────────────────────────────
// gridVocabulary — # 4. Grid Vocabulary 의 yaml 블록
// ─────────────────────────────────────────────────────────────

function extractGridVocabulary(
  raw: string,
  yamlBlocks: YamlBlock[],
): number[][] {
  // Grid Vocabulary 섹션 안에 들어있는 yaml 블록 찾기
  const sectionStart = findHeadingIndex(raw, "Grid Vocabulary");
  if (sectionStart === -1) {
    throw new DesignTokenLoadError(
      "INVALID_SHAPE",
      "# 4. Grid Vocabulary 섹션을 찾지 못했습니다.",
    );
  }

  // 그 섹션 안에 들어있는 첫 yaml 블록
  const block = yamlBlocks.find(
    (b) => b.startIndex > sectionStart && isInSection(b.startIndex, raw, "Grid Vocabulary"),
  );
  if (!block) {
    throw new DesignTokenLoadError(
      "INVALID_SHAPE",
      "Grid Vocabulary 섹션에 yaml 블록이 없습니다.",
    );
  }

  // yaml 안의 "- [12]" / "- [6, 6]" 같은 줄을 number[] 로 파싱
  const result: number[][] = [];
  for (const line of block.body.split("\n")) {
    const m = line.match(/^\s*-\s*\[([\d,\s]+)\]/);
    if (m) {
      const nums = m[1]
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));
      if (nums.length > 0) result.push(nums);
    }
  }

  if (result.length === 0) {
    throw new DesignTokenLoadError(
      "INVALID_SHAPE",
      "gridVocabulary 가 비어있습니다 — '- [12]' 같은 형태가 0개.",
    );
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// rhythmGuide — # 5. Rhythm 섹션의 본문 자연어
// ─────────────────────────────────────────────────────────────

function extractRhythmGuide(raw: string): string | undefined {
  const section = extractMarkdownSection(raw, "Rhythm");
  if (!section) return undefined;

  // 코드블록 / 빈 줄 / 주석 제거하고 자연어 합치기
  const lines = section
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !l.startsWith("```"))
    .filter((l) => !l.startsWith("#"));

  const text = lines.join(" ").trim();
  return text.length > 0 ? text : undefined;
}

// ─────────────────────────────────────────────────────────────
// print — # Print 섹션 + 그 아래 yaml 블록들
// ─────────────────────────────────────────────────────────────

function extractPrint(
  raw: string,
  yamlBlocks: YamlBlock[],
): DesignTokens["print"] {
  const printIdx = findHeadingIndex(raw, "Print");
  if (printIdx === -1) {
    return undefined;
  }

  // Print 섹션 안의 yaml 블록만 — 그 위치보다 뒤
  const printBlocks = yamlBlocks.filter((b) => b.startIndex > printIdx);

  const print: NonNullable<DesignTokens["print"]> = {};

  // 각 yaml 블록을 그 위 가장 가까운 ## 헤딩 기준으로 분류
  for (const block of printBlocks) {
    const heading = findClosestHeadingAbove(raw, block.startIndex);
    if (!heading) continue;
    const name = heading.toLowerCase();

    if (name.includes("cmyk") || name.includes("pantone")) {
      print.cmyk = parseCmykYaml(block.body);
    } else if (name.includes("paragraph")) {
      print.paragraphStyles = parseParagraphStylesYaml(block.body);
    } else if (name.includes("character")) {
      print.characterStyles = parseCharacterStylesYaml(block.body);
    } else if (name === "fonts" || name.endsWith("fonts")) {
      print.fonts = parseFontsYaml(block.body);
    } else if (name === "colors" || name.endsWith("colors")) {
      print.colors = parseColorsYaml(block.body);
    }
  }

  return print;
}

// ─────────────────────────────────────────────────────────────
// YAML 미니 파서 — default.md 가 사용하는 단순 형태만 지원
// ─────────────────────────────────────────────────────────────

type YamlBlock = {
  startIndex: number;
  body: string;
};

function extractYamlBlocks(raw: string): YamlBlock[] {
  // ```yaml ... ``` 추출
  const blocks: YamlBlock[] = [];
  const re = /```yaml\s*\n([\s\S]*?)\n?```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    blocks.push({ startIndex: m.index, body: m[1] });
  }
  return blocks;
}

/**
 * "- id: foo\n  name: bar\n  fontSize: 12\n" 같은 객체 배열 파싱.
 * default.md 가 사용하는 형태 (들여쓰기 2칸, 단순 key: value 만).
 *
 * 중첩 객체(cmyk: { c: 0, m: 0 ... }) 는 별도 처리 — parseCmykYaml.
 */
function parseObjectArrayYaml(body: string): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  let current: Record<string, unknown> | null = null;

  const lines = body.split("\n");
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    if (line.trim().startsWith("#")) continue;

    // "- key: value" 새 항목 시작
    const newItem = line.match(/^\s*-\s*([a-zA-Z]+):\s*(.*)$/);
    if (newItem) {
      if (current) items.push(current);
      current = {};
      current[newItem[1]] = parseYamlValue(newItem[2]);
      continue;
    }

    // "  key: value" 또는 "  key: { ... }" 같은 줄
    if (current) {
      const kv = line.match(/^\s+([a-zA-Z][a-zA-Z0-9_]*):\s*(.*)$/);
      if (kv) {
        current[kv[1]] = parseYamlValue(kv[2]);
      }
    }
  }
  if (current) items.push(current);
  return items;
}

/**
 * YAML 값 한 줄 파싱.
 * - 숫자, boolean, "..." 또는 '...' string, [a, b, c] 배열, { k: v } 객체 inline,
 *   bare string (따옴표 없는 단어).
 */
function parseYamlValue(raw: string): unknown {
  const v = raw.trim();
  if (v.length === 0) return "";

  // 숫자
  if (/^-?\d+(\.\d+)?$/.test(v)) return parseFloat(v);
  // boolean
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  // 따옴표 string
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  // inline 배열
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner.split(",").map((s) => parseYamlValue(s.trim()));
  }
  // inline 객체 — { key: value, key: value }
  if (v.startsWith("{") && v.endsWith("}")) {
    const inner = v.slice(1, -1).trim();
    const obj: Record<string, unknown> = {};
    // 간단 분리 — 콤마 기준 (default.md 의 cmyk inline 형태만 다룸)
    for (const pair of inner.split(",")) {
      const m = pair.match(/^\s*([a-zA-Z]+):\s*(.+?)\s*$/);
      if (m) obj[m[1]] = parseYamlValue(m[2]);
    }
    return obj;
  }
  // bare string
  return v;
}

// ─────────────────────────────────────────────────────────────
// print.* 별 파서 — 타입 안전 변환
// ─────────────────────────────────────────────────────────────

function parseCmykYaml(body: string): NonNullable<DesignTokens["print"]>["cmyk"] {
  // 형태:
  //   "#FFFFFF":
  //     c: 0
  //     m: 0
  //     ...
  const cmyk: Record<string, { c: number; m: number; y: number; k: number; pantone?: string }> = {};
  const lines = body.split("\n");

  let currentHex: string | null = null;
  let currentObj: { c?: number; m?: number; y?: number; k?: number; pantone?: string } | null = null;

  const flush = () => {
    if (currentHex && currentObj) {
      const { c, m, y, k, pantone } = currentObj;
      if (
        typeof c === "number" &&
        typeof m === "number" &&
        typeof y === "number" &&
        typeof k === "number"
      ) {
        cmyk[currentHex] = { c, m, y, k, ...(pantone ? { pantone } : {}) };
      }
    }
  };

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    if (line.trim().startsWith("#")) continue;

    // "\"#HEX\":" — 새 색상 시작
    const headerMatch = line.match(/^\s*"(#[0-9a-fA-F]{3,8})":\s*$/);
    if (headerMatch) {
      flush();
      currentHex = headerMatch[1];
      currentObj = {};
      continue;
    }

    // "  c: 0" / "  pantone: Black 6 C"
    const kv = line.match(/^\s+([a-zA-Z]+):\s*(.+?)\s*$/);
    if (kv && currentObj) {
      const k = kv[1];
      const v = parseYamlValue(kv[2]);
      if (k === "c" || k === "m" || k === "y" || k === "k") {
        if (typeof v === "number") currentObj[k] = v;
      } else if (k === "pantone") {
        if (typeof v === "string") currentObj.pantone = v;
      }
    }
  }
  flush();
  return Object.keys(cmyk).length > 0 ? cmyk : undefined;
}

function parseParagraphStylesYaml(body: string): ParagraphStyle[] {
  const items = parseObjectArrayYaml(body);
  const result: ParagraphStyle[] = [];
  for (const it of items) {
    const id = it.id;
    const name = it.name;
    const fontFamily = it.fontFamily;
    const fontSize = it.fontSize;
    const lineHeight = it.lineHeight;
    const alignment = it.alignment;
    if (
      typeof id !== "string" ||
      typeof name !== "string" ||
      typeof fontFamily !== "string" ||
      typeof fontSize !== "number" ||
      (typeof lineHeight !== "number" && typeof lineHeight !== "object") ||
      (alignment !== "left" && alignment !== "center" && alignment !== "right" && alignment !== "justify")
    ) {
      // 형식 안 맞는 줄은 건너뜀 — 1차 검증 단계는 관대하게
      continue;
    }
    const style: ParagraphStyle = {
      id,
      name,
      fontFamily,
      fontSize,
      lineHeight: lineHeight as ParagraphStyle["lineHeight"],
      alignment,
    };
    if (typeof it.basedOn === "string") style.basedOn = it.basedOn;
    if (typeof it.colorId === "string") style.colorId = it.colorId;
    if (typeof it.firstLineIndent === "number") style.firstLineIndent = it.firstLineIndent;
    if (typeof it.leftIndent === "number") style.leftIndent = it.leftIndent;
    if (typeof it.rightIndent === "number") style.rightIndent = it.rightIndent;
    if (typeof it.spaceBefore === "number") style.spaceBefore = it.spaceBefore;
    if (typeof it.spaceAfter === "number") style.spaceAfter = it.spaceAfter;
    if (typeof it.tracking === "number") style.tracking = it.tracking;
    if (typeof it.hyphenation === "boolean") style.hyphenation = it.hyphenation;
    if (typeof it.keepWithNext === "number") style.keepWithNext = it.keepWithNext;
    if (typeof it.keepLinesTogether === "boolean") style.keepLinesTogether = it.keepLinesTogether;
    result.push(style);
  }
  return result;
}

function parseCharacterStylesYaml(body: string): CharacterStyle[] {
  const items = parseObjectArrayYaml(body);
  const result: CharacterStyle[] = [];
  for (const it of items) {
    if (typeof it.id !== "string" || typeof it.name !== "string") continue;
    const style: CharacterStyle = { id: it.id, name: it.name };
    if (typeof it.basedOn === "string") style.basedOn = it.basedOn;
    if (typeof it.fontFamily === "string") style.fontFamily = it.fontFamily;
    if (typeof it.fontSize === "number") style.fontSize = it.fontSize;
    if (typeof it.weight === "number" || typeof it.weight === "string") style.weight = it.weight;
    if (typeof it.italic === "boolean") style.italic = it.italic;
    if (typeof it.underline === "boolean") style.underline = it.underline;
    if (typeof it.tracking === "number") style.tracking = it.tracking;
    if (typeof it.colorId === "string") style.colorId = it.colorId;
    result.push(style);
  }
  return result;
}

function parseFontsYaml(body: string): Font[] {
  const items = parseObjectArrayYaml(body);
  const result: Font[] = [];
  for (const it of items) {
    const family = it.family;
    const displayName = it.displayName;
    const license = it.license;
    const redistributable = it.redistributable;
    if (
      typeof family !== "string" ||
      typeof displayName !== "string" ||
      typeof license !== "string" ||
      typeof redistributable !== "boolean"
    ) {
      continue;
    }
    const validLicenses = [
      "OFL",
      "Apache-2.0",
      "commercial",
      "user-uploaded",
      "unknown",
    ];
    if (!validLicenses.includes(license)) continue;
    const font: Font = {
      family,
      displayName,
      license: license as Font["license"],
      redistributable,
    };
    if (typeof it.filePath === "string") font.filePath = it.filePath;
    if (Array.isArray(it.fallbacks)) {
      font.fallbacks = (it.fallbacks as unknown[]).filter(
        (s): s is string => typeof s === "string",
      );
    }
    result.push(font);
  }
  return result;
}

function parseColorsYaml(body: string): Color[] {
  const items = parseObjectArrayYaml(body);
  const result: Color[] = [];
  for (const it of items) {
    if (typeof it.id !== "string" || typeof it.name !== "string" || typeof it.hex !== "string") {
      continue;
    }
    const color: Color = { id: it.id, name: it.name, hex: it.hex };
    if (typeof it.cmyk === "object" && it.cmyk !== null) {
      const cmyk = it.cmyk as Record<string, unknown>;
      if (
        typeof cmyk.c === "number" &&
        typeof cmyk.m === "number" &&
        typeof cmyk.y === "number" &&
        typeof cmyk.k === "number"
      ) {
        color.cmyk = { c: cmyk.c, m: cmyk.m, y: cmyk.y, k: cmyk.k };
      }
    }
    if (typeof it.pantone === "string") color.pantone = it.pantone;
    if (typeof it.spot === "boolean") color.spot = it.spot;
    result.push(color);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// 마크다운 헬퍼 — 섹션 추출
// ─────────────────────────────────────────────────────────────

/**
 * "# N. {title}" 또는 "## {title}" 형태의 헤딩 위치 (문자 인덱스).
 * 못 찾으면 -1.
 */
function findHeadingIndex(raw: string, title: string): number {
  // # 1. Identity / # 2. Color / ## CMYK & Pantone 등 모두 매치
  const re = new RegExp(`^#+\\s+(?:\\d+\\.?\\s*)?${escapeRegex(title)}\\b`, "im");
  const m = re.exec(raw);
  return m ? m.index : -1;
}

/**
 * 헤딩 다음부터 다음 같은 레벨 헤딩 직전까지 본문 추출.
 */
function extractMarkdownSection(raw: string, title: string): string | null {
  const startIdx = findHeadingIndex(raw, title);
  if (startIdx === -1) return null;

  // 헤딩 줄 끝부터 시작
  const afterHeading = raw.indexOf("\n", startIdx);
  if (afterHeading === -1) return null;

  // 다음 같은 레벨 또는 더 큰 레벨 헤딩 찾기
  const headingMatch = raw.slice(startIdx).match(/^(#+)\s/m);
  if (!headingMatch) return null;
  const startLevel = headingMatch[1].length;

  const nextHeadingRe = new RegExp(`^#{1,${startLevel}}\\s`, "m");
  const remainder = raw.slice(afterHeading + 1);
  const nextMatch = nextHeadingRe.exec(remainder);
  const endIdx = nextMatch ? afterHeading + 1 + nextMatch.index : raw.length;

  return raw.slice(afterHeading + 1, endIdx);
}

/**
 * 주어진 인덱스가 특정 섹션 안에 들어있는지.
 */
function isInSection(index: number, raw: string, title: string): boolean {
  const startIdx = findHeadingIndex(raw, title);
  if (startIdx === -1 || index <= startIdx) return false;

  const headingMatch = raw.slice(startIdx).match(/^(#+)\s/m);
  if (!headingMatch) return false;
  const startLevel = headingMatch[1].length;

  // 같은 레벨 또는 위 레벨 다음 헤딩까지 안에 있어야
  const nextHeadingRe = new RegExp(`^#{1,${startLevel}}\\s`, "gm");
  nextHeadingRe.lastIndex = raw.indexOf("\n", startIdx) + 1;
  const next = nextHeadingRe.exec(raw);
  if (!next) return true; // 끝까지
  return index < next.index;
}

/**
 * 주어진 위치 직전의 가장 가까운 ## 헤딩 텍스트.
 * Print 섹션의 yaml 블록을 어떤 하위 헤딩에 속한 건지 분류할 때 사용.
 */
function findClosestHeadingAbove(raw: string, index: number): string | null {
  const before = raw.slice(0, index);
  // ## Foo 또는 # Foo 모두 매치
  const matches = [...before.matchAll(/^(#{1,3})\s+(.+)$/gm)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][2].trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
