# ShuttleCast — วิธีรัน (มือถือ → WebRTC → OBS → Facebook Live)

ไม่ผ่าน Manus ไม่มีรหัสผ่านเข้าเว็บ ไม่มี dependency (Node.js อย่างเดียว)

## เส้นทางภาพ
มือถือ (Chrome) → WebRTC → หน้า `/live` บนโน้ตบุ๊ก (ใส่ scoreboard + โลโก้สปอนเซอร์) → OBS Browser Source → Facebook Live

- มือถือ: ถ่ายภาพ กดคะแนน ส่งภาพดิบ + ข้อมูลคะแนน
- โน้ตบุ๊ก: server สัญญาณ (`node server.js`) + OBS ที่ใส่ Stream Key
- แอปไม่เก็บ Stream Key ใส่ใน OBS เท่านั้น
- ไม่ต้องใช้ FFmpeg แล้ว

## ติดตั้ง (Windows)
```
winget install OpenJS.NodeJS.LTS
winget install Cloudflare.cloudflared
winget install OBSProject.OBSStudio
```

## วันใช้งาน
1. `node server.js` ในโฟลเดอร์โปรเจกต์ (ค้างไว้)
2. หน้าต่างที่สอง: `cloudflared tunnel --url http://localhost:3000` คัดลอกลิงก์ `https://....trycloudflare.com` (ลิงก์เปลี่ยนทุกครั้ง) ส่งเข้ามือถือ
3. OBS: Sources → + → Browser → URL `http://localhost:3000/live`, Width 1280, Height 720, ติ๊ก Control audio via OBS, ตั้งเสียงนี้ Monitor Off
4. OBS: Settings → Stream ใส่ Stream Key ของ Facebook, Output bitrate ~3000 Kbps, Video 1280×720 30 fps
5. มือถือ: เปิดลิงก์ใน Chrome → สร้างห้องควบคุม → เปิดกล้อง → เริ่มถ่ายทอดสด (ส่งเข้า OBS)
6. ดูภาพใน OBS ให้ขึ้น แล้วกด Start Streaming ใน OBS และ Go Live ใน Facebook

## มือถือใช้เน็ตมือถือ (ย้ายสนามได้) — ต้องมี TURN
โน้ตบุ๊กต่อ Wi‑Fi สนาม มือถือใช้ 4G/5G ภาพต้องวิ่งข้ามเครือข่าย ใช้ STUN อย่างเดียวอาจไม่ติด ต้องมี TURN server

ทางที่ใช้ได้: Cloudflare Realtime TURN (หน้าเอกสารระบุฟรี 1,000 GB ก่อนเริ่มคิดเงิน ยังไม่ยืนยันว่าบัญชีฟรีใช้ได้โดยไม่ผูกบัตร)
1. Cloudflare Dashboard → Realtime → TURN → Create TURN key จด Key ID กับ API Token
2. รันโน้ตบุ๊กด้วย (PowerShell):
```
$env:TURN_KEY_ID="ใส่ Key ID"; $env:TURN_KEY_API_TOKEN="ใส่ Token"; node server.js
```
3. เปิด `http://localhost:3000/api/health` ต้องเห็น `"turn":true`

ภาพวิ่งผ่าน TURN ประมาณ 1.3 GB ต่อชั่วโมงที่ 3 Mbps และใช้เน็ตมือถือของมือถือเท่ากัน

ทางอื่น: TURN server อื่น ใส่ `TURN_URL`, `TURN_USER`, `TURN_PASS`

## ตัวแปร (ไม่บังคับ)
- `PORT` ค่าเริ่มต้น 3000
- `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` (Cloudflare TURN) หรือ `TURN_URL`, `TURN_USER`, `TURN_PASS`
- หลายสนาม: เติม `?room=court2` ทั้งที่ลิงก์มือถือและลิงก์ OBS

## ข้อควรระวัง
- แนะนำให้มือถือและโน้ตบุ๊กอยู่ Wi‑Fi เดียวกัน (ภาพวิ่งตรงระหว่างเครื่อง ไม่ผ่าน tunnel)
- Cloudflare quick tunnel ส่ง UDP ไม่ได้ จึงใช้ tunnel เฉพาะหน้าเว็บกับสัญญาณเชื่อมต่อ
- ไม่มีรหัสผ่าน ใครรู้ลิงก์ก็เปิดหน้าได้ อย่าแชร์ลิงก์สาธารณะ
- ใช้ Browser Source ไม่ใช้ Window Capture

## ตัวนับชั่วโมงไลฟ์รายเดือน
- server นับเวลาที่มือถือส่งภาพเข้า OBS (นับทุกครั้ง แม้ใช้ Wi‑Fi ไม่ผ่าน TURN จึงเป็นค่าประมาณสูงกว่าจริง)
- เก็บในไฟล์ `usage.json` รีเซ็ตเองทุกต้นเดือน
- ถึง 650 ชม. แอปมือถือขึ้นข้อความเตือนสีแดงและ toast (ไม่ได้หยุดไลฟ์ให้)
- ปรับเพดานด้วย `USAGE_LIMIT_HOURS` ดูยอดที่ `http://localhost:3000/api/usage`
