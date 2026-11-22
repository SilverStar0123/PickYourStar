"""Offline CSV/JSON -> separate random/start score distributions. No Firebase access."""
import argparse
import collections
import datetime
import json
import csv
from pathlib import Path

def valid_score_record(d):
    """현재 quizScores 문서 스키마와 점수 범위가 일치하는지 검증."""
    mode, pool, count, score = (d.get(k) for k in ('mode', 'pool', 'questionCount', 'score'))
    perfect, other, giveup = (d.get(k) for k in ('perfect', 'otherCorrect', 'giveup'))
    if (mode not in ('easy', 'hard') or pool not in ('all', 'filtered', 'unit') or
            type(count) is not int or not 1 <= count <= 100 or
            type(score) is not int or not 0 <= score <= 100 or
            d.get('v') not in (1, 2, 3) or
            any(type(x) is not int or x < 0 or x > count for x in (perfect, other, giveup)) or
            perfect + other + giveup != count):
        return False
    clip = d.get('clipMode')
    if (d.get('v') == 1 and clip is not None) or (d.get('v') in (2, 3) and clip not in ('random', 'start')):
        return False
    if d.get('v') == 3:
        if pool not in ('all', 'unit'):
            return False
        if pool == 'unit' and (not isinstance(d.get('unitId'), str) or not d['unitId'].strip()):
            return False
    elif pool == 'unit':
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
        group = f'{d.get("clipMode") or "random"}:{d["mode"]}:{d["questionCount"]}:{d["pool"]}'
        if d['pool'] == 'unit':
            group += ':' + d['unitId']
        key = (uid, day, group)
        if max_per_user_day > 0 and daily_counts[key] >= max_per_user_day:
            excluded += 1
            continue
        daily_counts[key] += 1
        groups[group][d['score']] += 1
        accepted += 1
    return groups, accepted, excluded


def generate(input_path, output_path, min_samples=30):
    path = Path(input_path)
    if path.suffix.lower() == '.csv':
        with path.open(encoding='utf-8-sig', newline='') as f:
            rows = list(csv.DictReader(f))
    else:
        with path.open(encoding='utf-8-sig') as f:
            exported = json.load(f)
        rows = [dict(r.get('data') or {}, document_id=r['document_id']) for r in exported['records']]
    records, seen = [], set()
    for raw in rows:
        d = dict(raw)
        identity = d.get('document_id')
        if identity:
            if identity in seen: continue
            seen.add(identity)
        if d.get('clipMode') in ('', None): d.pop('clipMode', None)
        for key in ('v','questionCount','score','perfect','otherCorrect','giveup'):
            try:
                if isinstance(d.get(key), bool): continue
                value = float(d[key])
                if value.is_integer(): d[key] = int(value)
            except (ValueError, TypeError, KeyError, OverflowError): pass
        try:
            d['completedAt'] = datetime.datetime.fromisoformat(d['completedAt'].replace('Z', '+00:00'))
        except (ValueError, TypeError, KeyError, AttributeError): d['completedAt'] = None
        records.append(d)
    buckets, accepted, excluded = build_groups(records)
    groups = {key: {'total': sum(counts), 'counts': counts}
              for key, counts in sorted(buckets.items())
              if key.endswith(':all') and sum(counts) >= min_samples}
    result = {'schemaVersion': 2, 'enabled': bool(groups),
              'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'groups': groups}
    Path(output_path).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Read {len(rows)} records; accepted {accepted}; invalid/capped {excluded}; duplicate IDs {len(rows)-len(records)}')
    for key, counts in sorted(buckets.items()):
        print(key, sum(counts), 'published' if key in groups else 'not published')
    print('Saved:', output_path)
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', help='Exported score CSV or JSON')
    parser.add_argument('--output', default='quiz-percentiles.json')
    args = parser.parse_args()
    generate(args.input, args.output)
