// Firestore 직접 조회 없이 정적 JSON만으로 백분위 계산. 초기 3~4일간은 비활성화 상태.
export interface QuizPercentile {
  topPercent: number;
  samples: number;
}

interface ScoreBucket { total: number; counts: number[] }
interface DataFile { enabled: boolean; groups: Record<string, ScoreBucket> }
let cached: Promise<DataFile | null> | null = null;

export function loadQuizPercentileData(): Promise<DataFile | null> {
  if (!cached) {
    const base = process.env.PUBLIC_URL || ".";
    const version = process.env.REACT_APP_CSV_VERSION || "local";
    cached = fetch(`${base}/quiz-percentiles.json?v=${encodeURIComponent(version)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`percentile data: HTTP ${r.status}`);
        return r.json();
      })
      .then((data: unknown) => {
        if (!data || typeof data !== "object") return null;
        const d = data as Partial<DataFile>;
        return d.enabled === true && d.groups && typeof d.groups === "object" ? (d as DataFile) : null;
      })
      .catch(() => null);
  }
  return cached;
}

export function calculateQuizPercentile(
  data: DataFile | null, mode: "easy" | "hard", questionCount: number,
  pool: "all" | "unit" | "filtered", score: number, clipMode: "random" | "start" = "random"
): QuizPercentile | null {
  // 필터별 곡 구성이 서로 다르므로 filtered 결과의 백분위는 표시하지 않음.
  // 점수 원본은 저장되어 이후 분석에 사용할 수 있음.
  if (!data?.enabled || pool !== "all") return null;
  // Legacy distribution files contain only random-mode scores.
  const bucket = data?.groups?.[`${clipMode}:${mode}:${questionCount}:${pool}`]
    ?? (clipMode === "random" ? data?.groups?.[`${mode}:${questionCount}:${pool}`] : undefined);
  if (!bucket || !Number.isInteger(bucket.total) || bucket.total < 30 ||
      !Array.isArray(bucket.counts) || bucket.counts.length !== 101 ||
      !bucket.counts.every((v) => Number.isInteger(v) && v >= 0) ||
      bucket.counts.reduce((a, b) => a + b, 0) !== bucket.total ||
      !Number.isInteger(score) || score < 0 || score > 100) return null;
  // 최저 점수 0점은 상위 100%로 표시. 그 외 동점자는 중간 순위 사용.
  if (score === 0) return { topPercent: 100, samples: bucket.total };
  const higher = bucket.counts.slice(score + 1).reduce((a, b) => a + b, 0);
  const topPercent = Math.max(0, Math.min(100, Math.round((higher + bucket.counts[score] / 2) / bucket.total * 1000) / 10));
  return { topPercent, samples: bucket.total };
}
