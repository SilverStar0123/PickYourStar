#!/usr/bin/env python3
"""퀴즈 점수 수집 후 수동 집계.

사용법 (로컬 PC에서만; 서비스 계정 비밀키는 절대 GitHub에 올리지 마세요):
    pip install firebase-admin
    python scripts/generate_quiz_percentiles.py --credentials /secure/path/serviceAccount.json --enable

옵션 --enable 없이 실행하면 JSON의 enabled=false (방문자에게 백분위 비공개).
Firestore 컬렉션 전체를 읽으므로 읽기 요금/무료 할당량 사용.
"""
import argparse
import collections
import datetime
import json
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--credentials', required=True, help='절대로 GitHub에 올리지 않을 서비스 계정 JSON 경로')
    ap.add_argument('--enable', action='store_true', help='완성된 백분위를 사이트에서 공개')
    ap.add_argument('--min-samples', type=int, default=30, help='이보다 표본이 적으면 그룹은 공개하지 않음 (최소 30)')
    args = ap.parse_args()
    if args.min_samples < 30:
        ap.error('--min-samples must be >= 30')
    firebase_admin.initialize_app(credentials.Certificate(args.credentials))
    db = firestore.client()
    groups = collections.defaultdict(lambda: [0] * 101)
    total = 0
    for snap in db.collection('quizScores').stream():
        d = snap.to_dict() or {}
        mode, pool, count, score = (d.get(k) for k in ('mode','pool','questionCount','score'))
        if (mode not in ('easy','hard') or pool not in ('all','filtered')
                or type(count) is not int or not 1 <= count <= 100
                or type(score) is not int or not 0 <= score <= 100
                or d.get('v') != 1):
            continue
        groups[f'{mode}:{count}:{pool}'][score] += 1
        total += 1
    result = {
        'enabled': args.enable,
        'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'groups': {k: {'total': sum(v), 'counts': v}
                   for k,v in sorted(groups.items()) if sum(v) >= args.min_samples}
    }
    path = Path(__file__).resolve().parents[1] / 'public' / 'quiz-percentiles.json'
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(f'전체 {total:,}개의 유효한 기록을 분석했습니다. 공개 가능한 그룹 {len(result["groups"])}개. 파일: {path}')
    print('enabled =', result['enabled'])

if __name__ == '__main__':
    main()
