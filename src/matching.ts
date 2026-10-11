// 참여자 간 일치율 계산: 같은 유닛에서 같은 멤버를 고른 개수 / 전체 유닛 수
export interface MatchResult {
  count: number;
  total: number;
}

export function computeMatches(
  basePicks: Record<string, string>,
  users: Record<string, { picks: Record<string, string> }>,
  groupIds: string[]
): Record<string, MatchResult> {
  const result: Record<string, MatchResult> = {};
  Object.entries(users).forEach(([id, u]) => {
    let count = 0;
    groupIds.forEach((gid) => {
      const a = basePicks[gid];
      if (a && a === u.picks[gid]) count++;
    });
    result[id] = { count, total: groupIds.length };
  });
  return result;
}
