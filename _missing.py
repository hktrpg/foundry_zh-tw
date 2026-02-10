import json,re
from pathlib import Path

en=json.loads(Path('_en.json').read_text(encoding='utf-8'))
audit=json.loads(Path('translation_audit.json').read_text(encoding='utf-8'))
missing=audit['missing_keys']

IDX=re.compile(r'^(.*)\[(\d+)\]$')

def get(obj, path):
    cur=obj
    for part in path.split('.'):
        m=IDX.match(part)
        if m:
            name,idx=m.group(1),int(m.group(2))
            if name:
                cur=cur[name]
            cur=cur[idx]
        else:
            cur=cur[part]
    return cur

out=[]
for k in missing:
    try:
        out.append({'key':k,'en':get(en,k)})
    except Exception as e:
        out.append({'key':k,'error':str(e)})

Path('missing_en_values.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
print('WROTE missing_en_values.json with',len(out),'entries')
