"use client";

/**
 * 분류 결과 시각화 — ClassifyLab과 NewProjectFlow에서 공유.
 *
 * 입력: ClassifiedManuscript
 * 출력: 메타 + 비용 + kind 분포 + 섹션 카드 + 블록 본문 (색깔별 매핑) + warnings + JSON details
 *
 * 책임:
 *   - 결과 *표시*만 담당. 입력·호출·라우팅·저장은 부모가 책임.
 *   - 옵셔널 children prop 으로 결과 아래 추가 UI(예: "이 결과로 시작하기" 버튼) 슬롯 제공.
 *
 * 옵션 A 분리 정책:
 *   - 두 호출 사이트(ClassifyLab, NewProjectFlow)에서 동일한 결과 표시.
 *   - 미래 보정 UI(섹션 합치기, 라벨 수정 등)는 이 컴포넌트 내부에서 박힘 → 양쪽 동시 적용.
 *   - 호출 사이트별로 다르게 동작해야 하는 부분은 prop 또는 children 으로 외부 주입.
 */

import {
  type ClassifiedManuscript,
  type Section,
  SECTION_KIND_COLORS,
} from "@/lib/classify/types";
import type { Block } from "@/lib/parsers/normalized";

export type ResultViewProps = {
  result: ClassifiedManuscript;
  /**
   * 결과 카드 아래에 추가로 렌더할 슬롯.
   * NewProjectFlow에서 "이 결과로 시작하기" 버튼을 여기 박는다.
   * 비어있으면 (lab 모드) 추가 액션 없음.
   */
  children?: React.ReactNode;
};

export function ResultView({ result, children }: ResultViewProps) {
  // 블록 ID → 섹션 매핑 (어느 블록이 어느 섹션에 속하는지)
  const blockToSection = new Map<string, Section>();
  for (const section of result.sections) {
    const fromIdx = result.blocks.findIndex((b) => b.id === section.fromBlockId);
    const toIdx = result.blocks.findIndex((b) => b.id === section.toBlockId);
    if (fromIdx === -1 || toIdx === -1) continue;
    for (let i = fromIdx; i <= toIdx; i++) {
      blockToSection.set(result.blocks[i].id, section);
    }
  }

  const unclassifiedCount = result.blocks.filter(
    (b) => !blockToSection.has(b.id),
  ).length;

  return (
    <div className="space-y-6">
      {/* 메타 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="형식" value={result.source.format} />
        <Stat label="블록 수" value={String(result.blocks.length)} />
        <Stat label="섹션 수" value={String(result.sections.length)} />
        <Stat
          label="미분류 블록"
          value={String(unclassifiedCount)}
          accent={unclassifiedCount > 0 ? "amber" : undefined}
        />
      </div>

      {/* 비용 */}
      {result.classification && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            호출 비용 / 토큰
          </div>
          <div className="mt-2 grid grid-cols-2 gap-4 text-sm md:grid-cols-5">
            <div>
              <span className="text-neutral-500">model</span>
              <div className="font-mono text-xs">{result.classification.model}</div>
            </div>
            <div>
              <span className="text-neutral-500">입력 토큰</span>
              <div className="font-mono">
                {result.classification.inputTokens.toLocaleString()}
              </div>
            </div>
            <div>
              <span className="text-neutral-500">출력 토큰</span>
              <div className="font-mono">
                {result.classification.outputTokens.toLocaleString()}
              </div>
            </div>
            <div>
              <span className="text-neutral-500">캐시 적중</span>
              <div className="font-mono">
                {(result.classification.cacheReadTokens ?? 0).toLocaleString()}
              </div>
            </div>
            <div>
              <span className="text-neutral-500">비용 (USD)</span>
              <div className="font-mono">
                ${result.classification.rawCostUsd.toFixed(4)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* kind 분포 — 한눈에 */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
          kind 분포
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.keys(SECTION_KIND_COLORS).map((k) => {
            const kind = k as keyof typeof SECTION_KIND_COLORS;
            const count = result.sections.filter((s) => s.kind === kind).length;
            if (count === 0) return null;
            const colors = SECTION_KIND_COLORS[kind];
            return (
              <span
                key={kind}
                className="rounded-full px-3 py-1 text-xs font-medium"
                style={{ backgroundColor: colors.bg, color: colors.text }}
              >
                {colors.label} × {count}
              </span>
            );
          })}
        </div>
      </div>

      {/* 섹션 목록 — 카드 */}
      <div>
        <div className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
          섹션 ({result.sections.length}개)
        </div>
        <div className="space-y-2">
          {result.sections.map((s) => (
            <SectionCard key={s.id} section={s} blocks={result.blocks} />
          ))}
        </div>
      </div>

      {/* 블록 본문 — 섹션 색깔로 표시 */}
      <div>
        <div className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
          블록 본문 (색깔별 섹션 매핑)
        </div>
        <div className="space-y-1">
          {result.blocks.map((b) => {
            const section = blockToSection.get(b.id);
            const colors = section ? SECTION_KIND_COLORS[section.kind] : null;
            return (
              <BlockRow
                key={b.id}
                block={b}
                bgColor={colors?.bg ?? "transparent"}
                textColor={colors?.text ?? "#525252"}
                sectionLabel={section?.label}
              />
            );
          })}
        </div>
      </div>

      {/* warnings */}
      {result.warnings && result.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-amber-700">
            warnings
          </div>
          <ul className="space-y-1 text-sm text-amber-900">
            {result.warnings.map((w, i) => (
              <li key={i}>
                <span className="font-mono text-xs">[{w.severity}]</span> {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 외부 주입 슬롯 — "이 결과로 시작하기" 등 */}
      {children}

      {/* JSON 다운로드 */}
      <details className="rounded-lg border border-neutral-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
          전체 JSON 보기
        </summary>
        <pre className="overflow-auto border-t border-neutral-200 bg-neutral-50 p-4 text-xs">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 내부 컴포넌트
// ─────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "amber";
}) {
  const ring =
    accent === "amber"
      ? "border-amber-300 bg-amber-50"
      : "border-neutral-200 bg-white";
  return (
    <div className={`rounded-lg border p-4 ${ring}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-neutral-900">{value}</div>
    </div>
  );
}

function SectionCard({ section, blocks }: { section: Section; blocks: Block[] }) {
  const colors = SECTION_KIND_COLORS[section.kind];

  // 섹션 안 블록 수
  const fromIdx = blocks.findIndex((b) => b.id === section.fromBlockId);
  const toIdx = blocks.findIndex((b) => b.id === section.toBlockId);
  const blockCount = fromIdx >= 0 && toIdx >= 0 ? toIdx - fromIdx + 1 : 0;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span
              className="rounded px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: colors.bg, color: colors.text }}
            >
              {colors.label}
            </span>
            <span className="font-mono text-xs text-neutral-400">
              {section.id} · {section.fromBlockId} → {section.toBlockId} · {blockCount}블록
            </span>
          </div>
          <div className="mt-2 text-base font-medium text-neutral-900">
            {section.label}
          </div>
          {section.summary && (
            <div className="mt-1 text-sm text-neutral-600">{section.summary}</div>
          )}
          {section.hints && Object.keys(section.hints).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(section.hints).map(([k, v]) => (
                <span
                  key={k}
                  className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600"
                >
                  {k}: {String(v)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BlockRow({
  block,
  bgColor,
  textColor,
  sectionLabel,
}: {
  block: Block;
  bgColor: string;
  textColor: string;
  sectionLabel?: string;
}) {
  const preview = (() => {
    switch (block.type) {
      case "heading":
        return `H${block.level}: ${block.runs.map((r) => r.text).join("")}`;
      case "paragraph":
        return block.runs.map((r) => r.text).join("");
      case "list":
        return `[리스트 ${block.items.length}개] ${block.items.slice(0, 2).map((i) => i.runs.map((r) => r.text).join("")).join(" / ")}${block.items.length > 2 ? " ..." : ""}`;
      case "table":
        return `[표 ${block.rows}×${block.cols}]`;
      case "image":
        return `[이미지${block.alt ? ` "${block.alt}"` : ""}]`;
      case "separator":
        return `─── ${block.kind} ───`;
    }
  })();

  return (
    <div
      className="flex items-start gap-3 rounded px-3 py-1.5 text-sm"
      style={{ backgroundColor: bgColor, color: textColor }}
    >
      <span className="font-mono text-[11px] opacity-60">{block.id}</span>
      <span className="font-mono text-[11px] uppercase opacity-50">
        {block.type}
      </span>
      <span className="flex-1 truncate">{preview}</span>
      {sectionLabel && (
        <span className="text-[11px] opacity-60">{sectionLabel}</span>
      )}
    </div>
  );
}
