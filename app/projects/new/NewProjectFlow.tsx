"use client";

/**
 * NewProjectFlow — 새 프로젝트 입력 흐름.
 *
 * 사용자에게 보여주는 단계:
 *   1) 입력 (파일 드롭존 또는 텍스트 탭)
 *   2) "분석 중..." 진행 표시 — 분류기 호출 중
 *   3) 성공 시 자동으로 /projects/[id] 로 이동
 *
 * 분류 결과는 사용자에게 노출 X. 결과 페이지에서 임시 메시지 + 작은 요약만 보임.
 *
 * 호출하는 라우트: /api/classify-and-create (production)
 *   - 분류 + 프로젝트 생성 + 크레딧 차감을 한 번에 처리
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

type Mode = "file" | "text";

type ApiError = {
  error: string;
  code?: string;
  message?: string;
  balance?: number;
  required?: number;
};

const STEP_MESSAGES = [
  "원고를 분석하고 있어요...",
  "내용을 섹션별로 분류하고 있어요...",
  "거의 다 됐어요...",
];

export function NewProjectFlow() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("file");
  const [textInput, setTextInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // 진행 메시지 순환 — 사용자에게 진행 신호
  const cycleMessages = () => {
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % STEP_MESSAGES.length;
      setStepIndex(i);
    }, 3000);
    return () => clearInterval(interval);
  };

  const submit = async (formData: FormData) => {
    setLoading(true);
    setError(null);
    setStepIndex(0);
    const stopCycle = cycleMessages();

    try {
      const res = await fetch("/api/classify-and-create", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data);
        return;
      }

      // 성공 — projectId 받아서 결과 페이지로 이동
      if (data.projectId) {
        router.push(`/projects/${data.projectId}`);
        return;
      }

      setError({ error: "응답에 projectId가 없습니다." });
    } catch (e) {
      setError({
        error: "네트워크 오류",
        message: e instanceof Error ? e.message : "unknown",
      });
    } finally {
      stopCycle();
      setLoading(false);
    }
  };

  const handleFile = (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    submit(fd);
  };

  const handleText = () => {
    if (textInput.trim().length === 0) return;
    const fd = new FormData();
    fd.append("text", textInput);
    submit(fd);
  };

  if (loading) {
    return (
      <div className="border border-border rounded-lg bg-surface p-12 text-center space-y-4">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-ink-400 border-t-ink-900"></div>
        <p className="text-base font-medium text-ink-900">
          {STEP_MESSAGES[stepIndex]}
        </p>
        <p className="text-xs text-ink-400">보통 5~15초 정도 걸립니다.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-surface">
        <div className="flex border-b border-border">
          <button
            onClick={() => setMode("file")}
            className={`px-4 py-3 text-sm font-medium ${
              mode === "file"
                ? "border-b-2 border-ink-900 text-ink-900"
                : "text-ink-600 hover:text-ink-900"
            }`}
          >
            파일 업로드
          </button>
          <button
            onClick={() => setMode("text")}
            className={`px-4 py-3 text-sm font-medium ${
              mode === "text"
                ? "border-b-2 border-ink-900 text-ink-900"
                : "text-ink-600 hover:text-ink-900"
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
              className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-16 transition-colors ${
                dragOver
                  ? "border-ink-900 bg-canvas"
                  : "border-border bg-canvas/50"
              }`}
            >
              <p className="text-sm text-ink-600">
                docx / pptx / hwpx 파일을 여기로 드래그
              </p>
              <p className="mt-1 text-xs text-ink-400">또는</p>
              <label className="mt-3 cursor-pointer rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-900/90">
                파일 선택
                <input
                  type="file"
                  className="hidden"
                  accept=".docx,.pptx,.hwpx"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
              </label>
              <p className="mt-4 text-xs text-ink-400">
                PDF는 곧 지원될 예정이에요.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="원고 텍스트를 붙여넣기..."
                rows={12}
                className="w-full resize-y rounded-md border border-border px-3 py-2 text-sm focus:border-ink-900 focus:outline-none"
              />
              <button
                onClick={handleText}
                disabled={textInput.trim().length === 0}
                className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-900/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                분석 시작
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <div className="font-medium">{errorTitle(error)}</div>
          {error.message && <div className="mt-1 text-xs">{error.message}</div>}
          {error.code === "INSUFFICIENT_CREDITS" && error.balance !== undefined && (
            <div className="mt-2 text-xs">
              현재 잔액: {error.balance} / 필요: {error.required ?? "?"}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-ink-400 text-center">
        업로드한 원고는 분류 후 프로젝트 단위로 안전하게 저장됩니다.
      </p>
    </div>
  );
}

/**
 * 사용자에게 보여줄 에러 제목 — code 기반.
 * 분류기·파서의 내부 에러 코드를 사용자가 이해할 수 있는 메시지로 변환.
 */
function errorTitle(e: ApiError): string {
  switch (e.code) {
    case "INSUFFICIENT_CREDITS":
      return "크레딧이 부족합니다";
    case "PROFILE_NOT_FOUND":
      return "프로필 정보를 찾을 수 없습니다. 다시 로그인해주세요.";
    case "HWP_LEGACY_NOT_SUPPORTED":
      return ".hwp 옛날 형식은 지원하지 않아요. 한컴오피스에서 .hwpx로 저장 후 다시 시도해주세요.";
    case "UNKNOWN_FORMAT":
      return "지원하지 않는 파일 형식이에요. docx, pptx, hwpx만 가능합니다.";
    case "PARSE_UNKNOWN":
      return "파일을 읽지 못했어요. 손상된 파일일 수 있습니다.";
    case "TOOL_NOT_CALLED":
    case "BAD_RESPONSE":
      return "분류 중 오류가 발생했어요. 다시 시도해주세요.";
    case "RATE_LIMITED":
      return "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
    case "AUTH_FAILED":
      return "서비스 인증에 문제가 있습니다. 관리자에게 문의해주세요.";
    default:
      return e.error || "알 수 없는 오류가 발생했어요.";
  }
}
