export * from "./document";
export * from "./design-tokens";
export * from "./frames";
export * from "./styles";
export * from "./db";

// 분류기 타입을 lib/types 에서도 import 가능하게 — UI/API 라우트 편의.
// 정의 자체는 lib/classify/types.ts 가 SoT.
export type {
  ClassifiedManuscript,
  Section,
  SectionKind,
  SectionHints,
} from "@/lib/classify/types";
