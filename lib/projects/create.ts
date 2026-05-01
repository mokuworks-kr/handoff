/**
 * 프로젝트 생성 — ClassifiedManuscript 받아 projects 테이블에 row 생성.
 *
 * 책임:
 *   1) ClassifiedManuscript 를 Document 시드(EMPTY_BOUND_DOCUMENT)에 박음
 *   2) origin 채움 (1차 출시: builtin/default)
 *   3) Project.title 자동 추출
 *   4) projects insert
 *   5) 생성된 Project ID 반환
 *
 * 주의: 이 함수는 크레딧 차감을 *하지 않는다*. 호출자가 차감과 생성의
 * 순서·트랜잭션을 결정한다 (현재 정책: 분류 성공 후 차감 → 생성).
 *
 * artifactType 기본값 = "bound" (책자형). 1차 타깃이 회사소개서/IR 이라.
 * 미래에 사용자가 명시적으로 접지형 선택 가능.
 *
 * design slug 기본값 = "default". 미래에 사용자 선택 또는 자동 추천.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClassifiedManuscript } from "@/lib/classify/types";
import {
  EMPTY_BOUND_DOCUMENT,
  EMPTY_FOLDED_DOCUMENT,
  type Document,
} from "@/lib/types/document";
import { loadDesignTokens } from "@/lib/design-tokens/load";
import { extractProjectTitle } from "./title";

export type CreateProjectInput = {
  supabase: SupabaseClient;
  userId: string;
  manuscript: ClassifiedManuscript;
  /** 기본 "bound". 접지형은 명시 */
  artifactType?: "bound" | "folded";
  /** 기본 "default". 미래에 사용자 선택 */
  designSlug?: string;
  /** 기본 자동 추출. 명시 시 그 값 사용 */
  title?: string;
};

export type CreateProjectResult = {
  projectId: string;
  title: string;
  document: Document;
};

export class CreateProjectError extends Error {
  readonly code: "INSERT_FAILED" | "INVALID_INPUT" | "DESIGN_LOAD_FAILED";
  readonly cause?: unknown;
  constructor(code: CreateProjectError["code"], message: string, cause?: unknown) {
    super(message);
    this.name = "CreateProjectError";
    this.code = code;
    this.cause = cause;
  }
}

export async function createProject(
  input: CreateProjectInput,
): Promise<CreateProjectResult> {
  if (typeof window !== "undefined") {
    throw new CreateProjectError(
      "INSERT_FAILED",
      "createProject() 는 서버에서만 호출 가능합니다.",
    );
  }

  const artifactType = input.artifactType ?? "bound";
  const designSlug = input.designSlug ?? "default";
  const title = input.title ?? extractProjectTitle(input.manuscript);

  // Document 시드 — artifactType 에 따라 분기
  const seedDoc: Document =
    artifactType === "folded" ? EMPTY_FOLDED_DOCUMENT : EMPTY_BOUND_DOCUMENT;

  // 디자인 카탈로그 시드 (정책 §10) — public/design-md/<slug>.md 1회 복사.
  // 이후 사용자 편집은 인스턴스(Document.designTokens)에만 반영.
  // 카탈로그 자체(파일)는 read-only — 절대 수정 금지.
  //
  // 카탈로그 로드 실패는 throw — silent fallback (빈 designTokens) 은
  // 페이지네이션 시점에 가서야 VOCABULARY_EMPTY 로 깨지는 디버깅 지옥을
  // 만들었기 때문. 분류 시점에 즉시 거절하는 편이 진단·복구 모두 빠름.
  // (이전 silent fallback 으로 박힌 옛 프로젝트가 lab/paginate 에서 깨진 사례
  //  발견 후 변경 — 2026-05.)
  let designTokens: Document["designTokens"];
  let stylesPatch: Document["styles"];
  try {
    const loaded = await loadDesignTokens(designSlug);
    designTokens = loaded;
    // print 카탈로그를 Document.styles 에 1회 동기화 (정책 §10)
    stylesPatch = {
      paragraphStyles: loaded.print?.paragraphStyles ?? [],
      characterStyles: loaded.print?.characterStyles ?? [],
      colors: loaded.print?.colors ?? [],
      fonts: loaded.print?.fonts ?? [],
    };
  } catch (e) {
    throw new CreateProjectError(
      "DESIGN_LOAD_FAILED",
      `디자인 카탈로그 '${designSlug}' 로드 실패: ${e instanceof Error ? e.message : "unknown"}`,
      e,
    );
  }

  const document: Document = {
    ...seedDoc,
    designTokens,
    styles: stylesPatch,
    manuscript: input.manuscript,
    origin: {
      designSlug,
      designVersion: designTokens.version,
      source: "builtin",
      author: { id: "handoff-builtin", name: "Handoff" },
    },
  };

  // INSERT
  const { data, error } = await input.supabase
    .from("projects")
    .insert({
      user_id: input.userId,
      title,
      format: document.format,
      design_tokens: document.designTokens,
      document,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new CreateProjectError(
      "INSERT_FAILED",
      `프로젝트 생성 실패: ${error?.message ?? "unknown"}`,
      error,
    );
  }

  return {
    projectId: data.id as string,
    title,
    document,
  };
}
