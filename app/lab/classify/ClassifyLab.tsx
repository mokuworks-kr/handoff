"use client";

/**
 * Classify Lab 클라이언트 — 파일/텍스트 입력 → /api/classify 호출 → 결과 표시.
 *
 * UI 구성:
 *   상단:  파일 드롭존 + 텍스트 탭
 *   중간:  진행 표시 / 비용·토큰 정보
 *   하단:  결과 — 블록을 sections 색깔로 그룹핑해 표시
 *
 * 검증 포인트 (사용자가 한눈에 보는 것):
 *   1) 분류된 섹션 수 + kind 분포
 *   2) 각 섹션의 label / summary / hints
 *   3) 어느 블록이 어느 섹션에 들어갔는지 (색깔로 구분)
 *   4) 미분류 블록 (회색 — sections에 안 잡힌 블록)
 *   5) 비용 (USD) + 토큰 사용량
 *
 * 사용자가 결과 보고 직접 평가:
 *   - 연혁 페이지가 timeline-like로 잡혔나
 *   - 명백한 표지가 cover-like인가
 *   - 표 페이지가 data-like인가
 *   - 누락된 섹션이 있나
 *   - 두 섹션이 잘못 묶여있지는 않나
 */

import { useState } from "react";
import {
  type ClassifiedManuscript,
  type Section,
  SECTION_KIND_COLORS,
} from "@/lib/classify/types";
import type { Block } from "@/lib/parsers/normalized";

type Mode = "file" | "text";

type ApiError = {
  error: string;
  code?: string;
  message?: string;
  partial?: ClassifiedManuscript;
};

export function ClassifyLab({ userEmail }: { userEmail: string }) {
  const [mode, setMode] = useState<Mode>("file");
  const [textInput, setTextInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ClassifiedManuscript | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/classify", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data);
        if (data.partial) setResult(data.partial);
      } else {
        setResult(data);
      }
    } catch (e) {
      setError({
        error: "network",
        message: e instanceof Error ? e.message : "unknown",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleText = async () => {
    if (textInput.trim().length === 0) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("text", textInput);
      const res = await fetch("/api/classify", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data);
        if (data.partial) setResult(data.partial);
      } else {
        setResult(data);
      }
    } catch (e) {
      setError({
        error: "network",
        message: e instanceof Error ? e.message : "unknown",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-neutral-200 bg-white p-4 text-xs text-neutral-500">
        로그인: <span className="font-mono">{userEmail}</span>
      </div>

      {/* 입력 — 탭 */}
      <div className="rounded-lg border border-neutral-200 bg-white">
        <div className="flex border-b border-neutral-200">
          <button
            onClick={() => setMode("file")}
            className={`px-4 py-3 text-sm font-medium ${
              mode === "file"
                ? "border-b-2 border-neutral-900 text-neutral-900"
                : "text-neutral-500 hover:text-neutral-700"
            }`}
          >
            파일 업로드
          </button>
          <button
            onClick={() => setMode("text")}
            className={`px-4 py-3 text-sm font-medium ${
              mode === "text"
                ? "border-b-2 border-neutral-900 text-neutral-900"
                : "text-neutral-500 hover:text-neutral-700"
            }`}
          >
            텍스트 붙여넣기
          </button>
        </div>

        <div className="p-6">
          {mode === "file" ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (f) handleFile(f);
              }}
              className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-12 transition-colors ${
                dragOver
                  ? "border-neutral-900 bg-neutral-50"
                  : "border-neutral-300 bg-neutral-50/50"
              }`}
            >
              <p className="text-sm text-neutral-600">
                docx / pdf / pptx / hwpx 파일을 여기로 드래그
              </p>
              <p className="mt-1 text-xs text-neutral-400">또는</p>
              <label className="mt-2 cursor-pointer rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
                파일 선택
                <input
                  type="file"
                  className="hidden"
                  accept=".docx,.pdf,.pptx,.hwpx"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="원고 텍스트를 붙여넣기..."
                rows={12}
                className="w-full resize-y rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
              />
              <button
                onClick={handleText}
                disabled={textInput.trim().length === 0 || loading}
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                분류하기
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 진행/에러 */}
      {loading && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
          처리 중... (파싱 → 분류 LLM 호출, 보통 5~15초)
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <div className="font-medium">
            {error.error}
            {error.code ? ` (${error.code})` : ""}
          </div>
          {error.message && <div className="mt-1 text-xs">{error.message}</div>}
        </div>
      )}

      {/* 결과 */}
      {result && <ResultView result={result} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 결과 뷰
// ─────────────────────────────────────────────────────────────

function ResultView({ result }: { result: ClassifiedManuscript }) {
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
