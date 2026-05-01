/**
 * /api/uploads/sign — Storage 직접 업로드용 서명 URL 발급.
 *
 * 흐름:
 *   1) 인증 — 로그인 사용자만
 *   2) 입력 검증 — filename + size
 *   3) 새 upload_id (UUID) 생성 → Storage 경로 결정
 *   4) Supabase Storage 의 createSignedUploadUrl() 호출 → URL 받음
 *   5) 클라이언트에 storagePath + uploadUrl 반환
 *
 * 클라이언트는 받은 uploadUrl 에 PUT 으로 파일 직접 업로드.
 * 그 다음 storagePath 를 /api/classify-and-create 에 POST.
 *
 * Storage 경로 규약: originals/<user_id>/<upload_id>/<filename>
 *   - user_id 가 첫 세그먼트 — RLS 정책(0002_storage.sql)이 검증
 *   - upload_id 는 새 UUID — 프로젝트 ID 와 다름 (프로젝트는 분류 후 생성)
 *   - filename 은 사용자 원본 이름 보존 (디버깅 + 미래 "원본 받기")
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  type SignUploadRequest,
  type SignUploadResponse,
  MAX_UPLOAD_SIZE_BYTES,
  SUPPORTED_UPLOAD_EXTENSIONS,
} from "@/lib/uploads/types";

export const runtime = "nodejs";

/**
 * 파일명을 안전하게 정규화.
 * - 경로 구분자 / \ 제거
 * - 따옴표 제거
 * - 공백 제거
 * - 빈 문자열은 "file" 로
 *
 * Storage 키에 공백/특수문자가 들어가면 URL 인코딩 이슈가 생길 수 있어 보수적 처리.
 */
function sanitizeFilename(filename: string): string {
  // 마지막 경로 세그먼트만 사용 (디렉토리 traversal 방지)
  const baseName = filename.split(/[\\/]/).pop() ?? "file";
  // 따옴표·세미콜론·공백·제어문자 제거
  const cleaned = baseName.replace(/['";\s\x00-\x1F]/g, "_").trim();
  return cleaned.length > 0 ? cleaned : "file";
}

function hasSupportedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return SUPPORTED_UPLOAD_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export async function POST(request: NextRequest) {
  try {
    // 1) 인증
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // 2) 입력 파싱
    let body: SignUploadRequest;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }

    const { filename, size } = body;
    if (typeof filename !== "string" || filename.length === 0) {
      return NextResponse.json(
        { error: "filename required", code: "MISSING_FILENAME" },
        { status: 400 },
      );
    }
    if (typeof size !== "number" || size <= 0) {
      return NextResponse.json(
        { error: "size required", code: "MISSING_SIZE" },
        { status: 400 },
      );
    }

    // 3) 검증 — 확장자 + 크기
    if (!hasSupportedExtension(filename)) {
      return NextResponse.json(
        {
          error: "unsupported file type",
          code: "UNSUPPORTED_EXTENSION",
          allowed: SUPPORTED_UPLOAD_EXTENSIONS,
        },
        { status: 422 },
      );
    }
    if (size > MAX_UPLOAD_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: "file too large",
          code: "FILE_TOO_LARGE",
          maxSize: MAX_UPLOAD_SIZE_BYTES,
          size,
        },
        { status: 413 },
      );
    }

    // 4) Storage 경로 결정
    const uploadId = crypto.randomUUID();
    const safeFilename = sanitizeFilename(filename);
    const storagePath = `${user.id}/${uploadId}/${safeFilename}`;

    // 5) 서명 URL 발급
    // service_role 로 호출 — anon 으로도 가능하지만 service_role 이 신뢰성 ↑.
    // RLS 검증은 클라이언트가 PUT 할 때 storage.objects 정책으로 처리됨.
    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from("originals")
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      console.error("[uploads/sign] signed url failed", error);
      return NextResponse.json(
        {
          error: "failed to create upload url",
          code: "SIGN_FAILED",
          message: error?.message,
        },
        { status: 500 },
      );
    }

    // Supabase 의 createSignedUploadUrl 은 기본 2시간 만료 (사전 정의됨, 변경 불가)
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    const response: SignUploadResponse = {
      storagePath,
      uploadUrl: data.signedUrl,
      expiresAt,
    };
    return NextResponse.json(response);
  } catch (e) {
    console.error("[uploads/sign] unhandled", e);
    return NextResponse.json(
      {
        error: "internal",
        code: "UNHANDLED",
        message: e instanceof Error ? e.message : "unknown",
      },
      { status: 500 },
    );
  }
}
