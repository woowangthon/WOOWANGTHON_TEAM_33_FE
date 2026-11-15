"""Validate records, source evidence, labels, WAV format/content and manifest hashes.
Uses Python standard library only. Does not measure model accuracy or listening quality.
"""
import array
import collections
import hashlib
import json
import math
from pathlib import Path
import sys
import wave

ROOT = Path(__file__).resolve().parents[1]
records = json.loads((ROOT / 'data/dataset.json').read_text(encoding='utf-8-sig'))
manifest = json.loads((ROOT / 'data/audio_manifest.json').read_text(encoding='utf-8-sig'))
audio_meta = {r['id']: r for r in manifest['records']}
assert len(records) == 100
assert len({r['id'] for r in records}) == 100
assert len({r['text'] for r in records}) == 100
assert len(audio_meta) == len(manifest['records']) == 100
assert collections.Counter(r['category'] for r in records) == {'normal': 50, 'criticism': 25, 'direct_abuse': 25}
assert len(list((ROOT / 'audio').glob('*.wav'))) == 100
jsonl = [json.loads(x) for x in (ROOT / 'data/dataset.jsonl').read_text(encoding='utf-8').splitlines()]
assert records == jsonl
audio_checks=[]
for r in records:
    assert r['expected_protect'] == r['direct_attack'] == (r['category'] == 'direct_abuse')
    assert r['has_profanity'] == bool(r['profanity_spans'])
    assert r['summary_should_be_empty'] == (r['reference_summary'] == '') == (r['must_preserve'] == [])
    for fact in r['must_preserve']:
        assert fact in r['text'], (r['id'], 'unsupported fact evidence', fact)
    for span in r['profanity_spans']:
        assert r['text'][span['start_char']:span['end_char']] == span['text']
    assert r['audio_path'] == f"audio/{r['id']}.wav"
    file = ROOT / r['audio_path']
    sha256 = hashlib.sha256(file.read_bytes()).hexdigest()
    assert audio_meta[r['id']]['sha256'] == sha256
    with wave.open(str(file), 'rb') as wav:
        assert (wav.getnchannels(),wav.getsampwidth(),wav.getframerate(),wav.getcomptype()) == (1,2,16000,'NONE')
        samples=array.array('h',wav.readframes(wav.getnframes()))
        if sys.byteorder != 'little': samples.byteswap()
        duration=len(samples)/16000
        rms=math.sqrt(sum(x*x for x in samples)/len(samples))
        peak=max(abs(x) for x in samples)
        clipped=sum(abs(x)>=32767 for x in samples)
        assert 1 < duration < 35, (r['id'],duration)
        assert rms > 100, (r['id'],'silent or near-silent')
        assert clipped/len(samples) < 0.001, (r['id'],'clipping')
    audio_checks.append({'id':r['id'],'duration_seconds':round(duration,3),'peak':peak,'rms':round(rms,2),'clipped_samples':clipped,'sha256':sha256})
assert len({r['sha256'] for r in audio_checks}) == 100, 'duplicate audio'
report={'dataset_version':'1.0.0','records':100,'unique_texts':100,'unique_audio_files':100,'category_counts':dict(collections.Counter(r['category'] for r in records)),'empty_summary_cases':sum(r['summary_should_be_empty'] for r in records),'total_audio_seconds':round(sum(x['duration_seconds'] for x in audio_checks),3),'audio_format':'WAV PCM signed 16-bit, 16000 Hz, mono','checks_passed':['record count and unique IDs/texts','category distribution','source-supported fact evidence and profanity character spans','JSON and JSONL equality','100 nonduplicate WAV files and manifest hashes','PCM format, duration, non-silence and clipping'],'not_checked':['independent human annotation','human listening review','ASR accuracy','application summary accuracy','live protection or end-to-end latency'],'files':audio_checks}
(ROOT / 'data/validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='files'},ensure_ascii=False,indent=2))
