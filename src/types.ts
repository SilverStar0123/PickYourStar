import type { Timestamp } from "firebase/firestore";
import type { Lang } from "./i18n";

// ───────────────────────── 타입 ─────────────────────────
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

// ───────────────────────── 고정 설정값 ─────────────────────────
export const agencyConfig: AgencyConfig[] = [
  {
    name: "STARMAKER PRODUCTION",
    units: [{ name: "fine" }, { name: "Trickstar" }, { name: "유성대" }, { name: "ALKALOID" }]
  },
  {
    name: "COSMIC PRODUCTION",
    units: [{ name: "Eden" }, { name: "Valkyrie" }, { name: "2wink" }, { name: "Crazy:B" }]
  },
  {
    name: "Rhythm Link",
    units: [{ name: "UNDEAD" }, { name: "Ra*bits" }, { name: "홍월" }, { name: "MELLOW DEAR US" }]
  },
  {
    name: "NEW DIMENSION",
    units: [{ name: "Knights" }, { name: "Switch" }, { name: "MaM" }, { name: "Special for Princess!" }]
  }
];

export const MAX_NICKNAME_LENGTH = 20;
export const MAX_ROOM_NAME = 30;
export const ROOM_ID_PATTERN = /^[a-z0-9]{6,24}$/;

export const MEMBER_IMG_DIR = "img";
export const LOGO_IMG_DIR = "img/logo";

// 이름을 고친 캐릭터의 옛 id → 현재 id (CSV 이름을 바꿀 때마다 한 줄씩 추가)
export const ID_ALIASES: Record<string, string> = {
  "Crazy:B::오오카와 코하쿠": "Crazy:B::오우카와 코하쿠",
  "Crazy:B::오으카와 코하쿠": "Crazy:B::오우카와 코하쿠" // 잘못 입력했던 기간에 저장됐을 수 있는 철자
};

// 무료 한도 때문에 실시간 연결 대신 '한 번 읽고 이 기기에 저장'하는 방식을 씀
export const ROOM_CACHE_PREFIX = "es_room_cache:";
export const ROOM_CACHE_INDEX = "es_room_cache_index";
export const ROOM_CACHE_KEEP = 8; // 이 기기에 저장해 둘 최근 방 개수
export const ROOM_CACHE_TTL_MS = 20 * 60 * 1000; // 이 시간 안에 다시 열면 서버를 읽지 않음
export const MAX_USERS_PER_ROOM = 50; // 한 번에 읽어 오는 최대 참여자 수 (먼저 제출한 순). 방을 열 때마다 이만큼 읽기가 발생함
export const REFRESH_COOLDOWN_MS = 60 * 1000; // 새로고침 버튼 최소 간격
export const SUBMIT_COOLDOWN_MS = 15 * 1000; // 제출 버튼 최소 간격 (연타 방지)

// 선택 화면 멤버 한 칸 크기(CSS의 .member-wrapper 너비, .members 간격과 맞출 것)
export const ITEM_W = 84;
export const ITEM_GAP = 12;
export const CARD_PADDING = 40; // .agency-container 좌우 패딩 합

// 결과표 사진 한 칸 크기/간격 (styles.css의 --slot, --gap 기본값과 같게)
export const BOARD_SLOT = 76;
export const BOARD_GAP = 10;

// 익명 통계용 설정
export const STATS_ID_KEY = "es_stats_id";
export const STATS_SAMPLE_RATE = 0.1; // 무료 쓰기 한도를 위해 10%만 수집 (0 = 통계 끔, 1 = 모든 기기)
export const STATS_SAMPLE_KEY = "es_stats_sample";

// 내가 참여한 방 목록 / 내 선택·닉네임 로컬 저장 키
export const MY_ROOMS_KEY = "es_my_rooms";
export const MY_ROOMS_MAX = 30;
export const PICKS_KEY = "es_my_picks";
export const NICK_KEY = "es_my_nickname";

// 서버 혼잡(무료 한도 초과 등) 처리
export const SERVER_BUSY_KEY = "es_server_busy_until";
export const SERVER_BUSY_MS = 10 * 60 * 1000; // 혼잡 판정 후 이 시간 동안은 서버 저장을 시도하지 않음

// 이미지 저장 설정
export const IMAGE_SCALE = 2;
// 카카오톡·인스타 등 앱 안 브라우저는 파일 다운로드를 막는 경우가 많아 미리보기(길게 눌러 저장)를 사용
export const IN_APP_BROWSER = /KAKAOTALK|Instagram|FBAN|FBAV|Line\/|NAVER\(inapp|Twitter|DaumApps|everytimeApp|; wv\)/i;
