import datetime
import unittest
from generate_quiz_percentiles import build_groups, valid_score_record

T = datetime.datetime(2026, 10, 24, 12, 0, tzinfo=datetime.timezone.utc)

def r(uid='alice', score=100, perfect=10, otherCorrect=0, giveup=0, mode='hard', questionCount=10, completedAt=T):
    return dict(uid=uid, mode=mode, questionCount=questionCount, pool='all', score=score,
                perfect=perfect, otherCorrect=otherCorrect, giveup=giveup,
                completedAt=completedAt, v=1)

class TestStats(unittest.TestCase):
    def test_valid_perfect(self):
        self.assertTrue(valid_score_record(r()))

    def test_mismatched_count_rejected(self):
        self.assertFalse(valid_score_record(r(perfect=9)))

    def test_impossible_score_rejected(self):
        self.assertFalse(valid_score_record(r(score=100, perfect=0, otherCorrect=0, giveup=10)))

    def test_invalid_score(self):
        self.assertFalse(valid_score_record(r(score=101)))

    def test_repeated_day_limit(self):
        g, a, e = build_groups([r() for _ in range(9)] + [r(uid='bob')])
        self.assertEqual((a, e), (6, 4))
        self.assertEqual(g['hard:10:all'][100], 6)

    def test_other_day_independent(self):
        next_day = T + datetime.timedelta(days=1)
        g, a, e = build_groups([r() for _ in range(5)] + [r(completedAt=next_day) for _ in range(5)])
        self.assertEqual((a, e), (10, 0))

    def test_other_group_independent(self):
        g, a, e = build_groups([r() for _ in range(5)] + [r(mode='easy') for _ in range(5)])
        self.assertEqual((a, e), (10, 0))

if __name__ == '__main__':
    unittest.main()
