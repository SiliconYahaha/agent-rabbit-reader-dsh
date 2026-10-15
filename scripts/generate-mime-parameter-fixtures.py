"""Original MIME/header and encoding controls, independent Python stdlib oracles."""
from pathlib import Path
from email.message import Message
from email import policy
import json,base64,io,csv
OUT=Path(__file__).resolve().parents[1]/'tests/fixtures/mime-parameters'
OUT.mkdir(parents=True,exist_ok=True)
headers=[
 'text/csv; name="report;charset=gbk"',
 'text/csv; name="a;charset=gbk"; charset=utf-8',
 'TEXT/CSV; NAME="x;Charset=big5"; CHARSET="UTF-8"',
 'text/csv; name="escaped\\\";charset=gbk"; charset=utf-8',
 'text/csv; name="quoted; semicolon"; charset="utf\\-8"',
 'text/csv; other="\\\\;charset=big5"; charset=UTF8',
 'text/csv; charset="GB18030"; name="wrong;charset=utf-8"',
 'text/csv; charset=Shift_JIS; name="unused;charset=gbk"',
 'text/csv; charset=cp949; name="unused;charset=big5"',
 'text/csv; name="unused;charset=cp949"; charset=big5',
]
rows=[]
for i,h in enumerate(headers):
 legacy=Message();legacy['Content-Type']=h
 m=Message(policy=policy.default);m['Content-Type']=h
 charset=m.get_param('charset'); codec={'UTF8':'utf-8','Shift_JIS':'shift_jis'}.get(charset,charset or 'utf-8')
 text={'shift_jis':'番号,内容\r\n01,日本語\r\n','cp949':'번호,내용\r\n01,한국어\r\n','big5':'編號,內容\r\n01,繁體中文\r\n'}.get(codec,'编号,内容\r\n01,汉字\r\n')
 expected=list(csv.reader(io.StringIO(text,newline=''),strict=True))
 rows.append({'id':i,'type':h,'mediaType':m.get_content_type(),'charset':charset,'legacyCharset':legacy.get_param('charset'),'source':text,'base64':base64.b64encode(text.encode(codec)).decode(),'rows':expected})
(OUT/'headers.json').write_text(json.dumps({'ownership':'Own synthetic headers and text, no user files','oracles':['Python email.message policy.default headerregistry and RFC9110 quoted-pair','Python standard encoders and csv strict reader'],'rows':rows},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'headers':len(rows)}))
