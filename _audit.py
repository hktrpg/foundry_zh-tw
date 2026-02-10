import json,re,sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

root=Path('.')
en_path=root/'_en.json'
zh_path=root/'zh-tw.json'

PH=re.compile(r'\{[^}]+\}')

def load(p):
    with p.open('r',encoding='utf-8') as f:
        return json.load(f)

def flatten(obj, prefix=''):
    out={}
    if isinstance(obj,dict):
        for k,v in obj.items():
            key = f'{prefix}.{k}' if prefix else str(k)
            out.update(flatten(v,key))
    elif isinstance(obj,list):
        for i,v in enumerate(obj):
            key=f'{prefix}[{i}]'
            out.update(flatten(v,key))
    else:
        out[prefix]=obj
    return out

def ascii_ratio(s):
    if not s:
        return 0.0
    ascii_count=sum(1 for ch in s if ord(ch)<128)
    return ascii_count/len(s)

en=load(en_path)
zh=load(zh_path)

en_f=flatten(en)
zh_f=flatten(zh)

en_keys=set(en_f)
zh_keys=set(zh_f)
missing=sorted(en_keys-zh_keys)
extra=sorted(zh_keys-en_keys)

common=sorted(k for k in (en_keys&zh_keys) if isinstance(en_f[k],str) and isinstance(zh_f[k],str))

placeholder_mismatch=[]
for k in common:
    en_ph=set(PH.findall(en_f[k]))
    zh_ph=set(PH.findall(zh_f[k]))
    if en_ph!=zh_ph:
        placeholder_mismatch.append({
            'key':k,
            'en_placeholders':sorted(en_ph),
            'zh_placeholders':sorted(zh_ph),
            'en':en_f[k],
            'zh':zh_f[k],
        })

identical_to_en=[]
for k in common:
    e=en_f[k].strip()
    z=zh_f[k].strip()
    if z and z==e:
        identical_to_en.append({'key':k,'en':en_f[k],'zh':zh_f[k]})

mostly_ascii=[]
for k in common:
    z=zh_f[k].strip()
    if not z:
        continue
    r=ascii_ratio(z)
    if r>0.85 and re.search(r'[A-Za-z]',z):
        mostly_ascii.append({'key':k,'en':en_f[k],'zh':zh_f[k],'ascii_ratio':r})
mostly_ascii.sort(key=lambda x: -x['ascii_ratio'])

summary={
    'en_leaf_count':len(en_f),
    'zh_leaf_count':len(zh_f),
    'missing_keys_count':len(missing),
    'extra_keys_count':len(extra),
    'placeholder_mismatch_count':len(placeholder_mismatch),
    'identical_to_en_count':len(identical_to_en),
    'mostly_ascii_count':len(mostly_ascii),
}

out={
    'summary':summary,
    'missing_keys':missing,
    'extra_keys':extra,
    'placeholder_mismatch':placeholder_mismatch,
    'identical_to_en':identical_to_en,
    'mostly_ascii':mostly_ascii,
}
(root/'translation_audit.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')

lines=[]
lines.append('# Translation Audit')
lines.append('')
lines.append('## Summary')
lines.append('')
for k,v in summary.items():
    lines.append('- **' + k + '**: ' + str(v))

lines.append('')
lines.append('## Missing keys in zh-tw (first 200)')
lines.append('')
for k in missing[:200]:
    lines.append('- ' + k + '')

lines.append('')
lines.append('## Placeholder mismatches')
lines.append('')
if not placeholder_mismatch:
    lines.append('- (none)')
else:
    for m in placeholder_mismatch:
        lines.append('- ' + m['key'] + '')
        lines.append('  - EN: ' + m['en'])
        lines.append('  - ZH: ' + m['zh'])
        lines.append('  - EN placeholders: ' + str(m['en_placeholders']))
        lines.append('  - ZH placeholders: ' + str(m['zh_placeholders']))

lines.append('')
lines.append('## Identical to EN (first 200)')
lines.append('')
for row in identical_to_en[:200]:
    lines.append('- ' + row['key'] + ' = ' + row['zh'] + '')

lines.append('')
lines.append('## Mostly ASCII (first 200)')
lines.append('')
for row in mostly_ascii[:200]:
    lines.append('- ' + row['key'] + ' (ascii_ratio=' + ('%.2f' % row['ascii_ratio']) + ') = ' + row['zh'] + '')

(root/'translation_audit.md').write_text('\n'.join(lines),encoding='utf-8')

print('OK')
print(json.dumps(summary,ensure_ascii=True))
print('WROTE translation_audit.json and translation_audit.md')
