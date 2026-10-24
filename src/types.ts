// 앱 전체에서 쓰는 타입 모음 (값/설정은 config.ts)
import type { Lang, MsgKey } from "./i18n";
import { Timestamp } from "firebase/firestore";

// 언어별 표시 이름 (비어 있으면 기본 이름으로 대체). id·저장 데이터는 항상 한국어 이름 기준이라 언어와 무관함
export type NameMap = Partial<Record<Lang, string>>;

export interface Member {
  id: string; // "유닛명::멤버명" (CSV 순서와 무관한 안정적인 키)
  groupId: string;
  name: string;
  names?: NameMap;
  img: string;
  fallback: string;
}

export interface Group {
  id: string; // 유닛명
  name: string;
  names?: NameMap;
  logo: string;
  members: Member[];
}

export interface Agency {
  id: string;
  name: string;
  names?: NameMap;
  logo: string;
  groups: Group[];
}

// 저장 형태: { 유닛명: 멤버id }
export type Picks = Record<string, string>;

export interface UserDoc {
  nickname: string;
  picks: Picks;
  joinedAt: number; // 정렬용 (밀리초)
  joinedTs: Timestamp | null; // 서버가 기록한 최초 제출 시각 (수정 시 그대로 다시 보냄). 예전 방(숫자 형식)이면 null
}

export type RoomUsers = Record<string, UserDoc>; // key = 기기(익명 로그인) uid

export interface RoomData {
  source: "main" | "legacy"; // legacy = 이전 서버의 방 (읽기 전용)
  at: number; // 서버에서 읽어 온 시각
  name: string;
  ownerUid: string | null;
  users: RoomUsers;
}

export interface MyRoom {
  id: string;
  nickname: string;
  lastAt: number; // 마지막으로 제출한 시각(표시용, 이 기기 시계 기준)
  roomName?: string; // 방 이름 (없으면 이름 없는 방)
}

export interface AgencyConfig {
  name: string;
  logo?: string; // 나중에 실제 로고를 쓰려면 "img/logo/xxx.png" 처럼 public 기준 경로
  units: { name: string; logo?: string }[];
}

// 번역 함수 타입 (App의 t를 컴포넌트에 넘길 때 사용)
export type TFn = (key: MsgKey, params?: Record<string, string | number>) => string;
