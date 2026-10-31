from pathlib import Path
from html import escape
from PIL import Image, ImageDraw, ImageFont
import math
out=Path(__file__).resolve().parents[1]/'docs/da3/q1/architecture'
out.mkdir(parents=True,exist_ok=True)
W,H=1400,1060
image=Image.new('RGB',(W*2,H*2),'#ffffff'); draw=ImageDraw.Draw(image)
svg=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">', '<rect width="1400" height="1060" fill="white"/>']
regular='C:/Windows/Fonts/segoeui.ttf'; bold='C:/Windows/Fonts/segoeuib.ttf'
def text(x,y,label,size=16,color='#172033',weight=False):
    font=ImageFont.truetype(bold if weight else regular,size*2)
    draw.text((x*2,y*2),label,font=font,fill=color)
    svg.append(f'<text x="{x}" y="{y+size}" font-family="Segoe UI,Arial,sans-serif" font-size="{size}" fill="{color}" font-weight="{700 if weight else 400}">{escape(label)}</text>')
def box(x,y,w,h,title,lines,fill='#eff6ff',stroke='#2563eb',dashed=False):
    draw.rounded_rectangle((x*2,y*2,(x+w)*2,(y+h)*2),radius=20,fill=fill,outline=stroke,width=3)
    dash=' stroke-dasharray="7 5"' if dashed else ''
    svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{fill}" stroke="{stroke}" stroke-width="1.5"{dash}/>')
    text(x+16,y+13,title,18,stroke,True)
    for i,line in enumerate(lines): text(x+16,y+46+i*24,line,15)
def arrow(points,color='#2563eb',dashed=False):
    scaled=[(x*2,y*2) for x,y in points]
    if dashed:
        for (x1,y1),(x2,y2) in zip(scaled,scaled[1:]):
            length=math.hypot(x2-x1,y2-y1)
            for start in range(0,int(length),28):
                end=min(start+16,length)
                if length: draw.line([(x1+(x2-x1)*start/length,y1+(y2-y1)*start/length),(x1+(x2-x1)*end/length,y1+(y2-y1)*end/length)],fill=color,width=4)
    else: draw.line(scaled,fill=color,width=4,joint='curve')
    (a,b),(x,y)=points[-2:]; angle=math.atan2(y-b,x-a)
    head=[(x,y),(x-10*math.cos(angle-0.45),y-10*math.sin(angle-0.45)),(x-10*math.cos(angle+0.45),y-10*math.sin(angle+0.45))]
    draw.polygon([(int(x*2),int(y*2)) for x,y in head],fill=color)
    dash=' stroke-dasharray="7 5"' if dashed else ''
    svg.append('<polyline points="'+' '.join(f'{x},{y}' for x,y in points)+f'" fill="none" stroke="{color}" stroke-width="2"{dash}/>' )
    svg.append('<polygon points="'+' '.join(f'{x:.1f},{y:.1f}' for x,y in head)+f'" fill="{color}"/>')
text(35,23,'EVolve | DA3 Question 1 architecture',30,weight=True)
text(35,66,'Blue: verified local routing    Green: cloud database connection    Grey: hosted project references    Purple: proposed extension',15,'#526174')
box(35,110,910,620,'ACTUAL LOCAL DOCKER EXPERIMENT',[],fill='#f8fbff',stroke='#93b5e8')
box(60,165,220,130,'Local test tools',['k6 v1.8.2 + PowerShell','1,000-req benchmark (20 VUs)','Active failover experiment'])
box(330,165,270,130,'frontend: React + Nginx',['Host 5173 -> container 80','/api/* -> evolve_api','Failover retry: http_500..504'])
arrow([(280,225),(330,225)])
for number,y in [(1,145),(2,330),(3,515)]:
    box(650,y,255,125,f'evolve-backend{number}-1',[f'backend{number}:5000 (internal)', 'PostgreSQL pool limit: 5','Process liveness: healthy'])
    arrow([(600,225),(625,225),(625,y+62),(650,y+62)])
    arrow([(905,y+62),(965,y+62),(965,405),(1000,405)],'#059669',False)
box(60,470,250,125,'ISOLATED BASELINE (Q1b)',['127.0.0.1:5174 -> 80','Dedicated proxy -> backend1','0 failures, 3.32 RPS (accepted)'],fill='#f8fafc',stroke='#2563eb',dashed=True)
arrow([(170,295),(170,470)],'#2563eb',True)
text(60,670,'Network: evolve_default | API ports are internal only | 3 x 5 connections = 15 maximum',16,'#385779')
text(60,697,'Telemetry disabled in API processes; PG_CONNECT_TIMEOUT_MS set to 15000ms for WAN stability.',15,'#385779')
box(1000,300,365,210,'EXISTING CLOUD DATABASE',['Neon PostgreSQL (AWS us-east-2)','TLS verification stays enabled','1,949 stations (~536 KB JSON)','Average ~267 ms WAN RTT','No writes or migrations performed'],fill='#f0fdf4',stroke='#059669')
text(1005,532,'Read-only SQL queries verified during benchmarks.',15,'#047857')
box(35,800,640,220,'EXISTING ASSIGNMENT 1 HOSTING',[],fill='#f8fafc',stroke='#64748b')
box(60,855,230,90,'Render frontend',['HTTPS project reference'],fill='#ffffff',stroke='#64748b')
box(355,855,290,90,'Render backend',['HTTPS; process port uninspected'],fill='#ffffff',stroke='#64748b')
arrow([(290,900),(355,900)],'#64748b')
arrow([(645,900),(690,900),(690,760),(975,760),(975,440),(1000,440)],'#64748b',True)
text(60,972,'Hosted deployment is separate; not queried, inspected live or changed.',14,'#526174')
box(725,800,640,220,'PROPOSED EV CHARGING-SITE EDGE GATEWAY',['Short-TTL charger availability cache for local searches','Buffer telemetry during unreliable cloud connectivity','Sync via the central API after recovery; central bookings stay authoritative','Not implemented; existing telemetry is simulated'],fill='#f3e8ff',stroke='#9333ea',dashed=True)
arrow([(725,950),(705,950),(705,930),(645,930)],'#9333ea',True)
text(755,1025,'Purple dashed path: proposed HTTPS synchronization to central API',14,'#7e22ce')
svg.append('</svg>')
(out/'evolve-q1.svg').write_text('\n'.join(svg),encoding='utf-8')
image.save(out/'evolve-q1.png')
print('Architecture SVG and PNG generated from the same editable layout.')
