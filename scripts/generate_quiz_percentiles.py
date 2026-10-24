#!/usr/bin/env python3
"""Firestore quizScores를 읽어 백분위용 JSON을 만듭니다.

최초 공개 전에는 --enable 없이 실행하세요.
서비스 계정 비밀키를 GitHub 저장소에 넣지 마세요.
같은 익명 UID의 반복 게임이 백분위에 과도하게 영향을 주지 않도록
같은 UTC 날짜 + 같은 비교 그룹에서 사용자당 기본 5판만 반영합니다.
이 필터는 간단한 오염 완화책이지 부정 점수를 완벽히 방지하지는 못합니다.
"""
import argparse
import collections
import datetime
import json
from pathlib import Path


def valid_score_record(d):
    """현재 quizScores 문서 스키마와 점수 범위가 일치하는지 검증."""
    mode, pool, count, score = (d.get(k) for k in ('mode', 'pool', 'questionCount', 'score'))
    perfect, other, giveup = (d.get(k) for k in ('perfect', 'otherCorrect', 'giveup'))
    if (mode not in ('easy', 'hard') or pool not in ('all', 'filtered') or
            type(count) is not int or not 1 <= count <= 100 or
            type(score) is not int or not 0 <= score <= 100 or
            d.get('v') != 1 or
            any(type(x) is not int or x < 0 or x > count for x in (perfect, other, giveup)) or
            perfect + other + giveup != count):
        return False
    correct = perfect + other
    # 정답 10~100점, 포기 0점이며 평균은 소수점 반올림됨.
    return (2 * score * count <= 200 * correct + count and
            2 * score * count >= 20 * correct - count)


def build_groups(records, max_per_user_day=5):
    """Firestore 데이터에서 점수 분포를 계산하고 제외 건수를 반환."""
    groups = collections.defaultdict(lambda: [0] * 101)
    daily_counts = collections.Counter()
    accepted, excluded = 0, 0
    # 필드 형식이 불완전한 문서는 먼저 제외해 정렬 단계에서 오류가 나지 않게 함.
    candidates = []
    for d in records:
        uid = d.get('uid')
        completed_at = d.get('completedAt')
        if (not valid_score_record(d) or not isinstance(uid, str) or not uid
                or not isinstance(completed_at, datetime.datetime)
                or completed_at.tzinfo is None):
            excluded += 1
            continue
        candidates.append(d)
    # 한 사용자의 같은 날·같은 비교군 중 앞선 N판만 반영.
    for d in sorted(candidates, key=lambda d: d['completedAt'].astimezone(datetime.timezone.utc)):
        uid = d['uid']
        completed_at = d['completedAt']
        day = completed_at.astimezone(datetime.timezone.utc).strftime('%Y-%m-%d')
        group = f'{d["mode"]}:{d["questionCount"]}:{d["pool"]}'
        key = (uid, day, group)
        if max_per_user_day > 0 and daily_counts[key] >= max_per_user_day:
            excluded += 1
            continue
        daily_counts[key] += 1
        groups[group][d['score']] += 1
        accepted += 1
    return groups, accepted, excluded


def main():
    # 로컬 실행 시에만 Admin SDK 로드. 테스트에는 비밀키나 Firebase 연결이 필요 없음.
    import firebase_admin
    from firebase_admin import credentials, firestore

    ap = argparse.ArgumentParser()
    ap.add_argument('--credentials', required=True, help='GitHub에 올리지 않을 서비스 계정 JSON 경로')
    ap.add_argument('--enable', action='store_true', help='백분위를 사이트에 공개')
    ap.add_argument('--min-samples', type=int, default=30, help='그룹별 최소 기록 수 (최소 30)')
    ap.add_argument('--max-per-user-day', type=int, default=5,
                    help='같은 사용자/UTC 날짜/그룹에서 백분위에 반영할 최대 게임 수 (0=제한 없음)')
    args = ap.parse_args()
    if args.min_samples < 30:
        ap.error('--min-samples must be >= 30')
    if args.max_per_user_day < 0:
        ap.error('--max-per-user-day must be >= 0')

    firebase_admin.initialize_app(credentials.Certificate(args.credentials))
    db = firestore.client()
    records = [snap.to_dict() or {} for snap in db.collection('quizScores').stream()]
    groups, accepted, excluded = build_groups(records, max_per_user_day=args.max_per_user_day)
    result = {
        'enabled': args.enable,
        'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'groups': {k: {'total': sum(v), 'counts': v}
                   for k, v in sorted(groups.items()) if sum(v) >= args.min_samples}
    }
    path = Path(__file__).resolve().parents[1] / 'public' / 'quiz-percentiles.json'
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'읽은 문서: {len(records):,} / 반영: {accepted:,} / 제외: {excluded:,}')
    print(f'공개 가능 그룹: {len(result["groups"])}개 / 결과 파일: {path}')
    print('enabled =', result['enabled'])


if __name__ == '__main__':
    main()
