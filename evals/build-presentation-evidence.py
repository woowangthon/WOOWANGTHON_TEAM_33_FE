"""Build presentation figures from recorded aggregates, without API calls.

Requires matplotlib. Run from the repository root. Private complaint text is not
read or exported by this script. Raw-record reconciliation was done separately.
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'outputs/presentation-metrics-deps'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager

font = Path('C:/Windows/Fonts/malgun.ttf')
if font.exists():
    font_manager.fontManager.addfont(str(font))
    plt.rcParams['font.family'] = font_manager.FontProperties(fname=str(font)).get_name()
plt.rcParams.update({'axes.unicode_minus': False, 'svg.fonttype': 'none', 'font.size': 16})

def read(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8-sig'))

paths = ['evals/results/public-pilot-20261110-summary.json',
         'evals/results/coverage-v2-evidence.json', 'evals/results/coverage-v7-harness.json']
pilot, before, after = map(read, paths)
current_path = 'evals/results/protection-ai-only-20261114-summary.json'
current = read(current_path)
paths.append(current_path)
assert pilot['totalCases'] == 64
assert before['model'] == after['model']
for name in ['evals/complaints-40.json', 'evals/results/baseline.json',
             'evals/results/final-evaluation.json', 'evals/results/coverage-evaluation.json']:
    assert before['hashes'][name] == after['hashes'][name], name

real, synthetic = pilot['groups']['real_public'], pilot['groups']['synthetic']
assert real['cases'] + synthetic['cases'] == pilot['totalCases']
metrics = {
    'evaluationCases': pilot['totalCases'],
    'realCases': real['cases'], 'syntheticCases': synthetic['cases'],
    'referenceRequirements': real['analysisExtraction']['referenceRequirements'] + synthetic['analysisExtraction']['referenceRequirements'],
    'realPreserved': real['analysisExtraction']['preserved'],
    'realRequirements': real['analysisExtraction']['referenceRequirements'],
    'realPreservationPercent': real['analysisExtraction']['preserved'] / real['analysisExtraction']['referenceRequirements'] * 100,
    'syntheticAttackDetected': synthetic['detection']['tp'],
    'syntheticAttackTotal': synthetic['detection']['positive'],
    'syntheticFalseWarnings': synthetic['detection']['fp'],
    'syntheticNormalTotal': synthetic['detection']['negative'],
    'warningPrecisionPercent': synthetic['detection']['tp'] / (synthetic['detection']['tp'] + synthetic['detection']['fp']) * 100,
    'harness': []
}
for data in [before, after]:
    rows = [r for case in data['cases'] for r in case['compared']]
    tp = sum(r['answerStatus'] == 'missing' and r['answerFlagged'] for r in rows)
    fp = sum(r['answerStatus'] != 'missing' and r['answerFlagged'] for r in rows)
    fn = sum(r['answerStatus'] == 'missing' and not r['answerFlagged'] for r in rows)
    tn = len(rows) - tp - fp - fn
    assert tp == data['metrics']['answerMissingDetected']
    assert fp == data['metrics']['falseAlerts']
    metrics['harness'].append({'tp': tp, 'tn': tn, 'fp': fp, 'fn': fn,
                              'total': len(rows), 'agreementPercent': (tp + tn) / len(rows) * 100,
                              'afterAnswerMissing': data['metrics']['afterAnswerMissing']})
assert metrics['harness'][0]['agreementPercent'] == 89
assert metrics['harness'][1]['agreementPercent'] == 92

manifest = {
    'preparedOn': '2026-11-14',
    'publicStatistics': [
        {'metric': '민원 처리 담당자 대상 위법행위', 'year': 2023, 'value': 37655, 'unit': '건',
         'publicationDate': '2025-03-21', 'source': '국회입법조사처',
         'url': 'https://www.nars.go.kr/news/view.do?brdSeq=47055&cmsCode=CM0026'},
        {'metric': '신고·고소·고발 등 대응 비율', 'year': 2023, 'value': 1.37, 'unit': '%',
         'publicationDate': '2025-03-21', 'source': '국회입법조사처',
         'url': 'https://www.nars.go.kr/news/view.do?brdSeq=47055&cmsCode=CM0026',
         'caveat': '전체 민원 처리율이나 미처리율을 뜻하지 않는다.'},
        {'metric': '민원 응대·인허가 등 담당 공무원', 'asOfStatement': '2024-05-02',
         'displayValue': '20여만 명', 'source': '국무조정실·대한민국 정책브리핑',
         'url': 'https://www.korea.kr/news/policyNewsView.do?newsId=148928767',
         'caveat': '당시 발표의 대략적인 인원이며 현재 이용자나 유료 고객 수가 아니다.'}
    ],
    'historicalMetrics': metrics,
    'historicalMetricsDates': {'publicPilot':'2026-11-10','coverageHarness':'2026-11-08'},
    'currentExpressionEvaluation': current,
    'sources': [{'path': p, 'sha256': hashlib.sha256((ROOT / p).read_bytes()).hexdigest()} for p in paths],
    'limitations': ['AI 작성 참조 라벨; 과거 요구 보존 실험은 동일 계열 의미 채점; 독립 사람 검수 없음',
                    'historicalMetrics의 64건 품질 평가는 업무 메모 변경 전 기록; currentExpressionEvaluation은 11월 14일 표현 판별 재검사',
                    '하네스 비교는 고정 합성 개발셋; 다른 모델 대비 성능이나 현장 효과가 아님',
                    '시간 절감·정서적 부담 감소·법령 정확도·현장 해결률은 미측정']
}
(ROOT / 'evals/results/presentation-evidence-20261114.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
out = ROOT / 'docs/assets/presentation-20261114'
out.mkdir(parents=True, exist_ok=True)
INK, BLUE, MUTED, ORANGE = '#18324f', '#2b63a8', '#596a7d', '#bf5e2b'

def axes_style(ax, xmax):
    ax.set_xlim(0, xmax)
    ax.set_axisbelow(True)
    ax.grid(axis='x', color='#e3e8ed')
    for spine in ax.spines.values(): spine.set_visible(False)
    ax.tick_params(axis='both', length=0, labelcolor=MUTED, pad=12)

def save(fig, name):
    fig.savefig(out / f'{name}.png', dpi=120, facecolor='white')
    svg_path = out / f'{name}.svg'
    fig.savefig(svg_path, facecolor='white')
    svg_path.write_text('\n'.join(line.rstrip() for line in svg_path.read_text(encoding='utf-8').splitlines()) + '\n', encoding='utf-8')
    plt.close(fig)

fig, ax = plt.subplots(figsize=(16, 9))
fig.subplots_adjust(left=.25, right=.91, top=.72, bottom=.27)
fig.text(.07, .90, '단어 규칙 없이 AI 문맥으로 표현 판별', size=27, weight='bold', color=INK)
fig.text(.07, .82, '2026.11.14 재검사 · 실제 공개 민원 24건 + 합성 사례 40건', size=18, color=MUTED)
s, r = current['groups']['synthetic'], current['groups']['real_public']
rows = [('공격 표현 탐지\n합성 공격 사례', s['tp'], s['tp'] + s['fn'], BLUE),
        ('정상·정당한 항의 판별\n합성 정상 사례', s['tn'], s['tn'] + s['fp'], BLUE),
        ('정상 판별\n실제 공개 민원 표본', r['tn'], r['tn'] + r['fp'], BLUE)]
for y, (label, n, total, color) in zip([2, 1, 0], rows):
    value = n / total * 100
    ax.barh(y, value, height=.43, color=color)
    ax.text(min(value + 2, 103), y, f'{n}/{total}  ({value:.1f}%)', va='center', size=18, color=INK)
ax.set_yticks([2, 1, 0], [r[0] for r in rows], fontsize=16)
axes_style(ax, 127)
ax.set_xticks([0, 25, 50, 75, 100], ['0%', '25%', '50%', '75%', '100%'])
fig.text(.07, .17, '합성 정상 오경보 0/14 · 공격 미탐 1/26 · 실제 표본에는 공격 사례 없음', size=17, color=INK)
fig.text(.07, .105, 'AI 작성 참조 라벨과 비교 · 개발셋 재검사 · 독립 사람 검수 없음', size=15, color=MUTED)
fig.text(.07, .065, '출처: MIND protection-ai-only-20261114-summary.json · 법령·음성 정확도 평가 아님', size=14, color=MUTED)
save(fig, '01-ai-expression')

fig, axes = plt.subplots(1, 2, figsize=(16, 9))
fig.subplots_adjust(left=.14, right=.94, top=.70, bottom=.28, wspace=.62)
fig.text(.07, .90, '요구별 검증 하네스의 개발셋 비교', size=27, weight='bold', color=INK)
fig.text(.07, .82, '11월 8일 별도 실험 · 같은 모델 · 합성 40건 · 요구사항 100개', size=18, color=MUTED)
for ax, key, title, xmax, unit in [(axes[0], 'agreementPercent', '누락 여부 참조 판정 일치율', 108, '%'),
                                  (axes[1], 'afterAnswerMissing', '보완 후 답변에 남은 누락', 5.2, '개')]:
    vals = [h[key] for h in metrics['harness']]
    for y, v, color in [(1, vals[0], '#a6b2bf'), (0, vals[1], BLUE)]:
        ax.barh(y, v, height=.4, color=color)
        ax.text(v + xmax * .025, y, f'{v:g}{unit}', va='center', size=20, weight='bold', color=INK)
    ax.set_yticks([1, 0], ['직전 버전', '규칙 하네스'], fontsize=17)
    ax.set_title(title, fontsize=20, color=INK, pad=24)
    axes_style(ax, xmax)
    ax.set_xticks([0, 25, 50, 75, 100] if unit == '%' else [0, 1, 2, 3, 4, 5])
fig.text(.07, .17, '오경보는 8개 → 8개로 동일 · 질문·사유 안내도 대응으로 인정', size=17, color=INK)
fig.text(.07, .105, 'AI 참조 판정에 대한 개발셋 비교 · 독립 사람 검수 없음 · 현장 해결률 아님', size=15, color=MUTED)
fig.text(.07, .065, '출처: MIND coverage-v2-evidence.json / coverage-v7-harness.json', size=14, color=MUTED)
save(fig, '02-harness-comparison')
print(json.dumps({'metrics': metrics, 'figures': str(out)}, ensure_ascii=False))
