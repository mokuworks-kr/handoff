"use client";

/**
 * NewProjectFlow — 새 프로젝트 입력 흐름.
 *
 * 흐름 (M3a-3-2c 변경 — Storage 직접 업로드):
 *   파일 모드:
 *     1) 사용자 파일 선택
 *     2) /api/uploads/sign 으로 서명 URL 받음
 *     3) 서명 URL 에 PUT 으로 직접 업로드 (Vercel 함수 거치지 않음)
 *     4) /api/classify-and-create 에 storagePath POST → 분류 + 프로젝트 생성
 *     5) /projects/[id] 로 이동
 *   텍스트 모드:
 *     1) 사용자 텍스트 입력
 *     2) /api/classify-and-create 에 text POST (작아서 직접 보냄)
 *     3) /projects/[id] 로 이동
 *
 * 진행 표시 — 3단계:
 *   "업로드 중..." → "분석 중..." → 자동 이동
 *
 * 분류 결과는 사용자에게 노출 X. /projects/[id] 임시 페이지에서 펼침으로만 보임.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SignUploadResponse } from "@/lib/uploads/types";
import { MAX_UPLOAD_SIZE_BYTES } from "@/lib/uploads/types";

type Mode = "file" | "text";

type ApiError = {
  error: string;
  code?: string;
  message?: string;
  balance?: number;
  required?: number;
  maxSize?: number;
  size?: number;
};

type Stage = "idle" | "uploading" | "classifying";

const CLASSIFY_MESSAGES = [
  "원고를 분석하고 있어요...",
  "내용을 섹션별로 분류하고 있어요...",
  "거의 다 됐어요...",
];

export function NewProjectFlow() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("file");
  const [textInput, setTextInput] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const cycleClassifyMessages = () => {
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % CLASSIFY_MESSAGES.length;
      setStepIndex(i);
    }, 3000);
    return () => clearInterval(interval);
  };

  /**
   * 파일 업로드 → 분류 → 프로젝트 생성 → 이동
   */
  const submitFile = async (file: File) => {
    setError(null);
    setUploadPercent(0);

    // 사전 크기 체크 (서버에서도 다시 체크하지만 UX 개선)
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setError({
        error: "파일이 너무 큽니다",
        code: "FILE_TOO_LARGE",
        maxSize: MAX_UPLOAD_SIZE_BYTES,
        size: file.size,
      });
      return;
    }

    // === 1단계: 서명 URL 발급 ===
    setStage("uploading");
    let signed: SignUploadResponse;
    try {
      const signRes = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, size: file.size }),
      });
      const signData = await signRes.json();
      if (!signRes.ok) {
        setError(signData);
        setStage("idle");
        return;
      }
      signed = signData;
    } catch (e) {
      setError({
        error: "서명 URL 요청 실패",
        message: e instanceof Error ? e.message : "unknown",
      });
      setStage("idle");
      return;
    }

    // === 2단계: Storage 에 직접 PUT 업로드 ===
    try {
      await uploadWithProgress(signed.uploadUrl, file, (percent) => {
        setUploadPercent(percent);
      });
    } catch (e) {
      setError({
        error: "업로드 실패",
        message: e instanceof Error ? e.message : "unknown",
      });
      setStage("idle");
      return;
    }

    // === 3단계: 분류 + 프로젝트 생성 ===
    setStage("classifying");
    setStepIndex(0);
    const stopCycle = cycleClassifyMessages();

    try {
      const res = await fetch("/api/classify-and-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath: signed.storagePath,
          filename: file.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data);
        setStage("idle");
        return;
      }

      if (data.projectId) {
        router.push(`/projects/${data.projectId}`);
        return;
      }

      setError({ error: "응답에 projectId가 없습니다." });
      setStage("idle");
    } catch (e) {
      setError({
        error: "네트워크 오류",
        message: e instanceof Error ? e.message : "unknown",
      });
      setStage("idle");
    } finally {
      stopCycle();
    }
  };

  /**
   * 텍스트 입력 → 분류 → 프로젝트 생성 → 이동
   */
  const submitText = async () => {
    if (textInput.trim().length === 0) return;

    setError(null);
    setStage("classifying");
    setStepIndex(0);
    const stopCycle = cycleClassifyMessages();

    try {
      const res = await fetch("/api/classify-and-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data);
        setStage("idle");
        return;
      }

      if (data.projectId) {
        router.push(`/projects/${data.projectId}`);
        return;
      }

      setError({ error: "응답에 projectId가 없습니다." });
      setStage("idle");
    } catch (e) {
      setError({
        error: "네트워크 오류",
        message: e instanceof Error ? e.message : "unknown",
      });
      setStage("idle");
    } finally {
      stopCycle();
    }
  };

  // === 진행 표시 ===
  if (stage === "uploading") {
    return (
      <div className="border border-border rounded-lg bg-surface p-12 text-center space-y-4">
        <p className="text-base font-medium text-ink-900">
          파일을 업로드하고 있어요...
        </p>
        <div className="w-full max-w-sm mx-auto">
          <div className="h-2 bg-canvas rounded-full overflow-hidden">
            <div
              className="h-full bg-ink-900 transition-all duration-200"
              style={{ width: `${uploadPercent}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-ink-400 font-mono">
            {uploadPercent}%
          </p>
        </div>
      </div>
    );
  }

  if (stage === "classifying") {
    return (
      <div className="border border-border rounded-lg bg-surface p-12 text-center space-y-4">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-ink-400 border-t-ink-900"></div>
        <p className="text-base font-medium text-ink-900">
          {CLASSIFY_MESSAGES[stepIndex]}
        </p>
        <p className="text-xs text-ink-400">보통 5~15초 정도 걸립니다.</p>
      </div>
    );
  }

  // === 입력 화면 ===
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
                if (f) submitFile(f);
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
                    if (f) submitFile(f);
                  }}
                />
              </label>
              <p className="mt-4 text-xs text-ink-400">
                최대 {Math.round(MAX_UPLOAD_SIZE_BYTES / 1024 / 1024)}MB · PDF는 곧 지원될 예정이에요.
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
                onClick={submitText}
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
          {error.code === "FILE_TOO_LARGE" && error.maxSize && error.size && (
            <div className="mt-2 text-xs">
              파일 크기: {Math.round(error.size / 1024 / 1024)}MB / 최대:{" "}
              {Math.round(error.maxSize / 1024 / 1024)}MB
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
 * XHR 로 PUT 업로드 + 진행률 콜백.
 *
 * fetch 는 업로드 진행률을 못 얻어서 (스트림 reader 필요한데 호환성 문제 많음)
 * XHR 사용. 표준이고 잘 동작.
 */
function uploadWithProgress(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    // Supabase 서명 URL 은 Content-Type 헤더 검증 안 함. 그냥 file 보내면 됨.
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.send(file);
  });
}

/**
 * 사용자에게 보여줄 에러 제목 — code 기반.
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
    case "UNSUPPORTED_EXTENSION":
      return "지원하지 않는 파일 확장자입니다.";
    case "FILE_TOO_LARGE":
      return "파일이 너무 큽니다.";
    case "PARSE_UNKNOWN":
      return "파일을 읽지 못했어요. 손상된 파일일 수 있습니다.";
    case "DOWNLOAD_FAILED":
      return "업로드된 파일을 처리하지 못했어요. 다시 시도해주세요.";
    case "INVALID_PATH":
      return "잘못된 업로드 경로입니다.";
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
