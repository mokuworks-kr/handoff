"use client";

/**
 * Classify Lab 클라이언트 — 파일/텍스트 입력 → /api/classify 호출.
 *
 * 결과 시각화는 components/classify/ResultView 로 분리됨 (옵션 A 분리).
 * 이 컴포넌트의 책임:
 *   - 입력 (파일 드롭존 / 텍스트 탭)
 *   - /api/classify 호출 + 진행 표시 + 에러 표시
 *   - 결과는 ResultView에 위임
 *
 * 검증·튜닝 전용. 화이트리스트로 보호 (page.tsx 단계).
 * 프로덕션 흐름은 /projects/new 가 별도 사용 (NewProjectFlow).
 */

import { useState } from "react";
import { ResultView } from "@/components/classify/ResultView";
import type { ClassifiedManuscript } from "@/lib/classify/types";

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

      {/* 결과 — ResultView 에 위임 */}
      {result && <ResultView result={result} />}
    </div>
  );
}
