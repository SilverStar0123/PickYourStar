import type { Agency, Member, MyRoom, Picks, RoomData, RoomUsers, UserDoc } from "./types";
import {
  BOARD_GAP, BOARD_SLOT, CARD_PADDING, IN_APP_BROWSER, MAX_NICKNAME_LENGTH, MAX_ROOM_NAME,
  MAX_USERS_PER_ROOM, MY_ROOMS_MAX, NICK_KEY, PICKS_KEY, REFRESH_COOLDOWN_MS, ROOM_CACHE_TTL_MS,
  STATS_SAMPLE_RATE, SUBMIT_COOLDOWN_MS
} from "./config";
import { LANG_KEY, LOCALE, detectInitialLang, normalizeLang, translate } from "./i18n";
import type { Lang, MsgKey } from "./i18n";
import React, { useEffect, useMemo, useRef, useState } from "react";
import SongQuiz from "./SongQuiz";
import { trackAnalyticsEvent } from "./analytics";
import { auth, db } from "./firebaseClient";
import { balancedMaxWidth, copyText, safeFileName, samePicks, withTimeout } from "./utils";
import { blobToDataUrl, renderPersonalBlob, renderToBlob, triggerDownload } from "./imageExport";
import { computeMatches } from "./matching";
import { doc, getDocFromServer, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { clearPendingCreateRoom, fetchRoom, getPendingCreateRoom, loadRoomCache, parseRoomId, parseUserDoc, saveRoomCache } from "./rooms";
import { getServerErrorKind, isServerBusyNow, markServerBusy, serverBusyRemainingMs } from "./serverStatus";
import { layoutLogos } from "./logoLayout";
import { loadSheetAgencies } from "./csv";
import { PICK_SHEETS, VISIBLE_PICK_SHEET_IDS, SPECIAL_UNITS, groupSpecialUnits, sheetFromHash, sheetLocalKey, type PickSheetId } from "./pickSheets";
import { loadLocalNickname, loadLocalPicks, loadMyRooms, saveLocal, saveMyRooms } from "./storage";
import { localizeAgencies } from "./localize";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { onImgError } from "./assets";
import { sendAnonymousStats } from "./stats";
import LangSwitch from "./components/LangSwitch";
import MyRoomsPanel from "./components/MyRoomsPanel";
import ImagePreviewModal from "./components/ImagePreviewModal";
import "./styles.css";
import "./lang.css";

// 선택지 전환은 각 취향표를 remount해 이전 취향표의 상태가 새 화면에 남지 않게 합니다.
export default function App() {
  const [sheetId, setSheetId] = useState<PickSheetId>(() => sheetFromHash(window.location.hash) ?? "current");
  useEffect(() => {
    const sync = () => {
      const next = sheetFromHash(window.location.hash);
      if (next) setSheetId(next);
    };
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []);
  const switchSheet = (next: PickSheetId) => {
    if (sheetId === next) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    url.searchParams.delete("pk");
    url.searchParams.delete("nk");
    url.hash = PICK_SHEETS[next].route;
    window.history.pushState({}, "", url.toString());
    setSheetId(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return <PickYoursMain key={sheetId} sheetId={sheetId} onSwitchSheet={switchSheet} />;
}

function PickYoursMain({ sheetId, onSwitchSheet }: {
  sheetId: PickSheetId;
  onSwitchSheet: (next: PickSheetId) => void;
}) {
  const sheetConfig = PICK_SHEETS[sheetId];
  const multiplayer = sheetConfig.multiplayer;
  const roomCollection = sheetConfig.collection;
  const sheetRoute = sheetConfig.route;
  const titleForSheet = (language: Lang) => sheetConfig.labels[language];

  // 인증(익명) — 공유(저장)할 때만 필요합니다. 실패해도 선택/이미지 저장은 가능
  const [uid, setUid] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);

  // 공유방 링크로 시작하면 이전 방의 전역 닉네임 대신 해당 방에 저장한 닉네임을 사용
  const [nickname, setNickname] = useState(() => {
    const initialRoomId = multiplayer ? parseRoomId() : null;
    return initialRoomId
      ? loadMyRooms(sheetId).find((r) => r.id === initialRoomId)?.nickname ?? ""
      : loadLocalNickname(sheetId);
  });
  const [picks, setPicks] = useState<Picks>(() => loadLocalPicks(sheetId));

  const [roomId, setRoomId] = useState<string | null>(() => multiplayer ? parseRoomId() : null);
  const [roomUsers, setRoomUsers] = useState<RoomUsers>({});
  const [roomLoaded, setRoomLoaded] = useState<boolean>(() => !multiplayer || !parseRoomId());
  const [roomError, setRoomError] = useState(false);

  // 주소(#/quiz, ?page=quiz, ?tab=quiz, /quiz)를 읽어 초기 서비스 화면 결정
  type ServiceId = "picks" | "quiz";
  const detectServiceFromUrl = (): ServiceId => {
    const hash = window.location.hash.replace(/^#\/?/, "").split("?")[0].trim().toLowerCase();
    if (hash === "quiz" || hash === "songquiz") return "quiz";
    if (hash === "picks" || hash === "home" || hash.startsWith("picks/")) return "picks";
    const sp = new URLSearchParams(window.location.search);
    const q = (sp.get("page") || sp.get("tab") || "").toLowerCase();
    if (q === "quiz" || q === "songquiz") return "quiz";
    if (/\/(quiz|songquiz)\/?$/i.test(window.location.pathname)) return "quiz";
    return "picks";
  };

  const [activeTab, setActiveTab] = useState<ServiceId>(() => detectServiceFromUrl());
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 서비스 이동 함수: 주소창에 #/quiz 또는 #/picks 를 반영해 고유 링크와 뒤로가기를 지원
  const navigateService = (target: ServiceId) => {
    setActiveTab(target);
    setDrawerOpen(false);
    const targetHash = target === "quiz" ? "#/quiz" : sheetRoute;
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // 브라우저 뒤로가기/앞으로가기 또는 주소 해시 변경 시 화면 동기화
  useEffect(() => {
    const onRouteChange = () => {
      setActiveTab(detectServiceFromUrl());
      setDrawerOpen(false);
    };
    window.addEventListener("hashchange", onRouteChange);
    window.addEventListener("popstate", onRouteChange);
    return () => {
      window.removeEventListener("hashchange", onRouteChange);
      window.removeEventListener("popstate", onRouteChange);
    };
  }, []);

  // GA4 기본 page_view는 Analytics SDK가 자동 기록하므로 중복 전송하지 않습니다.
  // 탭 간 이동은 별도 커스텀 이벤트로 구분합니다 (해시 기반 SPA).
  useEffect(() => {
    trackAnalyticsEvent("service_view", { service: activeTab });
    if (activeTab === "picks") trackAnalyticsEvent("pick_sheet_view", { sheet_id: sheetId });
  }, [activeTab, sheetId]);

  // ESC 키로 서랍 메뉴 닫기
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);
  const [showResult, setShowResult] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lang, setLang] = useState<Lang>(() => detectInitialLang());
  const langRef = useRef<Lang>(lang); // effect 안에서 최신 언어를 쓰기 위함
  langRef.current = lang;
  const t = (key: MsgKey, params?: Record<string, string | number>) => translate(lang, key, params);
  const changeLang = (l: Lang) => {
    setLang(l);
    saveLocal(LANG_KEY, l); // 직접 고른 언어는 이 기기에 기억
  };

  // 언어가 바뀌면 <html lang>과 탭 제목도 맞춤
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = activeTab === "quiz" ? translate(lang, "quizTitle") : `${titleForSheet(lang)} | PickYours`;
  }, [lang, activeTab]);

  // 주소에 ?lang= 이 실려 왔다면(앱 안 브라우저에서 넘어온 경우) 이 기기의 언어로 저장하고,
  // 공유 링크에 언어가 섞이지 않도록 주소에서 지움
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (!sp.has("lang")) return;
    const fromUrl = normalizeLang(sp.get("lang"));
    if (fromUrl) saveLocal(LANG_KEY, fromUrl);
    sp.delete("lang");
    const qs = sp.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
  }, []);

  const [baseAgencies, setBaseAgencies] = useState<Agency[]>([]);
  const [sheetDataLoaded, setSheetDataLoaded] = useState(false); // CSV 그대로 (한국어 이름)
  const agencies = useMemo(() => localizeAgencies(baseAgencies, lang), [baseAgencies, lang]); // 화면 표시용
  // 스페셜 유닛: 화면 미리보기와 저장 이미지가 동일한 섹션 구성을 사용합니다.
  const specialSections = useMemo(
    () => sheetId === "special"
      ? groupSpecialUnits(agencies.flatMap((agency) => agency.groups), lang)
      : [],
    [agencies, lang, sheetId]
  );

  const [preview, setPreview] = useState<{ src: string; blob: Blob; name: string } | null>(null); // 다운로드가 안 되는 환경용 안내 창
  const [savingImage, setSavingImage] = useState(false);
  const transferApplied = useRef(false);
  const [serverBusy, setServerBusy] = useState<boolean>(() => isServerBusyNow());
  // 짧은 네트워크 장애 제한이 끝나면 안내 문구도 자동으로 사라지게 처리
  useEffect(() => {
    if (!serverBusy) return;
    const remaining = serverBusyRemainingMs();
    if (remaining <= 0) {
      setServerBusy(false);
      return;
    }
    const timer = window.setTimeout(() => setServerBusy(false), remaining + 100);
    return () => window.clearTimeout(timer);
  }, [serverBusy]);
  const lastSubmitAt = useRef(0);
  const boardRef = useRef<HTMLDivElement>(null);
  const personalRef = useRef<HTMLDivElement>(null);
  const nicknameRef = useRef<HTMLInputElement>(null);
  const restored = useRef(false);
  // 방 정보를 읽는 동안 사용자가 직접 닉네임을 고쳤다면 서버 값으로 덮어쓰지 않음
  const nicknameEditedInRoom = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [listWidth, setListWidth] = useState(0);
  const [logoRatios, setLogoRatios] = useState<Record<string, number>>({});
  const [myRooms, setMyRooms] = useState<MyRoom[]>(() => loadMyRooms(sheetId));
  const [roomName, setRoomName] = useState(""); // 현재 방의 이름 (서버)
  const [roomOwner, setRoomOwner] = useState<string | null>(null); // 현재 방을 만든 사람의 uid
  const [roomMetaLoaded, setRoomMetaLoaded] = useState(false);
  const [roomSource, setRoomSource] = useState<"main" | "legacy">("main"); // legacy = 이전 서버(읽기 전용)
  const [roomFetchedAt, setRoomFetchedAt] = useState<number | null>(null);
  const [roomLoading, setRoomLoading] = useState(false);
  const [roomStale, setRoomStale] = useState(false); // 서버를 못 읽어서 저장된 결과를 보여주는 중
  const [roomRefreshTick, setRoomRefreshTick] = useState(0);
  const forceRefresh = useRef(false);
  const roomReq = useRef(0);
  const [roomNameInput, setRoomNameInput] = useState(""); // 새 방을 만들 때 입력하는 이름
  const [showMatch, setShowMatch] = useState(false); // 결과표의 일치율 표시 on/off
  const [baseChoice, setBaseChoice] = useState<string | null>(null); // 일치율 기준 참여자

  // ── 익명 로그인
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) setUid(user.uid);
    });
    // 취향표 인덱스 전환마다 불필요한 익명 로그인 요청을 반복하지 않습니다.
    if (!auth.currentUser) signInAnonymously(auth).catch((err) => {
      console.error("익명 로그인 실패:", err);
      setAuthError(true);
    });
    return unsub;
  }, []);

  // ── CSV 로드 (멤버: ES_list.csv, 유닛 로고·이름: units.csv) → csv.ts의 loadAgencies
  useEffect(() => {
    let cancelled = false;
    loadSheetAgencies(sheetId)
      .then((parsed) => {
        if (!cancelled) { setBaseAgencies(parsed); setSheetDataLoaded(true); }
      })
      .catch((err) => {
        if (!cancelled) setSheetDataLoaded(true);
        if ((err as { code?: string })?.code === "csv-path") {
          alert(translate(langRef.current, "alertCsvPath"));
        } else {
          console.error("CSV 로드 에러:", err);
          alert(translate(langRef.current, "alertCsvError"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 앱 안 브라우저에서 '기본 브라우저로 열기'로 넘어온 경우: 주소에 실린 선택·닉네임을 이어받음
  useEffect(() => {
    if (agencies.length === 0 || transferApplied.current) return;
    transferApplied.current = true;
    const sp = new URLSearchParams(window.location.search);
    const code = sp.get("pk");
    if (code === null) return;
    const next: Picks = {};
    let i = 0;
    agencies.forEach((a) =>
      a.groups.forEach((g) => {
        const ch = code.charAt(i++);
        const idx = ch && ch !== "-" ? parseInt(ch, 36) : NaN;
        const m = Number.isNaN(idx) ? undefined : g.members[idx];
        if (m) next[g.id] = m.id;
      })
    );
    if (Object.keys(next).length > 0) setPicks(next);
    const nk = sp.get("nk");
    if (nk) {
      // 다른 브라우저에서 현재 입력한 닉네임을 넘겼다면, 늦게 도착한 방 데이터로 덮어쓰지 않음
      nicknameEditedInRoom.current = true;
      setNickname(nk.slice(0, MAX_NICKNAME_LENGTH));
    }
    sp.delete("pk");
    sp.delete("nk");
    const qs = sp.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
  }, [agencies]);

  // 방 이름이 바뀌면 '내가 참여한 방' 목록의 이름도 맞춰 둠
  useEffect(() => {
    if (!roomId || !roomMetaLoaded) return;
    setMyRooms((prev) => {
      const idx = prev.findIndex((r) => r.id === roomId);
      if (idx < 0 || (prev[idx].roomName || "") === roomName) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], roomName };
      saveMyRooms(next, sheetId);
      return next;
    });
  }, [roomId, roomName, roomMetaLoaded]);

  // ── 방 불러오기: 이 기기에 저장된 결과가 있으면 먼저 보여주고, 오래됐을 때만 서버를 읽음
  useEffect(() => {
    if (!roomId) return;
    const myReq = ++roomReq.current;
    const isLatest = () => roomReq.current === myReq;
    const force = forceRefresh.current;
    forceRefresh.current = false;

    const apply = (d: RoomData) => {
      setRoomUsers(d.users);
      setRoomName(d.name);
      setRoomOwner(d.ownerUid);
      setRoomSource(d.source);
      setRoomFetchedAt(d.at);
      setRoomMetaLoaded(true);
      setRoomError(false);
      setRoomLoaded(true);
    };

    (async () => {
      const cached = loadRoomCache(roomId, sheetId);
      if (cached) apply(cached);
      if (!uid) {
        // 아직 로그인 전이거나 서버에 연결할 수 없는 상태: 저장된 결과가 있으면 그걸로 보여줌
        if (authError) {
          if (cached) setRoomStale(true);
          else setRoomError(true);
          setRoomLoaded(true);
        }
        return;
      }
      if (cached && !force && Date.now() - cached.at < ROOM_CACHE_TTL_MS) {
        setRoomStale(false);
        setRoomLoading(false);
        return; // 방금 본 방이면 서버를 읽지 않음
      }
      setRoomLoading(true);
      try {
        const fresh = await fetchRoom(roomId, sheetId);
        if (!isLatest()) return;
        apply(fresh);
        setRoomStale(false);
        if (Object.keys(fresh.users).length > 0) saveRoomCache(roomId, fresh, sheetId);
      } catch (err) {
        if (!isLatest()) return;
        console.warn("방 불러오기 실패:", err);
        if (cached) {
          setRoomStale(true); // 저장된 결과를 대신 보여줌
        } else {
          setRoomError(true);
        }
        setRoomLoaded(true);
      } finally {
        if (isLatest()) setRoomLoading(false);
      }
    })();
  }, [roomId, uid, authError, roomRefreshTick]);

  // 결과표를 서버에서 다시 읽기 (실시간 연결 대신 사용)
  const refreshRoom = () => {
    if (!roomId || roomLoading) return;
    if (roomFetchedAt && Date.now() - roomFetchedAt < REFRESH_COOLDOWN_MS) {
      alert(t("alertRefreshCooldown"));
      return;
    }
    forceRefresh.current = true;
    setRoomRefreshTick((t) => t + 1);
  };

  // 선택 화면 폭을 측정해서 멤버 줄바꿈을 균형 있게 계산
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    setListWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setListWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [agencies.length, showResult, sheetId]);

  // 유닛 로고의 가로세로 비율을 미리 읽어 둠 (결과표에서 로고 크기를 맞추는 데 사용)
  useEffect(() => {
    let cancelled = false;
    baseAgencies.forEach((a) =>
      a.groups.forEach((g) => {
        const im = new Image();
        im.onload = () => {
          if (cancelled || !im.naturalHeight) return;
          const ratio = im.naturalWidth / im.naturalHeight;
          setLogoRatios((prev) => (prev[g.id] === ratio ? prev : { ...prev, [g.id]: ratio }));
        };
        im.src = g.logo;
      })
    );
    return () => {
      cancelled = true;
    };
  }, [baseAgencies]);

  // ── 파생 데이터
  const totalGroups = useMemo(() => agencies.reduce((s, a) => s + a.groups.length, 0), [agencies]);
  const memberMap = useMemo(() => {
    const map: Record<string, Member> = {};
    agencies.forEach((a) => a.groups.forEach((g) => g.members.forEach((m) => (map[m.id] = m))));
    return map;
  }, [agencies]);
  const validGroupIds = useMemo(() => {
    const s = new Set<string>();
    agencies.forEach((a) => a.groups.forEach((g) => s.add(g.id)));
    return s;
  }, [agencies]);
  const pickedCount = useMemo(
    () => Object.keys(picks).filter((g) => validGroupIds.has(g)).length,
    [picks, validGroupIds]
  );
  // 선택지가 1명뿐인 유닛은 무조건 일치하므로 일치율 계산에서 제외
  const matchGroupIds = useMemo(() => {
    const ids = new Set<string>();
    agencies.forEach((a) =>
      a.groups.forEach((g) => {
        if (g.members.length > 1) ids.add(g.id);
      })
    );
    return ids;
  }, [agencies]);

  // 소속사별 유닛 로고 크기 (비율이 다른 로고도 눈에 비슷한 크기로 보이게)
  const logoBoxes = useMemo(() => {
    const out: Record<string, { w: number; h: number }[]> = {};
    agencies.forEach((a) => {
      out[a.id] = layoutLogos(
        a.groups.map((g) => logoRatios[g.id] ?? 1),
        { pitch: BOARD_SLOT + BOARD_GAP }
      );
    });
    return out;
  }, [agencies, logoRatios]);

  // 닉네임이 겹치면 먼저 들어온 사람은 그대로, 이후 사람은 이름(2), 이름(3) …
  // 표시 순서는 먼저 제출한 사람이 위(오름차순)
  const displayUsers = useMemo(() => {
    const asc = Object.entries(roomUsers)
      .map(([id, u]) => ({ id, ...u }))
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
    const seen: Record<string, number> = {};
    return asc.map((u) => {
      const key = u.nickname.toLowerCase();
      seen[key] = (seen[key] || 0) + 1;
      return { ...u, label: seen[key] === 1 ? u.nickname : `${u.nickname}(${seen[key]})` };
    });
  }, [roomUsers]);

  // 일치율 기준 참여자: 직접 고른 사람 → 없으면 나 → 없으면 가장 먼저 제출한 사람
  const baseUserId = useMemo(() => {
    if (baseChoice && roomUsers[baseChoice]) return baseChoice;
    if (uid && roomUsers[uid]) return uid;
    return displayUsers[0]?.id ?? null;
  }, [baseChoice, uid, roomUsers, displayUsers]);

  const matches = useMemo(() => {
    if (!baseUserId || !roomUsers[baseUserId]) return null;
    return computeMatches(roomUsers[baseUserId].picks, roomUsers, Array.from(matchGroupIds));
  }, [baseUserId, roomUsers, matchGroupIds]);

  // 기준 참여자를 제외하고 가장 많이 일치한 사람(0개면 없음)
  const bestMatchCount = useMemo(() => {
    if (!matches || !baseUserId) return 0;
    return Object.entries(matches).reduce(
      (mx, [id, m]) => (id === baseUserId ? mx : Math.max(mx, m.count)),
      0
    );
  }, [matches, baseUserId]);

  const matchOn = showMatch && !!matches && displayUsers.length >= 2;
  const baseLabel = displayUsers.find((u) => u.id === baseUserId)?.label ?? "";

  // 내 선택/닉네임이 바뀔 때마다 이 기기에 저장
  useEffect(() => {
    saveLocal(sheetLocalKey(PICKS_KEY, sheetId), JSON.stringify(picks));
  }, [picks]);
  useEffect(() => {
    saveLocal(sheetLocalKey(NICK_KEY, sheetId), nickname);
  }, [nickname]);

  // CSV가 바뀌어 없어진 멤버/유닛이 저장돼 있으면 정리
  useEffect(() => {
    if (agencies.length === 0) return;
    setPicks((cur) => {
      const next: Picks = {};
      let changed = false;
      Object.entries(cur).forEach(([g, m]) => {
        if (validGroupIds.has(g) && memberMap[m]?.groupId === g) next[g] = m;
        else changed = true;
      });
      return changed ? next : cur;
    });
  }, [agencies, validGroupIds, memberMap]);

  // 같은 기기로 이 방에 이미 제출한 적이 있으면 닉네임과 픽을 한 번만 복원
  useEffect(() => {
    if (restored.current || !uid || agencies.length === 0) return;
    const mine = roomUsers[uid];
    if (!mine) return;
    restored.current = true;
    if (!nicknameEditedInRoom.current) setNickname(mine.nickname);
    setPicks((cur) => {
      if (Object.keys(cur).length > 0) return cur; // 이미 고르기 시작했다면 덮어쓰지 않음
      const r: Picks = {};
      Object.entries(mine.picks).forEach(([gid, mid]) => {
        if (validGroupIds.has(gid) && memberMap[mid]?.groupId === gid) r[gid] = mid;
      });
      return r;
    });
  }, [uid, roomUsers, agencies, validGroupIds, memberMap]);

  const trimmedName = nickname.trim();

  // ── 핸들러
  const handlePick = (groupId: string, member: Member) => {
    setPicks((prev) => ({ ...prev, [groupId]: member.id }));
  };

  // 만들어진 이미지를 저장. 다운로드가 막힌 환경(앱 안 브라우저 등)이면 안내 창을 띄움
  const deliverBlob = async (blob: Blob, filename: string) => {
    if (!IN_APP_BROWSER.test(navigator.userAgent) && triggerDownload(blob, filename)) return;
    setPreview({ src: await blobToDataUrl(blob), blob, name: filename });
  };

  // 이미지 만들기 → 저장. 만드는 동안 버튼을 잠그고, 너무 오래 걸리면 중단해서 '반응 없음'이 없게 함
  const runSave = async (make: () => Promise<Blob>, filename: string, timeoutMs: number) => {
    if (savingImage) return;
    setSavingImage(true);
    try {
      const blob = await withTimeout(make(), timeoutMs);
      await deliverBlob(blob, filename);
    } finally {
      setSavingImage(false);
    }
  };

  // 앱 안 브라우저 → 기본 브라우저로 넘길 때, 지금 고른 선택이 이어지도록 주소에 실어 보냄
  const buildTransferUrl = () => {
    const code = agencies
      .flatMap((a) => a.groups)
      .map((g) => {
        const idx = g.members.findIndex((m) => m.id === picks[g.id]);
        return idx >= 0 ? idx.toString(36) : "-";
      })
      .join("");
    const u = new URL(window.location.href);
    u.hash = sheetRoute;
    u.searchParams.set("lang", lang);
    u.searchParams.set("pk", code);
    if (trimmedName) u.searchParams.set("nk", trimmedName);
    return u.toString();
  };

  const openExternal = () => {
    const url = buildTransferUrl();
    const ua = navigator.userAgent;
    if (/KAKAOTALK/i.test(ua)) {
      window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
    } else if (/Android/i.test(ua)) {
      window.location.href = `intent://${url.replace(/^https?:\/\//, "")}#Intent;scheme=https;package=com.android.chrome;end`;
    } else {
      alert(t("alertExternalBrowser"));
    }
  };

  const copyTransferUrl = async () => {
    const ok = await copyText(buildTransferUrl());
    alert(ok ? t("alertTransferCopied") : t("alertCopyFailed"));
  };

  const sharePreview = async () => {
    if (!preview) return;
    try {
      await navigator.share({ files: [new File([preview.blob], preview.name, { type: "image/png" })] });
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") alert(t("alertShareFailed"));
    }
  };

  const requireComplete = () => {
    if (totalGroups === 0 || pickedCount < totalGroups) {
      alert(t("alertPickAll", { total: totalGroups, picked: pickedCount }));
      return false;
    }
    return true;
  };

  // 내 선택 이미지 저장 (서버를 거치지 않음 · 1명 이상만 골라도 저장 가능 · 닉네임은 선택 사항)
  const savePersonalImage = async () => {
    if (pickedCount === 0) {
      alert(t("alertPickAll", { total: totalGroups, picked: pickedCount }));
      return;
    }
    try {
      await runSave(
        () =>
          renderPersonalBlob(
            agencies,
            picks,
            memberMap,
            trimmedName ? t("personalTitleNamed", { name: trimmedName }) : t("personalTitleDefault"),
            sheetId === "current" ? undefined : titleForSheet(lang),
            sheetId,
            lang
          ),
        `${safeFileName(trimmedName || "my")}_${sheetId}_picks.png`,
        30000
      );
    } catch (err) {
      console.error("이미지 저장 에러:", err);
      alert(t("alertImageFail"));
      return;
    }
    // 통계 전송은 이미지 저장이 끝난 뒤, 실패해도 저장에 영향이 없도록 따로 처리
    try {
      if (sheetId === "current") sendAnonymousStats(picks, uid, validGroupIds, lang);
    } catch {
      /* 무시 */
    }
  };

  // 공유 링크 만들기 / 방에 제출 (16개 전체 선택 및 닉네임 필수)
  const handleSubmit = async () => {
    if (submitting) return;
    if (!requireComplete()) return;
    if (!trimmedName) {
      alert(t("alertNeedNickname"));
      nicknameRef.current?.focus();
      return;
    }
    const remainingMs = serverBusyRemainingMs();
    if (remainingMs > 0) {
      setServerBusy(true);
      if (remainingMs > 60 * 1000) {
        alert(t("alertRetryMinutes", { minutes: Math.ceil(remainingMs / (60 * 1000)) }));
      } else {
        alert(t("alertRetrySeconds", { seconds: Math.ceil(remainingMs / 1000) }));
      }
      return;
    }
    if (!uid) {
      alert(authError ? t("serverBusyMsg") : t("alertConnecting"));
      return;
    }
    if (roomId && !roomLoaded) {
      alert(t("alertRoomLoading"));
      return;
    }
    if (roomId && roomSource === "legacy") {
      alert(t("alertLegacyReadOnly"));
      return;
    }
    // 이미 50명이 다 찬 방에는 기존 참여자 수정만 허용하고 신규 참여는 차단
    if (roomId && !roomUsers[uid] && Object.keys(roomUsers).length >= MAX_USERS_PER_ROOM) {
      alert(t("roomFullNote", { max: MAX_USERS_PER_ROOM }));
      return;
    }
    // 서버 시간 도입 전에 만든 예전 방의 내 기록은 수정할 수 없음 (보기만 가능)
    if (uid && roomUsers[uid] && !roomUsers[uid].joinedTs) {
      alert(t("alertLegacyOwn"));
      return;
    }

    setSubmitting(true);
    try {
      const cleanPicks: Picks = {};
      Object.entries(picks).forEach(([g, m]) => {
        if (validGroupIds.has(g)) cleanPicks[g] = m;
      });

      const creating = !roomId;
      const newRoomName = roomNameInput.trim().slice(0, MAX_ROOM_NAME);
      // 동일 내용의 미확정 새 방 생성은 같은 ID로 재시도 (정상적인 다른 새 방 생성은 새 ID)
      const createSignature = JSON.stringify({
        nickname: trimmedName, name: newRoomName,
        picks: Object.keys(cleanPicks).sort().map((g) => [g, cleanPicks[g]])
      });

      // 이미 같은 내용으로 제출돼 있으면 서버에 쓰지 않음 (쓰기 절약)
      const mineNow = roomId ? roomUsers[uid] : undefined;
      if (mineNow && mineNow.nickname === trimmedName && samePicks(mineNow.picks, cleanPicks)) {
        setShowResult(true);
        return;
      }
      if (Date.now() - lastSubmitAt.current < SUBMIT_COOLDOWN_MS) {
        alert(t("alertSubmitCooldown"));
        return;
      }

      const pending = creating ? getPendingCreateRoom(uid, createSignature, sheetId) : null;
      const rid = roomId ?? pending!.rid;

      // 문서 id = 내 uid → 내 데이터만 쓸 수 있고, 닉네임이 같아도 서로 다른 문서로 저장됨
      const userRef = doc(db, roomCollection, rid, "users", uid);
      const userData = {
        nickname: trimmedName,
        picks: cleanPicks,
        // 처음 제출할 때만 서버 시간이 기록되고, 수정할 때는 기존 값을 그대로 유지
        joinedAt: roomUsers[uid]?.joinedTs ?? serverTimestamp()
      };

      // 새 방 생성에 사용한 ID가 서버에 이미 존재하는지 확인.
      // 타임아웃으로 커밋만 뒤늦게 성공했을 때 다시 덮어쓰지 않는다.
      const alreadySaved = async (): Promise<boolean> => {
        const snap = await withTimeout(getDocFromServer(userRef), 7000);
        if (!snap.exists()) return false;
        const mine = parseUserDoc(snap.data());
        return !!mine?.joinedTs && mine.nickname === trimmedName && samePicks(mine.picks, cleanPicks);
      };

      let writeConfirmed = false;
      if (creating && pending?.reused) {
        // 저장 확인이 불가능한 상태라면 새 커밋을 보내지 않아 중복/충돌 위험을 줄임
        writeConfirmed = await alreadySaved();
      }
      if (!writeConfirmed) {
        try {
          if (creating) {
            // 새 방과 내 기록을 한 번의 원자적 배치로 저장
            const batch = writeBatch(db);
            batch.set(doc(db, roomCollection, rid), { name: newRoomName, ownerUid: uid });
            batch.set(userRef, userData);
            await withTimeout(batch.commit(), 12000);
          } else {
            await withTimeout(setDoc(userRef, userData), 12000);
          }
        } catch (err) {
          // 응답만 늦고 실제 저장은 성공했을 수 있음. 새 방은 동일 ID의 저장 여부를 검사.
          // 확인 자체가 실패하면 pending ID를 유지하므로 다음 시도에도 다른 방을 만들지 않음.
          if (!creating) throw err;
          let confirmed = false;
          try { confirmed = await alreadySaved(); } catch { /* 다음 시도에서 같은 ID로 재확인 */ }
          if (!confirmed) throw err;
        }
      }

      if (sheetId === "current") sendAnonymousStats(cleanPicks, uid, validGroupIds, lang);

      const nextRooms = [
        {
          id: rid,
          nickname: trimmedName,
          lastAt: Date.now(),
          roomName: creating ? newRoomName : roomName
        },
        ...myRooms.filter((r) => r.id !== rid)
      ].slice(0, MY_ROOMS_MAX);
      setMyRooms(nextRooms);
      saveMyRooms(nextRooms, sheetId);

      lastSubmitAt.current = Date.now();

      // 제출 직후에는 방 전체(참여자 수만큼)를 다시 읽지 않고 '내 문서 1건'만 읽어 화면과 저장본에 반영 (읽기 절약)
      let saved: UserDoc | null = null;
      try {
        const snap = await withTimeout(getDocFromServer(userRef), 8000);
        saved = snap.exists() ? parseUserDoc(snap.data()) : null;
      } catch {
        saved = null;
      }
      if (saved && saved.joinedTs) {
        const now = Date.now();
        const nextData: RoomData = {
          source: "main",
          at: creating ? now : roomFetchedAt ?? now, // 기존 방은 '마지막으로 서버에서 읽은 시각'을 유지
          name: creating ? newRoomName : roomName,
          ownerUid: creating ? uid : roomOwner,
          users: { ...(creating ? {} : roomUsers), [uid]: saved }
        };
        saveRoomCache(rid, nextData, sheetId);
        setRoomUsers(nextData.users);
        setRoomName(nextData.name);
        setRoomOwner(nextData.ownerUid);
        setRoomSource("main");
        setRoomFetchedAt(nextData.at);
        setRoomMetaLoaded(true);
        setRoomError(false);
        setRoomLoaded(true);
        setRoomStale(false);
        if (creating) {
          window.history.replaceState({}, "", `${window.location.pathname}?room=${rid}${sheetRoute}`);
          setRoomId(rid);
        }
      } else {
        // 내 문서를 못 읽었을 때만 예전처럼 방 전체를 다시 읽음
        forceRefresh.current = true;
        if (!roomId) {
          window.history.replaceState({}, "", `${window.location.pathname}?room=${rid}${sheetRoute}`);
          setRoomId(rid);
        } else {
          setRoomRefreshTick((t) => t + 1);
        }
      }
      if (creating) clearPendingCreateRoom(rid, sheetId);
      setNickname(trimmedName);
      setShowResult(true);
    } catch (err) {
      console.error("제출 에러:", (err as { code?: string })?.code, err);
      const kind = getServerErrorKind(err);
      const delay = markServerBusy(err);
      if (delay > 0) setServerBusy(true);
      if (kind === "quota") {
        alert(t("serverBusyMsg"));
      } else if (kind === "unavailable" || kind === "deadline") {
        alert(t("alertNetworkRetry", { seconds: Math.ceil(delay / 1000) }));
      } else if (kind === "timeout") {
        alert(t("alertSaveUncertain"));
      } else {
        alert(t("alertSaveError"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    const ok = await copyText(window.location.href);
    alert(ok ? t("alertLinkCopied") : t("alertLinkCopyFailed"));
  };

  // 지금 방에서 나가 새 방을 만들 준비: 고른 픽과 닉네임은 유지, 기존 방의 제출 기록은 그대로 남음
  const startNewRoom = () => {
    const ok = window.confirm(t("confirmNewRoom"));
    if (!ok) return;
    window.history.replaceState({}, "", `${window.location.pathname}${sheetRoute}`);
    setRoomId(null);
    setRoomUsers({});
    setRoomName("");
    setRoomOwner(null);
    setRoomMetaLoaded(false);
    setRoomSource("main");
    setRoomFetchedAt(null);
    setRoomStale(false);
    setRoomNameInput("");
    setRoomError(false);
    setRoomLoaded(true);
    setShowResult(false);
    window.scrollTo({ top: 0 });
  };

  // 내가 참여했던 방으로 이동 (그 방에 낸 내 픽은 자동으로 다시 불러옴)
  const openRoom = (id: string) => {
    if (id === roomId) return;
    if (pickedCount > 0) {
      const ok = window.confirm(t("confirmSwitchRoom"));
      if (!ok) return;
    }
    window.history.replaceState({}, "", `${window.location.pathname}?room=${id}${sheetRoute}`);
    restored.current = false;
    nicknameEditedInRoom.current = false;
    // 방마다 저장한 닉네임이 있으면 즉시 복원, 처음 들어간 방이면 빈칸으로 시작
    setNickname(myRooms.find((r) => r.id === id)?.nickname ?? "");
    setPicks({});
    setRoomUsers({});
    setRoomName("");
    setRoomOwner(null);
    setRoomMetaLoaded(false);
    setRoomSource("main");
    setRoomFetchedAt(null);
    setRoomStale(false);
    setRoomError(false);
    setRoomLoaded(false);
    setRoomId(id);
    setShowResult(true);
    window.scrollTo({ top: 0 });
  };

  // 방을 만든 사람만 이름 변경 가능 (규칙에서도 막음)
  const renameRoom = async () => {
    if (!roomId || !uid || roomOwner !== uid) return;
    const input = window.prompt(t("promptRename", { max: MAX_ROOM_NAME }), roomName);
    if (input === null) return;
    const newName = input.trim().slice(0, MAX_ROOM_NAME);
    try {
      await withTimeout(updateDoc(doc(db, roomCollection, roomId), { name: newName }), 12000);
      // 서버 저장이 끝나면 화면과 이 기기의 저장본에도 바로 반영
      setRoomName(newName);
      saveRoomCache(roomId, {
        source: "main",
        at: roomFetchedAt ?? Date.now(),
        name: newName,
        ownerUid: roomOwner,
        users: roomUsers
      }, sheetId);
    } catch (err) {
      console.error("방 이름 변경 에러:", err);
      alert(t("alertRenameFail"));
    }
  };

  // 목록에서만 지움 (방 자체나 서버의 기록은 그대로)
  const removeMyRoom = (id: string) => {
    const next = myRooms.filter((r) => r.id !== id);
    setMyRooms(next);
    saveMyRooms(next, sheetId);
  };

  const saveBoardImage = async () => {
    const target = boardRef.current;
    if (!target) return;
    try {
      await runSave(() => renderToBlob(target, true), `${sheetId}_multi_picks.png`, 60000);
    } catch (err) {
      console.error("이미지 저장 에러:", err);
      alert(t("alertImageFail"));
    }
  };

  // ── 화면
  if (!sheetDataLoaded) return <div className="App notice-page">{t("loadingData")}</div>;

  const myResultExists = !!uid && !!roomUsers[uid];

  const langSwitch = <LangSwitch lang={lang} onChange={changeLang} t={t} />;

  const myRoomsPanel = multiplayer ? (
    <MyRoomsPanel
      myRooms={myRooms}
      roomId={roomId}
      lang={lang}
      t={t}
      onOpen={openRoom}
      onRemove={removeMyRoom}
    />
  ) : null;

  // 앞으로 새 서비스를 추가할 때 이 배열에 항목만 추가하면 서랍 메뉴와 고유 주소(#/아이디)가 자동으로 표시됩니다.
  const serviceList: {
    id: ServiceId;
    icon: string;
    title: string;
    desc: string;
    hashPath: string;
  }[] = [
    {
      id: "picks",
      icon: "⭐",
      title: t("tabPicks").replace(/^⭐\s*/, ""),
      desc: t("navDescPicks"),
      hashPath: sheetRoute
    },
    {
      id: "quiz",
      icon: "🎵",
      title: t("tabQuiz").replace(/^🎵\s*/, ""),
      desc: t("navDescQuiz"),
      hashPath: "#/quiz"
    }
  ];

  const currentService = serviceList.find((s) => s.id === activeTab) || serviceList[0];

  const copyCurrentServiceUrl = async () => {
    const base = window.location.origin + window.location.pathname;
    const shareUrl =
      activeTab === "quiz"
        ? `${base}#/quiz`
        : roomId
        ? `${base}?room=${roomId}${sheetRoute}`
        : `${base}${sheetRoute}`;
    const ok = await copyText(shareUrl);
    alert(ok ? t("navPageUrlCopied", { url: shareUrl }) : t("alertCopyFailed"));
  };

  const siteHeader = (
    <>
      <header className="site-header">
        <div className="site-header-inner">
          <div className="site-header-left">
            <button
              type="button"
              className="menu-trigger-btn"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <span className="menu-burger-icon" aria-hidden="true">☰</span>
              <span>{t("navMenuBtn")}</span>
            </button>
            <span className="current-service-pill">
              <span aria-hidden="true">{currentService.icon}</span>
              <span>{currentService.title}</span>
            </span>
          </div>
          <div className="site-header-right">
            <button
              type="button"
              className="copy-page-url-btn"
              onClick={copyCurrentServiceUrl}
              title={t("navCopyPageUrl")}
            >
              {t("navCopyPageUrl")}
            </button>
            {langSwitch}
          </div>
        </div>
      </header>

      {drawerOpen && (
        <div
          className="drawer-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={t("navDrawerTitle")}
          onClick={() => setDrawerOpen(false)}
        >
          <aside className="service-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="service-drawer-head">
              <div>
                <h2 className="service-drawer-title">{t("navDrawerTitle")}</h2>
                <p className="service-drawer-sub">{t("navDrawerSub")}</p>
              </div>
              <button
                type="button"
                className="service-drawer-close"
                aria-label={t("close")}
                onClick={() => setDrawerOpen(false)}
              >
                ×
              </button>
            </div>
            <nav className="service-drawer-list">
              {serviceList.map((svc) => {
                const isActive = svc.id === activeTab;
                return (
                  <a
                    key={svc.id}
                    href={svc.hashPath}
                    className={`service-drawer-card ${isActive ? "active" : ""}`}
                    onClick={(e) => {
                      e.preventDefault();
                      navigateService(svc.id);
                    }}
                  >
                    <div className="service-card-top">
                      <span className="service-card-icon">{svc.icon}</span>
                      <span className="service-card-name">{svc.title}</span>
                      <span className="service-card-path">{svc.hashPath}</span>
                    </div>
                    <p className="service-card-desc">{svc.desc}</p>
                  </a>
                );
              })}
            </nav>
          </aside>
        </div>
      )}
    </>
  );

  return (
    <div className="App">
      {siteHeader}
      {activeTab === "picks" && (
        <nav className="pick-bookmark-nav" aria-label={lang === "ko" ? "취향표 종류" : "Pick sheet categories"}>
          {VISIBLE_PICK_SHEET_IDS.map((id) => (
            <button key={id} type="button"
              className={`pick-bookmark-tab${sheetId === id ? " active" : ""}`}
              aria-current={sheetId === id ? "page" : undefined}
              onClick={() => onSwitchSheet(id)}>
              {PICK_SHEETS[id].labels[lang]}
            </button>
          ))}
        </nav>
      )}
      {activeTab === "quiz" ? (
        <SongQuiz lang={lang} t={t} />
      ) : !showResult ? (
        <>
          {myRoomsPanel}
          <h1>{sheetId === "current" ? t("appTitle") : `${titleForSheet(lang)} · PickYours`}</h1>
          <p className="subtitle">{totalGroups ? t("subtitle", { total: totalGroups }) : (
            lang === "ko" ? "ES_list.csv에 해당 분류의 멤버를 입력하면 여기에 표시돼요." :
              lang === "ja" ? "ES_list.csvにメンバーを入力すると、ここに表示されます。" :
                "Add members to this category in ES_list.csv to show them here."
          )}</p>
          {totalGroups > 0 && <p className="progress">
            {pickedCount} / {totalGroups}
            {pickedCount > 0 && (
              <button
                type="button"
                className="reset-btn"
                onClick={() => {
                  if (window.confirm(t("confirmReset"))) setPicks({});
                }}
              >
                {t("reset")}
              </button>
            )}
          </p>}

          {multiplayer && roomId && (
            <div className="room-banner">
              <span>
                {roomError
                  ? t("roomLoadError")
                  : roomLoaded
                  ? `${roomSource === "legacy" ? t("roomBannerLegacy") : t("roomBannerJoined")}${
                      roomName ? ` · ${roomName}` : ""
                    } · ${t("participantsCount", { n: displayUsers.length })}`
                  : t("roomLoading")}
              </span>
              {displayUsers.length > 0 && (
                <button type="button" onClick={() => setShowResult(true)}>
                  {t("viewOthers")}
                </button>
              )}
              <button type="button" className="ghost" onClick={startNewRoom}>
                {t("newRoom")}
              </button>
            </div>
          )}

          {totalGroups === 0 && (
            <div className="pick-bookmark-empty">
              <p>{lang === "ko" ? "CSV에 멤버가 입력되면 선택 화면이 자동으로 열려요." : lang === "ja" ? "CSVにメンバーが登録されると選べます。" : "Members will appear after you update the CSV."}</p>
              {sheetId === "special" && <div className="pick-bookmark-unit-tags">
                {SPECIAL_UNITS.map((unit) => <span key={unit}>{unit}</span>)}
              </div>}
            </div>
          )}
          <div className="agency-list" ref={listRef}>
            {agencies.map((agency) => (
              <div key={agency.id} className="agency-container">
                <h2 className="agency-title">{agency.name}</h2>
                {agency.groups.map((g) => (
                  <div key={g.id} className="group-row">
                    <div className="group-name">{g.name}</div>
                    <div
                      className="members"
                      style={
                        listWidth
                          ? { maxWidth: balancedMaxWidth(g.members.length, listWidth - CARD_PADDING) }
                          : undefined
                      }
                    >
                      {g.members.map((m) => {
                        const selected = picks[g.id] === m.id;
                        return (
                          <div key={m.id} className="member-wrapper">
                            <img
                              src={m.img}
                              alt={m.name}
                              role="button"
                              tabIndex={0}
                              aria-pressed={selected}
                              onError={onImgError(m.fallback)}
                              onClick={() => handlePick(g.id, m)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  handlePick(g.id, m);
                                }
                              }}
                              className={selected ? "selected" : ""}
                            />
                            <span className="member-name">{m.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* 내 선택 미리보기 + 저장/공유 */}
          <section className="finish-section">
            <h2 className="finish-title">{t("myPicksTitle")}</h2>
            <div className="personal-wrap">
              <div ref={personalRef} className={`personal-card${sheetId !== "current" ? " personal-card--collection" : ""}${sheetId === "special" ? " personal-card--special" : ""}`}>
                {sheetId !== "current" && (
                  <div className="personal-collection-eyebrow">PICKYOURS · {titleForSheet(lang)}</div>
                )}
                <h3 className="personal-title">
                  {trimmedName ? t("personalTitleNamed", { name: trimmedName }) : t("personalTitleDefault")}
                </h3>
                {sheetId !== "current" && (
                  <div className="personal-collection-count">
                    {lang === "ko" ? `${pickedCount} / ${totalGroups} 선택` :
                     lang === "ja" ? `${pickedCount} / ${totalGroups} 選択` :
                     `${pickedCount} / ${totalGroups} selected`}
                  </div>
                )}
                {sheetId === "special" ? (
                  <div className="personal-special-sections">
                    {specialSections.map((section, sectionIndex) => (
                      <section key={section.id} className="personal-special-section" aria-label={section.title}>
                        <div className="personal-special-section-heading">
                          <span className="personal-special-section-number">
                            {String(sectionIndex + 1).padStart(2, "0")}
                          </span>
                          <h4>{section.title}</h4>
                          <span className="personal-special-section-count">{section.groups.length} UNITS</span>
                        </div>
                        <div className={`personal-special-picks${section.groups.length > 5 ? " personal-special-picks--six" : ""}`}>
                          {section.groups.map((g) => {
                            const m = memberMap[picks[g.id]];
                            const pick = m && m.groupId === g.id ? m : undefined;
                            return (
                              <div key={g.id} className="personal-special-pick">
                                <div className="personal-special-unit" title={g.name}>{g.name}</div>
                                <div className="personal-special-photo">
                                  {pick ? (
                                    <img src={pick.img} alt={pick.name} onError={onImgError(pick.fallback)} />
                                  ) : (
                                    <span aria-label={lang === "ko" ? "미선택" : "Not selected"}>—</span>
                                  )}
                                </div>
                                <div className="personal-special-name">
                                  {pick?.name || (lang === "ko" ? "미선택" : "—")}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="personal-grid">
                  {agencies.map((agency) => (
                    <div key={agency.id} className={`personal-agency${sheetId !== "current" ? " personal-agency--collection" : ""}`}>
                      {sheetId === "current" && (
                        <img src={agency.logo} alt={agency.name} className="personal-agency-logo" />
                      )}
                      <div className={`personal-picks${sheetId !== "current" ? " personal-picks--collection" : ""}`}>
                        {agency.groups.map((g) => {
                          const m = memberMap[picks[g.id]];
                          const pick = m && m.groupId === g.id ? m : undefined;
                          return (
                            <div key={g.id} className="personal-pick">
                              <div className="slot">
                                {pick ? (
                                  <img src={pick.img} alt={pick.name} onError={onImgError(pick.fallback)} />
                                ) : (
                                  "?"
                                )}
                              </div>
                              <div className="pick-name">{pick ? pick.name : "\u00A0"}</div>
                              <div className="pick-unit">{g.name}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  </div>
                )}
              </div>
            </div>

            {multiplayer && <>
            <div className="nickname-row">
              <label htmlFor="nickname">{t("nickname")}</label>
              <input
                id="nickname"
                ref={nicknameRef}
                type="text"
                value={nickname}
                maxLength={MAX_NICKNAME_LENGTH}
                onChange={(e) => {
                  nicknameEditedInRoom.current = true;
                  setNickname(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
                }}
                placeholder={t("nicknamePlaceholder")}
              />
            </div>
            <p className="hint">{t("nicknameHint")}</p>

            {!roomId && (
              <>
                <div className="nickname-row">
                  <label htmlFor="roomname">{t("roomNameLabel")}</label>
                  <input
                    id="roomname"
                    type="text"
                    value={roomNameInput}
                    maxLength={MAX_ROOM_NAME}
                    onChange={(e) => setRoomNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
                    }}
                    placeholder={t("roomNamePlaceholder")}
                  />
                </div>
                <p className="hint">{t("roomNameHint")}</p>
              </>
            )}

            </>}
            <div className="finish-buttons">
              <button
                className="download-btn"
                onClick={savePersonalImage}
                disabled={savingImage || pickedCount === 0}
                style={{ backgroundColor: "#20c997" }}
              >
                {savingImage ? t("makingImage") : t("saveMyImage")}
              </button>
              {multiplayer && <button className="download-btn" onClick={handleSubmit} disabled={submitting || totalGroups === 0}>
                {submitting ? t("saving") : roomId ? t("submitToRoom") : t("createShareLink")}
              </button>}
            </div>
            {sheetId === "current" && STATS_SAMPLE_RATE > 0 && (
              <p className="hint">
                {t("statsNoticePre")}
                <b>{t("statsNoticeBold")}</b>
                {t("statsNoticePost")}
              </p>
            )}
            {multiplayer && serverBusy && <p className="hint busy-note">{t("serverBusyNote")}</p>}
            {multiplayer && authError && <p className="hint">{t("authErrorNote")}</p>}
          </section>
        </>
      ) : (
        <div className="result-view">
          {myRoomsPanel}
          {!roomLoaded && (
            <p className="hint-inline" style={{ textAlign: "center" }}>
              {t("roomLoading")}
            </p>
          )}
          {roomError && (
            <p className="hint-inline" style={{ textAlign: "center" }}>
              {t("roomLoadError")}
            </p>
          )}
          <div className="result-buttons">
            <button className="download-btn" onClick={copyLink} style={{ backgroundColor: "#4dabf7" }}>
              {t("copyLink")}
            </button>
            <button className="download-btn" onClick={() => setShowResult(false)}>
              {myResultExists ? t("editMyPicks") : t("choosePicks")}
            </button>
            <button
              className="download-btn"
              onClick={saveBoardImage}
              disabled={savingImage}
              style={{ backgroundColor: "#20c997" }}
            >
              {savingImage ? t("makingImage") : t("saveBoardImage")}
            </button>
            <button className="download-btn" onClick={startNewRoom} style={{ backgroundColor: "#868e96" }}>
              {t("newRoom")}
            </button>
            {!!uid && roomOwner === uid && (
              <button className="download-btn" onClick={renameRoom} style={{ backgroundColor: "#845ef7" }}>
                {t("renameRoomBtn")}
              </button>
            )}
          </div>

          <div className="room-status">
            {roomFetchedAt && (
              <span>
                {t("loadedAt", {
                  time: new Date(roomFetchedAt).toLocaleTimeString(LOCALE[lang], { hour: "2-digit", minute: "2-digit" })
                })}
              </span>
            )}
            <button type="button" className="link-btn" onClick={refreshRoom} disabled={roomLoading}>
              {roomLoading ? t("refreshing") : t("refresh")}
            </button>
            {roomSource === "legacy" && <span className="status-note">{t("legacyViewOnly")}</span>}
            {roomStale && <span className="status-note">{t("staleNote")}</span>}
            {displayUsers.length >= MAX_USERS_PER_ROOM && (
              <span className="status-note">{t("roomFullNote", { max: MAX_USERS_PER_ROOM })}</span>
            )}
          </div>

          <div className="board-options">
            <label className={`switch ${displayUsers.length < 2 ? "disabled" : ""}`}>
              <input
                type="checkbox"
                role="switch"
                checked={showMatch}
                disabled={displayUsers.length < 2}
                onChange={(e) => setShowMatch(e.target.checked)}
              />
              <span className="switch-track" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
              <span>{t("showMatch")}</span>
            </label>
            {matchOn && (
              <label>
                {t("baseLabel")}{" "}
                <select value={baseUserId ?? ""} onChange={(e) => setBaseChoice(e.target.value)}>
                  {displayUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                      {u.id === uid ? t("meSuffix") : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {displayUsers.length < 2 && <span className="hint-inline">{t("needTwo")}</span>}
          </div>

          <div
            ref={boardRef}
            className="comparison-board"
            style={{ ["--slot" as any]: `${BOARD_SLOT}px`, ["--gap" as any]: `${BOARD_GAP}px` }}
          >
            <h2 style={{ textAlign: "center", marginBottom: matchOn ? "6px" : "30px" }}>
              {roomName ? t("resultTitleRoom", { name: roomName }) : t("resultTitleDefault")}
            </h2>
            {matchOn && <p className="match-subtitle">{t("matchSubtitle", { name: baseLabel })}</p>}

            <div className="user-compare-row header-row">
              <div className="compare-user-name"></div>
              <div className="compare-user-picks">
                {agencies.map((agency) => (
                  <div key={`header-${agency.id}`} className="compare-agency-section">
                    <img src={agency.logo} alt={agency.name} className="agency-header-logo" />
                    <div className="agency-groups-row">
                      {agency.groups.map((g, gi) => {
                        const box = logoBoxes[agency.id]?.[gi];
                        return (
                          <div key={`header-${g.id}`} className="compare-slot header-slot">
                            <img
                              src={g.logo}
                              alt={g.name}
                              className="header-logo"
                              style={box ? { width: box.w, height: box.h } : undefined}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {matchOn && <div className="compare-match match-head">{t("matchHead")}</div>}
            </div>

            {displayUsers.map((u) => (
              <div key={u.id} className="user-compare-row">
                <div className="compare-user-name">{u.label}</div>
                <div className="compare-user-picks">
                  {agencies.map((agency) => (
                    <div key={`data-${agency.id}`} className="compare-agency-section data-section">
                      <div className="agency-groups-row">
                        {agency.groups.map((g) => {
                          const pick = memberMap[u.picks[g.id]];
                          const basePick = baseUserId ? roomUsers[baseUserId]?.picks[g.id] : undefined;
                          const same =
                            matchOn &&
                            u.id !== baseUserId &&
                            matchGroupIds.has(g.id) &&
                            !!basePick &&
                            basePick === u.picks[g.id];
                          return (
                            <div key={g.id} className={`compare-slot${same ? " matched" : ""}`}>
                              {pick && pick.groupId === g.id ? (
                                <img src={pick.img} alt={pick.name} onError={onImgError(pick.fallback)} />
                              ) : (
                                <div className="empty-pick">?</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                {matchOn && matches && (
                  <div
                    className={`compare-match${
                      u.id !== baseUserId && bestMatchCount > 0 && matches[u.id]?.count === bestMatchCount
                        ? " match-best"
                        : ""
                    }`}
                  >
                    {u.id === baseUserId ? (
                      <div className="match-base">{t("matchBase")}</div>
                    ) : (
                      <>
                        <div className="match-percent">
                          {Math.round(((matches[u.id]?.count ?? 0) / (matches[u.id]?.total || 1)) * 100)}%
                        </div>
                        <div className="match-count">
                          {matches[u.id]?.count ?? 0}/{matches[u.id]?.total ?? 0}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {preview && (
        <ImagePreviewModal
          preview={preview}
          t={t}
          onClose={() => setPreview(null)}
          onShare={sharePreview}
          onOpenExternal={openExternal}
          onCopyUrl={copyTransferUrl}
        />
      )}
    </div>
  );
}
