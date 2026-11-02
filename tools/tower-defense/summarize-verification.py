"""Collect evidence without turning editor playback into published-player proof."""
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
names=['m1','m2','m3','m3-ui','m4-normal','m4-final-high','m4-final-low','m5','final-campaign']
result={'artifact':'samples/starhold.bcmkn','sha256':hashlib.sha256((ROOT/'samples/starhold.bcmkn').read_bytes()).hexdigest(),
        'standalonePublishedPlayerVerified':False,'onlineCloudImplemented':False,'evidence':[]}
for name in names:
    path=ROOT/'samples/starhold-verification'/name/'report.json'
    if not path.is_file():continue
    report=json.loads(path.read_text(encoding='utf8'))
    samples=report.get('snapshots',[])
    metrics=dict(report.get('frameMetrics',{}))
    if len(samples)>1 and 'simFrames' in samples[0]['variables']:
        metrics['positiveDtStepsPerSecond']=(samples[-1]['variables']['simFrames']-samples[0]['variables']['simFrames'])/metrics['durationSeconds']
    result['evidence'].append({'name':name,'path':str(path.relative_to(ROOT)).replace('\\','/'),
      'projectSha256':report['projectSha256'],'ok':report.get('ok',False),
      'runtimeKind':report['runtimeKind'],'browserShellDegraded':report['browserShellDegraded'],
      'provenanceVerified':report.get('provenanceVerified',False),'metrics':metrics,
      'fixtureSteps':[s['name'] for s in report['scenario'] if s.get('fixture')],
      'nativeErrors':report.get('nativeEvents',{}).get('errors',[]),
      'nativeWarnings':report.get('nativeEvents',{}).get('warnings',[]),
      'network':report['network'],
      'terminalCheckpoints':[{'name':s['name'],'mode':s['after']['variables'].get('mode'),
         'level':s['after']['variables'].get('level'),'score':s['after']['variables'].get('score'),
         'stars':s['after']['variables'].get('stars'),'lives':s['after']['variables'].get('lives')}
        for s in report['scenario'] if 'victory' in s['name'] or 'defeat' in s['name'] or 'record' in s['name']]})
(ROOT/'docs/tower-defense-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'reports':len(result['evidence']),'allReportedRunsPassed':all(e['ok'] for e in result['evidence']),
                  'standalonePublishedPlayerVerified':False,'onlineCloudImplemented':False}))
