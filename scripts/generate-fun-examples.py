"""Bundle small, licensed example files for the mini-program's format gallery.

The Illustrator file is CC0 from richrdkng/adobe-illustrator-templates.
The layered PSD poster uses original AI-generated art; see example-art/README.md.
No private user test files are embedded.
"""
from pathlib import Path
import base64, io, json, zipfile
root = Path(__file__).resolve().parents[1]
art = root / 'scripts' / 'assets' / 'example-art'
ai = (art / 'logo-variants.ai').read_bytes()
psd = (art / 'rabbit-courier-poster.psd').read_bytes()
bicycle = (root / 'tests' / 'fixtures' / 'svg-animated' / 'partridge-bike.svg').read_bytes()
html='''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>这会其实可以不开</title><style>body{margin:0;padding:24px;background:#fff9f2;color:#171715;font-family:sans-serif}h1{font-size:30px;line-height:1.3}.card{padding:22px;border:2px solid #171715;border-radius:20px;background:#fffdf8}button{display:block;width:100%;margin:14px 0;padding:16px;border:2px solid #171715;border-radius:14px;background:#b9e63b;color:#171715;font-size:18px}#cost{font-size:42px;font-weight:bold}.muted{font-size:14px;color:#62605c}#verdict{line-height:1.6}</style></head><body><p class="muted">开会模拟器 · 纯属虚构</p><h1>这会其实<br>可以不开</h1><div class="card"><p>本次会议已花费</p><div id="cost">0 杯奶茶</div><p id="round">讨论轮次：0</p><button id="again">再讨论一下</button><button id="done">就这么定了</button><p id="verdict">议题：明天几点开会？</p></div><p class="muted">点按钮试试，内容只在本机运行。</p><script>var n=0;document.getElementById('again').onclick=function(){n++;document.getElementById('cost').textContent=(n*6)+' 杯奶茶';document.getElementById('round').textContent='讨论轮次：'+n;document.getElementById('verdict').textContent=n<3?'要不，再拉个人对齐一下？':'结论暂定：下次再议。'};document.getElementById('done').onclick=function(){document.getElementById('verdict').textContent='结论：这事发个消息就行。散会！';};</script></body></html>'''
svg='''<svg xmlns="http://www.w3.org/2000/svg" width="600" height="540" viewBox="0 0 600 540"><rect width="600" height="540" fill="#fff9f2"/><text x="300" y="65" font-size="34" text-anchor="middle" fill="#171715">下班雷达</text><circle cx="300" cy="280" r="145" fill="#fffdf8" stroke="#171715" stroke-width="5"/><path d="M300 145 V160 M435 280 H420 M300 415 V400 M165 280 H180" stroke="#171715" stroke-width="5"/><text x="300" y="201" font-size="23" text-anchor="middle">18:00</text><g><path d="M300 280 L300 180" stroke="#ff5b43" stroke-width="9" stroke-linecap="round"/><animateTransform attributeName="transform" type="rotate" from="0 300 280" to="360 300 280" dur="8s" repeatCount="indefinite"/></g><circle cx="300" cy="280" r="12" fill="#171715"/><text x="300" y="475" font-size="26" text-anchor="middle" fill="#171715">人还在工位，心已经打卡。</text><text x="300" y="511" font-size="17" text-anchor="middle" fill="#62605c">虚构时钟，不代表真实下班时间</text></svg>'''
buf=io.BytesIO()
with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
 for name,content in [('你还是打开了.txt','恭喜，你发现了一个普通的文件夹。\n里面没有秘密，只有准时下班的愿望。'),('摸鱼许可证.html','<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:24px;background:#fff9f2;color:#171715;font-family:sans-serif}.permit{padding:22px;border:3px solid #171715;border-radius:18px;background:#fffdf8}h1{font-size:30px}p{line-height:1.8}.stamp{margin-top:28px;padding:12px;text-align:center;background:#b9e63b;border:2px solid #171715;border-radius:12px;font-size:22px;font-weight:bold}.small{font-size:13px;color:#62605c}</style></head><body><div class="permit"><p class="small">工位健康委员会 · 虚构证件</p><h1>摸鱼许可证</h1><p>持证人：认真工作的你</p><p>许可事项：站起来，喝口水，看看远处。</p><div class="stamp">准了，休息五分钟。</div><p class="small">解释权归你的颈椎。</p></div></body></html>')]:
  info=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,content.encode())
files=[('meeting','HTML','这会其实可以不开','点一下，会议成本又涨了','这会其实可以不开.html','text/html',html.encode()),('clock','SVG','下班雷达','人还在，心已打卡','下班雷达.svg','image/svg+xml',svg.encode()),('bicycle','SVG','鹧鸪也要通勤','看插画里谁骑得更快','鹧鸪也要通勤.svg','image/svg+xml',bicycle),('final','Ai','标志的四种形态','真实 Illustrator 矢量标志源稿','标志的四种形态.ai','application/pdf',ai),('change','PSD','兔子送文件','插画与标题分层的海报设计稿','兔子送文件.psd','application/x-photoshop',psd),('secret','ZIP','不要打开这个文件夹','既然来了，就拆开看看','不要打开这个文件夹.zip','application/zip',buf.getvalue())]
markdown='''# 周五逃跑攻略

> 从工位撤离，到沙发登陆。本文纯属一本正经地休息。

## 出发清单

- [x] 保存文件，别把“最终版”留在内存里
- [x] 发完今天最后一条工作消息
- [ ] 18:00 准时下班，不再“顺便看一眼”

## 行动路线

表格可以左右滑，最右边藏着结局。

| 时间节点 | 行动方案 | 随身装备 | 预计花费 | 意外情况 | 隐藏结局 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 18:00 | 合上电脑，潇洒起身 | 钥匙、手机、好心情 | 零元整 | 忘了带伞 | 主角决定先点外卖 |
| 18:30 | 出门散步，假装旅游 | 耳机和一双舒服的鞋 | 奶茶一杯 | 路过熟悉的便利店 | 旅行半径仅五百米 |
| 20:00 | 抵达沙发，正式躺平 | 毯子和充好电的手机 | 精力条回满 | 想起衣服还没收 | 下班了但没完全下 |

## 本周总结

**计划很满，执行看缘分。**

明天的待办只有一条：`不要给自己安排太多待办。`
'''
files.append(('markdown','MD','周五逃跑攻略','Markdown 清单与宽表格','周五逃跑攻略.md','text/markdown',markdown.encode()))
records=[]
for id,fmt,title,desc,name,mime,content in files:
 records.append(dict(id=id,format=fmt,title=title,description=desc,name=name,type=mime,size=len(content),base64=base64.b64encode(content).decode()))
out=root/'miniprogram/examples/data/files.js';out.write_text("'use strict'\n\n// Generated by scripts/generate-fun-examples.py. Original demo files, not user data.\nmodule.exports = "+json.dumps(records,ensure_ascii=False,indent=2)+'\n')
print([(r['format'],r['size']) for r in records])
