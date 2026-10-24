import React, { useState, useEffect, useRef, useMemo } from "react";
import type { Lang, MsgKey } from "./i18n";
import type { Agency } from "./types";
import { loadAgencies, loadCsv, stripQuotes } from "./csv";
import { localizeAgencies } from "./localize";
import { SHUFFLE_UNIT_ID, FUSION_UNIT_ID, COLLAB_UNIT_ID, SOLO_UNIT_ID, classifyQuizSongUnit, makeOfficialUnitAliases, makeSoloArtistAliases } from "./quizUnits";
export { SHUFFLE_UNIT_ID, FUSION_UNIT_ID, COLLAB_UNIT_ID, SOLO_UNIT_ID } from "./quizUnits";
import "./quiz.css";
import ImagePreviewModal from "./components/ImagePreviewModal";
import { withTimeout, copyText } from "./utils";
import { triggerDownload, blobToDataUrl } from "./imageExport";
import { IN_APP_BROWSER } from "./config";
import { calcQuestionScore, summarizeHistory } from "./quizScore";
import { trackAnalyticsEvent } from "./analytics";
import { generateRoomId } from "./rooms";
import { saveQuizCompletion } from "./quizResults";
import type { QuizPool } from "./quizResults";
import { loadQuizPercentileData, calculateQuizPercentile } from "./quizPercentiles";
import { getAcceptedAnswers, normalizeAnswer, isCorrectGuess } from "./quizAnswer";
export { normalizeAnswer, isCorrectGuess } from "./quizAnswer";
import type { QuizPercentile } from "./quizPercentiles";
import {
  QUIZ_SHARE_HASHTAGS,
  buildQuizShareUrl,
  buildTweetIntentUrl,
  parseQuizChallenge,
  renderQuizResultBlob
} from "./quizShare";
import type { QuizResultInfo, ResultCardText, TopSongLine } from "./quizShare";

export interface SongItem {
  id: string;
  unit: string; // 셔플곡/퓨전곡/콜라보곡/솔로곡은 필터용 카테고리 ID로 묶음
  rawUnit: string; // songs.csv에 적힌 원래 유닛명 (예: 'Ring.A.Bell', 'MODE/D')
  titleKo: string;
  titleEn: string;
  titleJa: string;
  aliases: string[];
  videoId: string;
  startMin: number;
  endMax: number;
}

interface HistoryItem {
  song: SongItem;
  correct: boolean;
  tries: number; // 정답 제출까지의 총 시도 횟수 (정답 포함)
  clipSec: number; // 정답/포기 시점에 설정돼 있던 듣기 길이(초)
  hint: boolean; // 유닛 힌트를 봤는지
  score: number; // 이 문제의 점수 (0~100)
  listens: number; // 이 문제에서 구간을 재생한 총 횟수 (같은 구간 반복 포함)
}

interface SongQuizProps {
  lang: Lang;
  t: (key: MsgKey, params?: Record<string, string | number>) => string;
}

// 유튜브 일반 링크, 짧은 링크(youtu.be), 쇼츠, 유튜브 뮤직(music.youtube.com), 혹은 11자리 영상 ID에서 ID 추출
export function extractYouTubeId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const v = u.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && /^[a-zA-Z0-9_-]{11}$/.test(last)) return last;
  } catch {
    /* URL 객체 파싱 실패 시 아래 정규식으로 재시도 */
  }
  const m = s.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|watch\?v=)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// 배열 무작위 섞기 (Fisher-Yates)
function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

// YouTube IFrame API 스크립트를 로드하고 YT.Player 객체를 반환 (차단·네트워크 오류면 12초 뒤 실패로 처리)
let ytApiPromise: Promise<any> | null = null;
function loadYouTubeApi(): Promise<any> {
  const w = window as any;
  if (w.YT && w.YT.Player) return Promise.resolve(w.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    let timer = 0;
    let giveUp = 0;
    const finish = (ok: boolean) => {
      window.clearInterval(timer);
      window.clearTimeout(giveUp);
      if (ok) {
        resolve(w.YT);
      } else {
        ytApiPromise = null; // 다음 시도에서 다시 불러올 수 있게 초기화
        document.querySelector('script[src="https://www.youtube.com/iframe_api"]')?.remove();
        reject(new Error("YouTube API load failed"));
      }
    };
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") prev();
      if (w.YT && w.YT.Player) finish(true);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => finish(false);
      document.head.appendChild(script);
    }
    timer = window.setInterval(() => {
      if (w.YT && w.YT.Player) finish(true);
    }, 100);
    giveUp = window.setTimeout(() => finish(false), 12000);
  });
  return ytApiPromise;
}

// 정답 직후 터지는 색종이 조각 (dx: 좌우로 퍼지는 거리, up: 위로 솟는 높이, rot: 회전, d: 시작 지연)
const CONFETTI = [
  { dx: -130, up: 80, rot: -320, c: "#ff6b6b", d: 0 },
  { dx: -96, up: 120, rot: 250, c: "#ffd43b", d: 0.03 },
  { dx: -64, up: 96, rot: -180, c: "#12b886", d: 0.01 },
  { dx: -34, up: 132, rot: 300, c: "#4dabf7", d: 0.05 },
  { dx: -12, up: 108, rot: -260, c: "#b197fc", d: 0.02 },
  { dx: 12, up: 128, rot: 220, c: "#ff922b", d: 0.04 },
  { dx: 34, up: 104, rot: -300, c: "#ff6b6b", d: 0 },
  { dx: 64, up: 136, rot: 180, c: "#12b886", d: 0.06 },
  { dx: 96, up: 92, rot: -240, c: "#ffd43b", d: 0.02 },
  { dx: 130, up: 84, rot: 340, c: "#4dabf7", d: 0.03 },
  { dx: -110, up: 52, rot: 200, c: "#b197fc", d: 0.07 },
  { dx: 110, up: 56, rot: -210, c: "#ff922b", d: 0.08 },
  { dx: -48, up: 70, rot: 280, c: "#ff6b6b", d: 0.09 },
  { dx: 48, up: 74, rot: -270, c: "#12b886", d: 0.1 }
];

// 결과 화면에서 처음 보여 줄 곡 수 (나머지는 접어 둠)
const HISTORY_TOP_N = 5;

// 결과 이미지에 들어갈 글
function buildResultCardText(
  tt: SongQuizProps["t"],
  correct: number,
  total: number,
  easy: boolean,
  percent: number,
  score: number,
  ranked: { item: HistoryItem; idx: number }[],
  lang: Lang
): ResultCardText {
  // 점수 높은 정답 곡 3개 (포기한 곡은 제외)
  const top: TopSongLine[] = ranked
    .filter((x) => x.item.correct)
    .slice(0, 3)
    .map((x, i) => ({
      rank: i + 1,
      title: primaryTitle(x.item.song, lang),
      meta: tt("quizSongMeta", { sec: x.item.clipSec, listens: x.item.listens, tries: x.item.tries }),
      score: `${x.item.score}${tt("quizScoreUnit")}`
    }));
  return {
    title: tt("quizTitle"),
    rateLabel: tt("quizSummaryRateLabel"),
    detail: tt("quizSummaryScoreDetail", { total, correct }),
    modeLabel: easy ? tt("quizModeEasyShort") : tt("quizModeHardShort"),
    scoreText: tt("quizScoreLine", { score }),
    topTitle: tt("quizShareTop3Title"),
    top,
    footer: window.location.host + window.location.pathname.replace(/\/$/, ""),
    percent
  };
}

// 현재 언어에 맞는 대표 제목 / 입력칸에 채워 넣을 제목
function primaryTitle(s: SongItem, lang: Lang): string {
  return lang === "ja"
    ? s.titleJa || s.titleEn || s.titleKo
    : lang === "en"
    ? s.titleEn || s.titleKo || s.titleJa
    : s.titleKo || s.titleEn || s.titleJa;
}

export default function SongQuiz({ lang, t }: SongQuizProps) {
  const tRef = useRef(t);
  tRef.current = t;

  // 퀴즈의 정규 유닛 기준은 현재 취향표(unit 컬럼)로 고정합니다.
  // 스페셜/Shuffle 취향표에서 넘어와도 해당 취향표의 그룹을 퀴즈에 전달하지 않습니다.
  const [quizBaseAgencies, setQuizBaseAgencies] = useState<Agency[]>([]);
  const quizAgencies = useMemo(() => localizeAgencies(quizBaseAgencies, lang), [quizBaseAgencies, lang]);
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [loadingCsv, setLoadingCsv] = useState(true);
  const [csvError, setCsvError] = useState(false);

  // 진행 단계: "setup" (설정 화면) | "playing" (문제 풀이) | "summary" (최종 결과/정답률)
  const [phase, setPhase] = useState<"setup" | "playing" | "summary">("setup");

  // 난이도: true = 초보자 모드(자동완성 후보 표시), false = 하드 모드(직접 입력 + 부호/대소문자 보정)
  const [easyMode, setEasyMode] = useState<boolean>(true);

  // 문제 수 설정: 5, 10, 30, 또는 "custom"
  const [countPreset, setCountPreset] = useState<5 | 10 | 30 | "custom">(10);
  const [customCountInput, setCustomCountInput] = useState<string>("15");

  // 선택된 유닛 필터 (16개 정규 유닛 + 셔플곡 + 퓨전곡 + 콜라보곡 + 솔로곡)
  const allUnits = useMemo(() => {
    const base = quizAgencies.flatMap((a) => a.groups.map((g) => ({ id: g.id, name: g.name })));
    // 셔플곡이 1곡이라도 있으면 '셔플곡' 필터 버튼 추가
    if (songs.some((s) => s.unit === SHUFFLE_UNIT_ID)) {
      base.push({ id: SHUFFLE_UNIT_ID, name: tRef.current("quizShuffleUnit") });
    }
    // 서로 다른 유닛이 함께 부른 퓨전곡을 하나의 버튼으로 묶음
    if (songs.some((s) => s.unit === FUSION_UNIT_ID)) {
      base.push({ id: FUSION_UNIT_ID, name: tRef.current("quizFusionUnit") });
    }
    if (songs.some((s) => s.unit === COLLAB_UNIT_ID)) {
      base.push({ id: COLLAB_UNIT_ID, name: tRef.current("quizCollabUnit") });
    }
    if (songs.some((s) => s.unit === SOLO_UNIT_ID)) {
      base.push({ id: SOLO_UNIT_ID, name: tRef.current("quizSoloUnit") });
    }
    return base;
  }, [quizAgencies, songs, lang]);

  // 정규 유닛은 현재 유닛의 소속사별로, 나머지는 별도 섹션에 표시합니다.
  // 이 목록은 필터 UI 전용이므로 출제/정답 판정 및 선택 상태에 영향을 주지 않습니다.
  const otherQuizUnits = useMemo(() => {
    const categoryIds = new Set([SHUFFLE_UNIT_ID, FUSION_UNIT_ID, COLLAB_UNIT_ID, SOLO_UNIT_ID]);
    return allUnits.filter((unit) => categoryIds.has(unit.id));
  }, [allUnits]);

  const unitNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    allUnits.forEach((g) => {
      m[g.id] = g.name;
    });
    m[SHUFFLE_UNIT_ID] = tRef.current("quizShuffleUnit");
    m[FUSION_UNIT_ID] = tRef.current("quizFusionUnit");
    m[COLLAB_UNIT_ID] = tRef.current("quizCollabUnit");
    m[SOLO_UNIT_ID] = tRef.current("quizSoloUnit");
    return m;
  }, [allUnits, lang]);

  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(() => new Set());
  const knownUnitsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (allUnits.length === 0) return;
    const added: string[] = [];
    allUnits.forEach((u) => {
      if (!knownUnitsRef.current.has(u.id)) {
        knownUnitsRef.current.add(u.id);
        added.push(u.id);
      }
    });
    if (added.length > 0) {
      setSelectedUnits((prev) => {
        const next = new Set(Array.from(prev));
        added.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [allUnits]);

  // 현재 라운드 출제 큐 및 기록
  const [questionQueue, setQuestionQueue] = useState<SongItem[]>([]);
  const [questionIdx, setQuestionIdx] = useState<number>(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const runIdRef = useRef("");
  const completedRunRef = useRef("");
  const runPoolRef = useRef<QuizPool>("all");
  const [runPool, setRunPool] = useState<QuizPool>("all");
  const [percentile, setPercentile] = useState<QuizPercentile | null>(null);

  // 현재 문제 상태
  const [currentSong, setCurrentSong] = useState<SongItem | null>(null);
  const currentSongRef = useRef<SongItem | null>(null);
  currentSongRef.current = currentSong;

  const [clipDuration, setClipDuration] = useState<number>(1);
  const [startSec, setStartSec] = useState<number>(20);
  const [tries, setTries] = useState<number>(0);
  const [status, setStatus] = useState<"playing" | "correct" | "giveup">("playing");
  const [wrongShake, setWrongShake] = useState(false);
  const [showUnitHint, setShowUnitHint] = useState(false);
  const [guess, setGuess] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [listenCount, setListenCount] = useState(0); // 이 문제에서 들은 횟수
  const [activeIdx, setActiveIdx] = useState(0); // 자동완성 목록에서 방향키로 고른 항목
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);
  const wrongTimerRef = useRef<number | null>(null);
  const listenCountedRef = useRef(false);
  const playReqRef = useRef(0); // 재생 요청 번호 (연속 클릭 시 마지막 요청만 실행)
  const loadedVideoIdRef = useRef<string>(""); // 플레이어에 실제로 올라가 있는 영상

  // 플레이어 상태
  const playerRef = useRef<any>(null);
  const playerReadyRef = useRef(false);
  const playerHostRef = useRef<HTMLDivElement>(null);
  const quizCardRef = useRef<HTMLDivElement>(null);
  const stopTimerRef = useRef<number | null>(null);
  const loadWatchdogRef = useRef<number | null>(null);
  const pendingPlayRef = useRef(false);
  const activeVideoIdRef = useRef<string>("");
  const clipDurationRef = useRef(clipDuration);
  clipDurationRef.current = clipDuration;
  const startSecRef = useRef(startSec);
  startSecRef.current = startSec;

  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [playerError, setPlayerError] = useState(false);

  // songs.csv의 unit이 정규 16개 유닛 중 하나가 아니라면 셔플곡으로 자동 분류.
  // 서로 다른 정규 유닛이 합쳐진 이름(&, ×, VS 등)은 퓨전곡으로 분류한다.
  // 정규 유닛은 취향표 종류와 상관없이 loadAgencies()에서 별도로 읽는다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 앱에서 현재 보고 있던 시트의 agencies를 받지 않고, 항상 unit 기반 16개 유닛을 로드합니다.
        // Firestore 요청은 발생하지 않으며 CSV는 배포 버전별 브라우저 캐시를 재사용합니다.
        const [currentAgencies, memberRows, songRows] = await Promise.all([
          loadAgencies(), loadCsv("ES_list.csv"), loadCsv("songs.csv")
        ]);
        if (cancelled) return;
        setQuizBaseAgencies(currentAgencies);
        const officialAliases = makeOfficialUnitAliases(currentAgencies.flatMap((a) => a.groups));
        const soloArtistAliases = makeSoloArtistAliases(memberRows);

        // 2) songs.csv 파싱 (영어명 등 일부 언어 제목이 비어 있어도 있는 제목으로 자동 보완)
        const parsed: SongItem[] = [];
        songRows.forEach((r, idx) => {
          const rawUrl = stripQuotes(r.youtube || r.url || r.video || "");
          const videoId = extractYouTubeId(rawUrl);
          if (!videoId) return;

          const rawUnit = stripQuotes(r.unit || "") || "기타";
          // 원래 이름은 결과 화면에 남기고, 출제 필터에 사용하는 카테고리만 분류한다.
          // '콜라보곡' 6곡은 유닛 이름보다 곡 제목을 우선해 분류한다.
          const tKo = stripQuotes(r.title_ko || r.title || "");
          const tEn = stripQuotes(r.title_en || "");
          const tJa = stripQuotes(r.title_ja || "");
          const fallbackTitle = tKo || tEn || tJa;
          if (!fallbackTitle) return;
          const unit = classifyQuizSongUnit(rawUnit, fallbackTitle, officialAliases, soloArtistAliases);

          const aliases = stripQuotes(r.aliases || "")
            .split(/[|,]/)
            .map((s) => s.trim())
            .filter(Boolean);
          const startMin = Math.max(0, Number(stripQuotes(r.start_min || "")) || 15);
          const endMax = Math.max(0, Number(stripQuotes(r.end_max || "")) || 0);

          parsed.push({
            id: `song-${idx}-${videoId}`,
            unit,
            rawUnit,
            // 비어 있는 언어 칸은 다른 언어 제목으로 채워 두어 어느 언어 화면에서도 빈칸이 뜨지 않게 함
            titleKo: tKo || fallbackTitle,
            titleEn: tEn || fallbackTitle,
            titleJa: tJa || fallbackTitle,
            aliases,
            videoId,
            startMin,
            endMax
          });
        });
        setSongs(parsed);
      } catch (err) {
        console.warn("songs.csv 로드 실패:", err);
        if (!cancelled) setCsvError(true);
      } finally {
        if (!cancelled) setLoadingCsv(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 유닛별 곡 수 집계
  const songCountByUnit = useMemo(() => {
    const counts: Record<string, number> = {};
    songs.forEach((s) => {
      counts[s.unit] = (counts[s.unit] || 0) + 1;
    });
    return counts;
  }, [songs]);

  // 현재 선택된 유닛에 해당하는 곡 목록
  const filteredSongs = useMemo(
    () => songs.filter((s) => selectedUnits.has(s.unit)),
    [songs, selectedUnits]
  );

  // 설정된 목표 문제 수 계산
  const targetQuestionCount = useMemo(() => {
    if (countPreset !== "custom") return countPreset;
    const n = parseInt(customCountInput, 10);
    if (Number.isNaN(n) || n < 1) return 1;
    return Math.min(100, n);
  }, [countPreset, customCountInput]);

  // 무작위 시작 위치(초) 뽑기
  const pickRandomStart = (song: SongItem, durationSec?: number) => {
    const minS = song.startMin || 15;
    const maxS =
      song.endMax > minS + 5
        ? song.endMax
        : durationSec && durationSec > minS + 20
        ? Math.floor(durationSec - 15)
        : 95;
    return minS + Math.floor(Math.random() * Math.max(1, maxS - minS));
  };

  const clearTimers = () => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (loadWatchdogRef.current !== null) {
      window.clearTimeout(loadWatchdogRef.current);
      loadWatchdogRef.current = null;
    }
  };

  const stopPlayerSafely = () => {
    clearTimers();
    pendingPlayRef.current = false;
    setIsPlayingAudio(false);
    setLoadingAudio(false);
    try {
      playerRef.current?.pauseVideo?.();
    } catch {
      /* ignore */
    }
  };

  // 언마운트 시 플레이어 정리
  useEffect(() => {
    return () => {
      clearTimers();
      if (wrongTimerRef.current !== null) window.clearTimeout(wrongTimerRef.current);
      try {
        playerRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
      playerReadyRef.current = false;
    };
  }, []);

  // 플레이어를 만들거나(첫 실행) 이미 있으면 해당 영상을 재생
  const ensurePlayerAndPlay = async (videoId: string, targetStart: number, durSec: number) => {
    const reqId = ++playReqRef.current; // 연속으로 눌러도 가장 마지막 요청만 실행
    listenCountedRef.current = false; // 이 요청에서 실제로 재생이 시작되면 한 번만 횟수에 더함
    clearTimers();
    setPlayerError(false);
    clipDurationRef.current = durSec;
    startSecRef.current = targetStart;
    pendingPlayRef.current = true;
    activeVideoIdRef.current = videoId; // 플레이어가 아직 준비 중이어도 onReady에서 이 값을 사용
    setLoadingAudio(true);

    loadWatchdogRef.current = window.setTimeout(() => {
      setLoadingAudio(false);
      // 8초가 지나도 플레이어가 준비되지 않으면 정리해서 다음 클릭 때 새로 만들 수 있게 함
      if (playerRef.current && !playerReadyRef.current) {
        try {
          playerRef.current.destroy?.();
        } catch {
          /* ignore */
        }
        playerRef.current = null;
        pendingPlayRef.current = false;
        setPlayerError(true);
      }
    }, 8000);

    let YT: any;
    try {
      YT = await loadYouTubeApi();
    } catch {
      if (reqId === playReqRef.current) {
        clearTimers();
        pendingPlayRef.current = false;
        setLoadingAudio(false);
        setPlayerError(true);
      }
      return;
    }
    if (reqId !== playReqRef.current) return; // 그사이 더 새로운 요청이 있었음
    if (!playerHostRef.current) {
      setLoadingAudio(false);
      return;
    }

    if (playerRef.current) {
      if (!playerReadyRef.current) return; // 만드는 중이면 onReady에서 처리
      try {
        if (loadedVideoIdRef.current !== videoId) {
          loadedVideoIdRef.current = videoId;
          playerRef.current.loadVideoById({ videoId, startSeconds: targetStart });
        } else {
          playerRef.current.seekTo(targetStart, true);
          playerRef.current.playVideo();
        }
        return;
      } catch {
        try {
          playerRef.current.destroy?.();
        } catch {
          /* ignore */
        }
        playerRef.current = null;
        playerReadyRef.current = false;
      }
    }

    const el = document.createElement("div");
    playerHostRef.current.innerHTML = "";
    playerHostRef.current.appendChild(el);
    loadedVideoIdRef.current = videoId;

    playerRef.current = new YT.Player(el, {
      width: "100%",
      height: "100%",
      videoId,
      playerVars: {
        autoplay: 1,
        playsinline: 1,
        controls: 1,
        rel: 0,
        modestbranding: 1,
        origin: window.location.origin,
        start: Math.floor(targetStart)
      },
      events: {
        onReady: (event: any) => {
          playerReadyRef.current = true;
          if (!pendingPlayRef.current) return;
          try {
            const wanted = activeVideoIdRef.current;
            if (wanted && wanted !== loadedVideoIdRef.current) {
              loadedVideoIdRef.current = wanted;
              event.target.loadVideoById({ videoId: wanted, startSeconds: startSecRef.current });
            } else {
              event.target.seekTo(startSecRef.current, true);
              event.target.playVideo();
            }
          } catch {
            /* ignore */
          }
        },
        onStateChange: (event: any) => {
          if (event.data === 1) {
            if (pendingPlayRef.current && !listenCountedRef.current) {
              listenCountedRef.current = true;
              setListenCount((c) => c + 1);
            }
            if (loadWatchdogRef.current !== null) {
              window.clearTimeout(loadWatchdogRef.current);
              loadWatchdogRef.current = null;
            }
            setLoadingAudio(false);
            setIsPlayingAudio(true);
            setPlayerError(false);

            if (pendingPlayRef.current) {
              if (stopTimerRef.current !== null) {
                window.clearTimeout(stopTimerRef.current);
              }
              stopTimerRef.current = window.setTimeout(() => {
                try {
                  event.target?.pauseVideo?.();
                } catch {
                  /* ignore */
                }
                pendingPlayRef.current = false;
                setIsPlayingAudio(false);
              }, clipDurationRef.current * 1000);
            }
          } else if (event.data === 3) {
            if (stopTimerRef.current !== null) {
              window.clearTimeout(stopTimerRef.current);
              stopTimerRef.current = null;
            }
          } else if (event.data === 5) {
            if (pendingPlayRef.current) {
              try {
                event.target?.seekTo?.(startSecRef.current, true);
                event.target?.playVideo?.();
              } catch {
                /* ignore */
              }
            }
          } else if (event.data === 2 || event.data === 0) {
            if (!pendingPlayRef.current) {
              setIsPlayingAudio(false);
              setLoadingAudio(false);
            }
          }
        },
        onError: () => {
          clearTimers();
          pendingPlayRef.current = false;
          setIsPlayingAudio(false);
          setLoadingAudio(false);
          setPlayerError(true);
          if (!playerReadyRef.current) {
            try {
              playerRef.current?.destroy?.();
            } catch {
              /* ignore */
            }
            playerRef.current = null;
          }
        }
      }
    });
  };

  // 특정 문제 객체로 화면 상태 세팅
  const loadQuestionItem = (song: SongItem) => {
    stopPlayerSafely();
    setPlayerError(false);
    const initialStart = pickRandomStart(song);
    currentSongRef.current = song;
    setCurrentSong(song);
    setClipDuration(1);
    setStartSec(initialStart);
    setTries(0);
    setListenCount(0);
    setStatus("playing");
    setShowUnitHint(false);
    setGuess("");
    setShowSuggestions(false);
  };

  // 설정 화면에서 '퀴즈 시작하기' 클릭 시 문제 큐 생성 및 시작
  const handleStartQuiz = () => {
    if (filteredSongs.length === 0) {
      alert(t("quizNoSongsInFilter"));
      return;
    }
    const count = targetQuestionCount;
    const queue: SongItem[] = [];
    while (queue.length < count) {
      const batch = shuffleArray(filteredSongs);
      // 경계에서 같은 곡이 연속으로 나오지 않게 조정
      if (queue.length > 0 && batch.length > 1 && batch[0].id === queue[queue.length - 1].id) {
        const first = batch.shift()!;
        batch.push(first);
      }
      queue.push(...batch);
    }
    const finalQueue = queue.slice(0, count);
    // 선택 유닛 제한 여부는 시작 시점에 고정 (결과 통계의 비교군을 구분).
    const pool: QuizPool = filteredSongs.length === songs.length ? "all" : "filtered";
    runPoolRef.current = pool;
    setRunPool(pool);
    setPercentile(null);
    runIdRef.current = generateRoomId();
    completedRunRef.current = "";
    trackAnalyticsEvent("quiz_started", { difficulty: easyMode ? "easy" : "hard", question_count: count, pool_type: pool });
    setQuestionQueue(finalQueue);
    setQuestionIdx(0);
    setHistory([]);
    setPhase("playing");
    loadQuestionItem(finalQueue[0]);
  };

  // 다음 문제로 이동 또는 결과 화면으로 이동
  const handleNextOrFinish = () => {
    const nextIdx = questionIdx + 1;
    if (nextIdx >= questionQueue.length) {
      stopPlayerSafely();
      const runId = runIdRef.current;
      if (runId && completedRunRef.current !== runId && history.length === questionQueue.length) {
        completedRunRef.current = runId; // 더블 클릭·중복 이벤트 방지
        const summary = summarizeHistory(history, questionQueue.length);
        const mode = easyMode ? "easy" : "hard";
        const pool = runPoolRef.current;
        trackAnalyticsEvent("quiz_completed", {
          difficulty: mode, question_count: questionQueue.length,
          pool_type: pool, score: summary.score
        });
        // 저장 실패해도 퀴즈 화면이나 결과 이미지에는 영향이 없어야 함.
        void saveQuizCompletion({
          attemptId: runId, mode, questionCount: questionQueue.length, pool,
          score: summary.score, perfect: summary.perfect,
          otherCorrect: summary.otherCorrect, giveup: summary.giveup
        }).catch((err) => console.warn("퀴즈 익명 점수 저장 실패 (게임은 정상 진행):", err));
      }
      setPhase("summary");
    } else {
      setQuestionIdx(nextIdx);
      loadQuestionItem(questionQueue[nextIdx]);
    }
  };

  // 1초(또는 연장된 초) 재생 실행
  const playSnippet = (overrideSec?: number, overrideStart?: number, overrideSong?: SongItem) => {
    const targetSong = overrideSong ?? currentSong;
    if (!targetSong) return;

    const dur = overrideSec ?? clipDuration;
    let targetStart = overrideStart ?? startSec;

    try {
      if (
        playerRef.current &&
        playerReadyRef.current &&
        overrideStart === undefined &&
        loadedVideoIdRef.current === targetSong.videoId
      ) {
        const totalDur = Number(playerRef.current.getDuration?.() || 0);
        if (totalDur > 40 && targetStart >= totalDur - 10) {
          targetStart = pickRandomStart(targetSong, totalDur);
          setStartSec(targetStart);
        }
      }
    } catch {
      /* ignore */
    }

    ensurePlayerAndPlay(targetSong.videoId, targetStart, dur);
  };

  // +1초 늘리기 (최대 5초)
  const extendDuration = () => {
    const next = Math.min(5, clipDuration + 1);
    setClipDuration(next);
    playSnippet(next, startSec);
  };

  // 다른 1초 구간 뽑기
  const rerollSpot = () => {
    if (!currentSong) return;
    const totalDur =
      playerRef.current && playerReadyRef.current && loadedVideoIdRef.current === currentSong.videoId
        ? Number(playerRef.current?.getDuration?.() || 0)
        : 0;
    const nextStart = pickRandomStart(currentSong, totalDur > 0 ? totalDur : undefined);
    setStartSec(nextStart);
    playSnippet(clipDuration, nextStart);
  };

  // 정답 제출
  const handleGuessSubmit = (overrideGuess?: string) => {
    if (!currentSong || status !== "playing") return;
    const value = (overrideGuess ?? guess).trim();
    if (!value) return;

    const nextTries = tries + 1;
    setTries(nextTries);
    setShowSuggestions(false);

    if (isCorrectGuess(value, currentSong)) {
      clearTimers();
      pendingPlayRef.current = false;
      setIsPlayingAudio(false);
      setLoadingAudio(false);
      setStatus("correct");
      setHistory((prev) => [...prev, {
          song: currentSong,
          correct: true,
          tries: nextTries,
          clipSec: clipDuration,
          hint: showUnitHint,
          listens: listenCount,
          score: calcQuestionScore({
            correct: true,
            wrongCount: nextTries - 1,
            clipSec: clipDuration,
            hint: showUnitHint,
            listens: listenCount
          })
        }]);
    } else {
      setWrongShake(true);
      if (wrongTimerRef.current !== null) window.clearTimeout(wrongTimerRef.current);
      wrongTimerRef.current = window.setTimeout(() => setWrongShake(false), 400);
    }
  };

  // 포기 / 정답 보기
  const handleGiveUp = () => {
    if (!currentSong || status !== "playing") return;
    clearTimers();
    pendingPlayRef.current = false;
    setIsPlayingAudio(false);
    setLoadingAudio(false);
    setStatus("giveup");
    setHistory((prev) => [...prev, { song: currentSong, correct: false, tries, clipSec: clipDuration, hint: showUnitHint, score: 0, listens: listenCount }]);
  };

  // 초보자 모드용 자동완성 후보 목록 (입력 전에는 전체 곡, 입력하면 일치하는 곡만 / 정확히 일치 → 앞부분 일치 → 포함 순)
  const suggestions = useMemo(() => {
    if (!easyMode || status !== "playing") return [];
    const q = normalizeAnswer(guess);
    const pool = filteredSongs.length > 0 ? filteredSongs : songs;
    if (!q) {
      return [...pool]
        .sort((a, b) => primaryTitle(a, lang).localeCompare(primaryTitle(b, lang)))
        .slice(0, 60);
    }
    const scored: { s: SongItem; rank: number }[] = [];
    pool.forEach((s) => {
      let best = 99;
      getAcceptedAnswers(s).forEach((ans) => {
        const n = normalizeAnswer(ans);
        if (!n) return;
        if (n === q) best = Math.min(best, 0);
        else if (n.startsWith(q)) best = Math.min(best, 1);
        else if (n.includes(q)) best = Math.min(best, 2);
      });
      if (best < 99) scored.push({ s, rank: best });
    });
    return scored
      .sort((a, b) => a.rank - b.rank)
      .map((x) => x.s)
      .slice(0, 60);
  }, [easyMode, status, guess, filteredSongs, songs, lang]);

  // 현재 언어에 맞는 대표 곡 제목 표시 (중복 없는 다른 언어 제목 병기)
  const formatSongDisplay = (s: SongItem): string => {
    const primary = primaryTitle(s, lang);
    const others = Array.from(new Set([s.titleKo, s.titleEn, s.titleJa])).filter(
      (x) => x && x !== primary
    );
    return others.length > 0 ? `${primary} (${others.join(" / ")})` : primary;
  };

  // 셔플곡/퓨전곡/콜라보곡/솔로곡의 정답 공개 시 원래 유닛/가수 이름도 표시
  const formatFullUnitLabel = (s: SongItem): string => {
    const baseLabel = unitNameMap[s.unit] || s.unit;
    if ((s.unit === SHUFFLE_UNIT_ID || s.unit === FUSION_UNIT_ID || s.unit === COLLAB_UNIT_ID || s.unit === SOLO_UNIT_ID) &&
        s.rawUnit && !["셔플곡", "셔플 유닛", "shuffle", "퓨전곡", "fusion", "fusion unit", "콜라보곡", "콜라보", "collab", "collaboration", "솔로곡", "solo", "solo song"].includes(s.rawUnit.toLowerCase())) {
      return `${baseLabel} (${s.rawUnit})`;
    }
    return baseLabel;
  };

  // 후보를 골라 바로 제출
  const submitSuggestion = (s: SongItem) => {
    const title = primaryTitle(s, lang);
    setGuess(title);
    handleGuessSubmit(title);
  };

  // 입력칸 키 동작: ↑↓ 후보 이동 · Enter 제출 · Esc 목록 닫기
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const list = easyMode && showSuggestions ? suggestions : [];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!easyMode) return;
      e.preventDefault();
      if (!showSuggestions) {
        setShowSuggestions(true);
        return;
      }
      if (list.length === 0) return;
      setActiveIdx((i) => (e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length));
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (list.length > 0 && list[activeIdx]) submitSuggestion(list[activeIdx]);
      else handleGuessSubmit();
    }
  };

  // 유닛 토글
  const toggleUnit = (unitId: string) => {
    setSelectedUnits((prev) => {
      const next = new Set(Array.from(prev));
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  const revealed = phase === "playing" && (status === "correct" || status === "giveup");
  const correctTotal = useMemo(() => history.filter((h) => h.correct).length, [history]);
  const accuracyPercent =
    questionQueue.length > 0 ? Math.round((correctTotal / questionQueue.length) * 100) : 0;
  const scoreSummary = useMemo(() => summarizeHistory(history, questionQueue.length), [history, questionQueue.length]);
  const totalScore = scoreSummary.score;

  // 배포된 분포 JSON이 활성화되기 전까지는 아무것도 표시하지 않음.
  useEffect(() => {
    if (phase !== "summary") return;
    let cancelled = false;
    void loadQuizPercentileData().then((data) => {
      if (cancelled) return;
      setPercentile(calculateQuizPercentile(
        data, easyMode ? "easy" : "hard", questionQueue.length, runPool, totalScore
      ));
    });
    return () => { cancelled = true; };
  }, [phase, easyMode, questionQueue.length, runPool, totalScore]);

  // ───────── 결과 공유 (이미지 저장 · X 글쓰기 · 링크 복사) ─────────
  const [challenge, setChallenge] = useState<QuizResultInfo | null>(() => parseQuizChallenge(window.location.hash));
  const [sharePreview, setSharePreview] = useState<{ src: string; blob: Blob; name: string } | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  // 결과 화면이 열릴 때마다 목록은 접힌 상태로 시작
  useEffect(() => {
    if (phase === "summary") setShowAllHistory(false);
  }, [phase]);

  // 기록은 점수 높은 순(같으면 먼저 푼 순)으로 보여 줌. 번호는 원래 문제 번호 그대로
  const rankedHistory = useMemo(
    () => history.map((item, idx) => ({ item, idx })).sort((a, b) => b.item.score - a.item.score || a.idx - b.idx),
    [history]
  );
  const visibleHistory = showAllHistory ? rankedHistory : rankedHistory.slice(0, HISTORY_TOP_N);
  const hiddenHistoryCount = Math.max(0, rankedHistory.length - HISTORY_TOP_N);

  // 지금까지 연속으로 맞힌 문제 수 (정답 직후 연출용)
  let streak = 0;
  for (let i = history.length - 1; i >= 0 && history[i].correct; i--) streak += 1;
  const resultBlobRef = useRef<Blob | null>(null); // 결과 화면이 뜨면 미리 만들어 둠 (공유 창은 클릭 직후에 열어야 해서)

  // 공유 링크로 들어왔다면 친구 기록은 화면에 안내만 하고 주소에서는 지움 (이 주소를 다시 공유해도 남의 기록이 따라가지 않게)
  useEffect(() => {
    if (parseQuizChallenge(window.location.hash)) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search + "#/quiz");
    }
  }, []);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  // 결과 화면이 뜨면 이미지를 미리 그려 둠
  useEffect(() => {
    if (phase !== "summary") {
      resultBlobRef.current = null;
      return;
    }
    let cancelled = false;
    renderQuizResultBlob(buildResultCardText(tRef.current, correctTotal, questionQueue.length, easyMode, accuracyPercent, totalScore, rankedHistory, lang))
      .then((b) => {
        if (!cancelled) resultBlobRef.current = b;
      })
      .catch(() => {
        /* 저장 버튼을 누를 때 다시 시도 */
      });
    return () => {
      cancelled = true;
    };
  }, [phase, questionQueue.length, correctTotal, accuracyPercent, totalScore, easyMode, lang, rankedHistory]);

  const shareUrl = buildQuizShareUrl({ correct: correctTotal, total: questionQueue.length, easy: easyMode, score: totalScore });
  const tweetText = t("quizShareTweetText", {
    title: t("quizTitle"),
    mode: easyMode ? t("quizModeEasyShort") : t("quizModeHardShort"),
    total: questionQueue.length,
    correct: correctTotal,
    percent: accuracyPercent,
    score: totalScore
  });
  const tweetUrl = buildTweetIntentUrl({ text: tweetText, url: shareUrl, hashtags: QUIZ_SHARE_HASHTAGS });
  const canNativeShare =
    phase === "summary" &&
    typeof navigator.canShare === "function" &&
    (() => {
      try {
        return navigator.canShare({ files: [new File([new Blob()], "x.png", { type: "image/png" })] });
      } catch {
        return false;
      }
    })();

  const makeResultBlob = async (): Promise<Blob> => {
    if (resultBlobRef.current) return resultBlobRef.current;
    const b = await renderQuizResultBlob(
      buildResultCardText(t, correctTotal, questionQueue.length, easyMode, accuracyPercent, totalScore, rankedHistory, lang)
    );
    resultBlobRef.current = b;
    return b;
  };

  // 결과 이미지 저장 (앱 안 브라우저처럼 다운로드가 막힌 곳이면 미리보기 창)
  const handleSaveResultImage = async () => {
    if (shareBusy) return;
    setShareBusy(true);
    try {
      const blob = await withTimeout(makeResultBlob(), 15000);
      const name = "song-quiz-result.png";
      if (!IN_APP_BROWSER.test(navigator.userAgent) && triggerDownload(blob, name)) return;
      setSharePreview({ src: await blobToDataUrl(blob), blob, name });
    } catch {
      alert(t("quizShareImageFail"));
    } finally {
      setShareBusy(false);
    }
  };

  const handleCopyLink = async (notify = false) => {
    const ok = await copyText(shareUrl);
    if (!ok) {
      alert(t("quizShareCopyFail"));
      return;
    }
    if (notify) {
      alert(t("quizShareCopied"));
      return;
    }
    setCopied(true);
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
  };

  // 휴대폰의 공유 창으로 이미지와 글을 함께 보냄 (X 앱 등을 고를 수 있음)
  const shareFile = async (blob: Blob) => {
    try {
      await navigator.share({
        files: [new File([blob], "song-quiz-result.png", { type: "image/png" })],
        text: tweetText,
        url: shareUrl
      });
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") alert(t("quizShareFailed"));
    }
  };
  const handleNativeShare = async () => {
    if (resultBlobRef.current) {
      await shareFile(resultBlobRef.current);
      return;
    }
    setShareBusy(true);
    try {
      await shareFile(await makeResultBlob());
    } catch {
      alert(t("quizShareImageFail"));
    } finally {
      setShareBusy(false);
    }
  };

  const currentSongId = currentSong ? currentSong.id : "";

  // 후보가 바뀌면 맨 위 항목부터 선택
  useEffect(() => {
    setActiveIdx(0);
  }, [guess, easyMode, status, currentSongId]);

  // 방향키로 고른 항목이 목록 밖이면 스크롤
  useEffect(() => {
    if (!showSuggestions) return;
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, showSuggestions, suggestions]);

  // 새 문제가 시작되면 입력칸에 바로 포커스 (휴대폰은 키보드가 화면을 가리므로 제외)
  useEffect(() => {
    if (phase !== "playing" || status !== "playing" || !currentSongId) return;
    if (!window.matchMedia?.("(pointer: fine)").matches) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [phase, status, currentSongId]);

  // 정답/포기 후에는 '다음' 버튼에 포커스 → Enter로 바로 다음 문제
  useEffect(() => {
    if (revealed) nextBtnRef.current?.focus({ preventScroll: true });
  }, [revealed]);

  if (loadingCsv) {
    return <div className="sq-root sq-loading">{t("loadingData")}</div>;
  }

  const playing = phase === "playing" && !!currentSong;
  const progressPct =
    questionQueue.length > 0
      ? Math.round(((questionIdx + (revealed ? 1 : 0)) / questionQueue.length) * 100)
      : 0;
  const RING = 2 * Math.PI * 52;
  const listOpen = easyMode && showSuggestions && status === "playing";

  return (
    <div className="sq-root">
      <header className="sq-hero">
        <h1 className="sq-title">{t("quizTitle")}</h1>
        <p className="sq-subtitle">{t("quizSubtitle")}</p>
      </header>

      {/* ───────── 1. 설정 ───────── */}
      {phase === "setup" && (
        <section className="sq-card sq-setup">
          {challenge && (
            <div className="sq-challenge" role="note">
              <span>
                {t(challenge.score === undefined ? "quizChallengeBanner" : "quizChallengeBannerScore", {
                  mode: challenge.easy ? t("quizModeEasyShort") : t("quizModeHardShort"),
                  total: challenge.total,
                  correct: challenge.correct,
                  percent: Math.round((challenge.correct / challenge.total) * 100),
                  score: challenge.score === undefined ? 0 : challenge.score
                })}
              </span>
              <button type="button" className="sq-challenge-x" aria-label={t("close")} onClick={() => setChallenge(null)}>
                ×
              </button>
            </div>
          )}
          {csvError && <p className="sq-alert">{t("quizLoadFail")}</p>}

          <div className="sq-field">
            <h3 className="sq-label">{t("quizSetupModeTitle")}</h3>
            <div className="sq-seg">
              <button
                type="button"
                className={`sq-seg-btn${easyMode ? " is-on" : ""}`}
                aria-pressed={easyMode}
                onClick={() => setEasyMode(true)}
              >
                {t("quizEasyModeBtn")}
              </button>
              <button
                type="button"
                className={`sq-seg-btn${!easyMode ? " is-on" : ""}`}
                aria-pressed={!easyMode}
                onClick={() => setEasyMode(false)}
              >
                {t("quizHardModeBtn")}
              </button>
            </div>
            <p className="sq-note">{easyMode ? t("quizEasyHint") : t("quizHardHint")}</p>
          </div>

          <div className="sq-field">
            <h3 className="sq-label">{t("quizSetupCountTitle")}</h3>
            <div className="sq-seg">
              {([5, 10, 30] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`sq-seg-btn${countPreset === n ? " is-on" : ""}`}
                  aria-pressed={countPreset === n}
                  onClick={() => setCountPreset(n)}
                >
                  {t("quizCountPreset", { n })}
                </button>
              ))}
              <button
                type="button"
                className={`sq-seg-btn${countPreset === "custom" ? " is-on" : ""}`}
                aria-pressed={countPreset === "custom"}
                onClick={() => setCountPreset("custom")}
              >
                {t("quizCountCustom")}
              </button>
            </div>
            {countPreset === "custom" && (
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                className="sq-count-input"
                value={customCountInput}
                onChange={(e) => setCustomCountInput(e.target.value)}
                placeholder={t("quizCountCustomPlaceholder")}
              />
            )}
          </div>

          <div className="sq-field">
            <div className="sq-units-head">
              <h3 className="sq-label">
                {t("quizSetupUnitTitle", {
                  selected: selectedUnits.size,
                  total: allUnits.length,
                  songs: filteredSongs.length
                })}
              </h3>
              <div className="sq-units-actions">
                <button
                  type="button"
                  className="sq-link-btn"
                  onClick={() => setSelectedUnits(new Set(allUnits.map((u) => u.id)))}
                >
                  {t("quizSelectAllUnits")}
                </button>
                <button type="button" className="sq-link-btn" onClick={() => setSelectedUnits(new Set())}>
                  {t("quizClearUnits")}
                </button>
              </div>
            </div>
            <div className="sq-unit-groups">
              {quizAgencies.filter((agency) => agency.groups.length > 0).map((agency) => (
                <section key={agency.id} className="sq-unit-group" aria-label={agency.name}>
                  <h4 className="sq-unit-group-title">{agency.name}</h4>
                  <div className="sq-chips">
                    {agency.groups.map((unit) => {
                      const on = selectedUnits.has(unit.id);
                      return (
                        <button
                          key={unit.id}
                          type="button"
                          className={`sq-chip${on ? " is-on" : ""}`}
                          aria-pressed={on}
                          onClick={() => toggleUnit(unit.id)}
                        >
                          {unit.name} <small>{songCountByUnit[unit.id] || 0}</small>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {otherQuizUnits.length > 0 && (
                <section className="sq-unit-group sq-unit-group--other" aria-label={t("quizOtherSongGroup")}>
                  <h4 className="sq-unit-group-title">{t("quizOtherSongGroup")}</h4>
                  <div className="sq-chips">
                    {otherQuizUnits.map((unit) => {
                      const on = selectedUnits.has(unit.id);
                      return (
                        <button
                          key={unit.id}
                          type="button"
                          className={`sq-chip${on ? " is-on" : ""}`}
                          aria-pressed={on}
                          onClick={() => toggleUnit(unit.id)}
                        >
                          {unit.name} <small>{songCountByUnit[unit.id] || 0}</small>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          </div>

          {filteredSongs.length === 0 && <p className="sq-alert">{t("quizNoSongsInFilter")}</p>}

          <button
            type="button"
            className="sq-start"
            disabled={filteredSongs.length === 0}
            onClick={handleStartQuiz}
          >
            {t("quizStartBtn", { n: targetQuestionCount })}
          </button>
          <p className="sq-share-note">{t("quizStatsCollectionNotice")}</p>
        </section>
      )}

      {/* ───────── 2. 문제 풀이 (플레이어는 항상 마운트 유지) ───────── */}
      <section className={playing ? "sq-card sq-play" : "sq-play-idle"} ref={quizCardRef}>
        {playing && currentSong && (
          <div className="sq-top">
            <div className="sq-progress">
              <div className="sq-progress-text">
                <b>{t("quizProgress", { cur: questionIdx + 1, total: questionQueue.length })}</b>
                <span className="sq-score">{t("quizScoreCurrent", { correct: correctTotal, answered: history.length })}</span>
              </div>
              <div className="sq-bar" aria-hidden="true">
                <i style={{ width: `${progressPct}%` }} />
              </div>
            </div>
            <button
              type="button"
              className="sq-ghost"
              onClick={() => {
                stopPlayerSafely();
                setPhase("setup");
              }}
            >
              {t("quizBackToSetup")}
            </button>
          </div>
        )}

        {/* 정답/포기 후에만 크게 보이는 영상 */}
        <div className={`sq-video${revealed ? " is-on" : ""}`}>
          <div className="sq-video-frame">
            <div ref={playerHostRef} />
          </div>
        </div>

        {playing && currentSong && !revealed && (
          <div className="sq-stage">
            <div className="sq-listen">
              <button
                type="button"
                className={`sq-play-btn${isPlayingAudio ? " is-playing" : ""}`}
                disabled={loadingAudio}
                onClick={() => playSnippet()}
              >
                {loadingAudio
                  ? t("quizLoadingAudio")
                  : isPlayingAudio
                  ? t("quizPlaying")
                  : t("quizPlayClip", { sec: clipDuration })}
              </button>
              <div className="sq-tools">
                {clipDuration < 5 && (
                  <button type="button" className="sq-pill" onClick={extendDuration}>
                    {t("quizExtendSec", { sec: clipDuration + 1 })}
                  </button>
                )}
                <button type="button" className="sq-pill" onClick={rerollSpot}>
                  {t("quizChangeSpot")}
                </button>
                {!showUnitHint && (
                  <button type="button" className="sq-pill" onClick={() => setShowUnitHint(true)}>
                    {t("quizShowUnitHint")}
                  </button>
                )}
              </div>
              {showUnitHint && (
                <p className="sq-hint-banner">
                  {t("quizUnitHintText", { unit: unitNameMap[currentSong.unit] || currentSong.unit })}
                </p>
              )}
              {playerError && <p className="sq-alert">{t("quizPlayerError")}</p>}
            </div>

            <div className="sq-answer">
              <div className={`sq-input-row${wrongShake ? " shake" : ""}`}>
                <div className="sq-combo">
                  <input
                    ref={inputRef}
                    type="text"
                    className="sq-input"
                    value={guess}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="send"
                    role={easyMode ? "combobox" : undefined}
                    aria-expanded={easyMode ? listOpen : undefined}
                    aria-controls={easyMode ? "sq-suggest" : undefined}
                    aria-autocomplete={easyMode ? "list" : undefined}
                    aria-activedescendant={listOpen && suggestions[activeIdx] ? `sq-opt-${activeIdx}` : undefined}
                    onChange={(e) => {
                      setGuess(e.target.value);
                      setShowSuggestions(true);
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setShowSuggestions(false)}
                    onKeyDown={onInputKeyDown}
                    placeholder={t("quizInputPlaceholder")}
                  />
                  {listOpen && (
                    <ul id="sq-suggest" ref={listRef} role="listbox" className="sq-suggest" aria-label={t("quizSuggestionsLabel")}>
                      {suggestions.length === 0 ? (
                        <li className="sq-suggest-empty">{t("quizNoMatch")}</li>
                      ) : (
                        suggestions.map((s, i) => (
                          <li
                            key={s.id}
                            id={`sq-opt-${i}`}
                            role="option"
                            aria-selected={i === activeIdx}
                            className={i === activeIdx ? "is-active" : ""}
                            onMouseEnter={() => setActiveIdx(i)}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => submitSuggestion(s)}
                          >
                            <span className="sq-sug-unit">{unitNameMap[s.unit] || s.unit}</span>
                            <span className="sq-sug-title">{formatSongDisplay(s)}</span>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>
                <button type="button" className="sq-submit" onClick={() => handleGuessSubmit()}>
                  {t("quizSubmitBtn")}
                </button>
              </div>
              {easyMode && <p className="sq-keyhint">{t("quizKeyHint")}</p>}
              {tries > 0 && (
                <p className="sq-wrong" role="status">
                  {t("quizWrongMsg", { tries })}
                </p>
              )}
              <button type="button" className="sq-giveup" onClick={handleGiveUp}>
                {t("quizGiveUpBtn")}
              </button>
            </div>
          </div>
        )}

        {playing && currentSong && revealed && (
          <div className={`sq-result ${status}`} role="status" aria-live="polite">
            {status === "correct" ? (
              <>
                <div className="sq-confetti" aria-hidden="true">
                  {CONFETTI.map((c, i) => (
                    <i
                      key={i}
                      style={
                        {
                          "--dx": `${c.dx}px`,
                          "--up": `${c.up}px`,
                          "--rot": `${c.rot}deg`,
                          "--c": c.c,
                          "--d": `${c.d}s`
                        } as React.CSSProperties
                      }
                    />
                  ))}
                </div>
                <div className="sq-check" aria-hidden="true">
                  ✓
                </div>
                <h3 className="sq-result-title">{t("quizCorrectClean")}</h3>
                {streak >= 2 && <p className="sq-streak">{t("quizStreak", { n: streak })}</p>}
              </>
            ) : (
              <>
                <h3 className="sq-result-title is-muted">{t("quizGiveUpMsg")}</h3>
                <p className="sq-answer-title">{formatSongDisplay(currentSong)}</p>
                <p className="sq-answer-unit">{formatFullUnitLabel(currentSong)}</p>
              </>
            )}
            <button ref={nextBtnRef} type="button" className="sq-next" onClick={handleNextOrFinish}>
              {questionIdx + 1 >= questionQueue.length
                ? t("quizFinishBtn")
                : t("quizNextBtn", { next: questionIdx + 2, total: questionQueue.length })}
              <span className="sq-kbd">Enter ↵</span>
            </button>
          </div>
        )}
      </section>

      {/* ───────── 3. 결과 ───────── */}
      {phase === "summary" && (
        <section className="sq-card sq-summary">
          <h2 className="sq-sum-title">{t("quizSummaryTitle")}</h2>
          <div className="sq-ring-wrap">
            <svg viewBox="0 0 120 120" className="sq-ring" aria-hidden="true">
              <circle className="sq-ring-bg" cx="60" cy="60" r="52" />
              <circle
                className="sq-ring-fg"
                cx="60"
                cy="60"
                r="52"
                strokeDasharray={`${(RING * accuracyPercent) / 100} ${RING}`}
                transform="rotate(-90 60 60)"
              />
            </svg>
            <div className="sq-ring-text">
              <b>{accuracyPercent}%</b>
              <span>{t("quizSummaryRateLabel")}</span>
            </div>
          </div>
          <p className="sq-sum-detail">
            {t("quizSummaryScoreDetail", { total: questionQueue.length, correct: correctTotal })}
          </p>

          <div className="sq-score-box">
            <div className="sq-score-main">
              <span className="sq-score-label">{t("quizScoreLabel")}</span>
              <b>{totalScore}</b>
              <span className="sq-score-unit">{t("quizScoreUnit")}</span>
            </div>
            <ul className="sq-breakdown">
              <li>
                <b>{scoreSummary.perfect}</b>
                <span>{t("quizBreakdownPerfect")}</span>
              </li>
              <li>
                <b>{scoreSummary.otherCorrect}</b>
                <span>{t("quizBreakdownOther")}</span>
              </li>
              <li>
                <b>{scoreSummary.giveup}</b>
                <span>{t("quizBreakdownGiveup")}</span>
              </li>
            </ul>
          </div>

          {percentile && (
            <p className="sq-percentile" role="status">
              {t("quizTopPercentile", { percent: percentile.topPercent, samples: percentile.samples })}
            </p>
          )}

          <h3 className="sq-label sq-hist-head">
            {t("quizSummaryHistoryTitle")}
            <small className="sq-hist-sort">{t("quizHistorySortNote")}</small>
          </h3>
          <ul className="sq-history" id="sq-history-list">
            {visibleHistory.map(({ item, idx }) => (
              <li key={`${item.song.id}-${idx}`} className={item.correct ? "ok" : "fail"}>
                <span className="sq-hist-num">{idx + 1}</span>
                <div className="sq-hist-info">
                  <div className="sq-hist-title">{formatSongDisplay(item.song)}</div>
                  <div className="sq-hist-unit">
                    {formatFullUnitLabel(item.song)}
                    {item.correct &&
                      ` · ${t("quizSongMeta", { sec: item.clipSec, listens: item.listens, tries: item.tries })}`}
                  </div>
                </div>
                <div className="sq-hist-right">
                  <span className={`sq-badge ${item.correct ? "ok" : "fail"}`}>
                    {item.correct ? t("quizSummaryBadgeCorrect", { tries: item.tries }) : t("quizSummaryBadgeGiveup")}
                  </span>
                  <span className="sq-hist-score">
                    {item.score}
                    {t("quizScoreUnit")}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {hiddenHistoryCount > 0 && (
            <button
              type="button"
              className={`sq-history-toggle${showAllHistory ? " is-open" : ""}`}
              aria-expanded={showAllHistory}
              aria-controls="sq-history-list"
              onClick={() => setShowAllHistory((v) => !v)}
            >
              {showAllHistory ? t("quizHistoryLess") : t("quizHistoryMore", { n: hiddenHistoryCount })}
              <span className="chev" aria-hidden="true">
                ▾
              </span>
            </button>
          )}

          <div className="sq-share">
            <h3 className="sq-label">{t("quizShareHeading")}</h3>
            <div className="sq-share-grid">
              <a className="sq-share-btn sq-share-x" href={tweetUrl} target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
                </svg>
                {t("quizShareX")}
              </a>
              <button type="button" className="sq-share-btn" disabled={shareBusy} onClick={handleSaveResultImage}>
                {t("quizShareSaveImage")}
              </button>
              <button type="button" className="sq-share-btn" onClick={() => handleCopyLink()}>
                {copied ? t("quizShareCopied") : t("quizShareCopyLink")}
              </button>
              {canNativeShare && (
                <button type="button" className="sq-share-btn sq-share-wide" disabled={shareBusy} onClick={handleNativeShare}>
                  {t("quizShareNative")}
                </button>
              )}
            </div>
            <p className="sq-share-note">{t("quizShareImageHint")}</p>
          </div>

          <div className="sq-actions">
            <button type="button" className="sq-start" onClick={handleStartQuiz}>
              {t("quizRetrySameBtn")}
            </button>
            <button type="button" className="sq-secondary" onClick={() => setPhase("setup")}>
              {t("quizRetrySetupBtn")}
            </button>
          </div>
        </section>
      )}

      {sharePreview && (
        <ImagePreviewModal
          preview={sharePreview}
          t={t}
          onClose={() => setSharePreview(null)}
          onShare={() => shareFile(sharePreview.blob)}
          onCopyUrl={() => handleCopyLink(true)}
        />
      )}

    </div>
  );
}
