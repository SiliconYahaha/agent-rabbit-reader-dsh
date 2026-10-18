"""Resolve MDN's local CSS/JS for offline tests; retain original sources and hashes."""
from pathlib import Path
import urllib.request, json, re, posixpath, hashlib, concurrent.futures
root=Path(__file__).resolve().parents[1]/'test-materials/public-html'
root.mkdir(parents=True,exist_ok=True)
manifest=json.loads((root/'manifest.json' if (root/'manifest.json').exists() else root.parents[1]/'tests/fixtures/reliability/public-html-manifest.json').read_text())
base='https://raw.githubusercontent.com/mdn/learning-area/'+manifest['commit']+'/'
def prepare(case):
 if case['status']!='downloaded':return case
 original=root/case['file']
 if not original.exists():
  raw=urllib.request.urlopen(case['url'],timeout=20).read()
  if hashlib.sha256(raw).hexdigest()!=case['sha256']:raise ValueError('Upstream hash mismatch: '+case['file'])
  original.write_bytes(raw)
 source=original.read_text();dependencies=[]
 def replace(match):
  tag=match.group();attr=re.search(r'(?:href|src)=["\']([^"\']+)',tag)
  if not attr:return tag
  target=attr[1]
  if re.match(r'^(?:https?:|//|data:)',target):dependencies.append({'url':target,'status':'external-not-loaded'});return tag
  target=posixpath.normpath(posixpath.join(posixpath.dirname(case['path']),target))
  if target.startswith('../'):return tag
  url=base+target
  try:
   raw=urllib.request.urlopen(url,timeout=15).read(500001)
   if len(raw)>500000:raise ValueError('resource limit')
   content=raw.decode('utf8');dependencies.append({'url':url,'status':'inlined','sha256':hashlib.sha256(raw).hexdigest()})
   return '<style>'+content+'</style>' if tag.lower().startswith('<link') else '<script>'+content+'</script>'
  except Exception as error:dependencies.append({'url':url,'status':'failed','detail':str(error)});return tag
 source=re.sub(r'<link\b(?=[^>]*\brel=["\']stylesheet["\'])[^>]*>|<script\b[^>]*\bsrc=["\'][^"\']+["\'][^>]*>\s*</script>',replace,source,flags=re.I)
 name=case['file'].replace('.html','.offline.html');(root/name).write_text(source)
 case['prepared']=name;case['dependencies']=dependencies
 return case
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:manifest['cases']=list(pool.map(prepare,manifest['cases']))
(root/'manifest.json').write_text(json.dumps(manifest,indent=2));print('Prepared',len(manifest['cases']),'offline cases')
