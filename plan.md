# RallyCast Live Badminton — แผนการสร้าง

## เป้าหมาย
เว็บมือถือสำหรับผู้จัดการแข่งขันแบดมินตันที่ต้องการเปิดกล้อง ถ่ายทอดสดจริงไปยัง Facebook Live และ YouTube Live พร้อมกัน โดยควบคุมชื่อผู้เล่น/ทีมและคะแนนจากหน้าจอเดียว

## ขอบเขตที่ต้องทำ
- ตั้งค่ารายการแข่งขันและประเภทเดี่ยว/คู่
- กรอกชื่อฝั่งซ้ายและขวา พร้อมชื่อผู้เล่น/ทีม
- เปิดกล้องและไมโครโฟนบนอุปกรณ์ พร้อม preview
- วาด scoreboard และชื่อคู่แข่งลงบน Canvas stream เพื่อให้ติดไปกับวิดีโอจริง
- เพิ่ม ลด undo และ reset คะแนนโดยไม่ออกจากหน้าสตรีม
- ตั้งค่า RTMP endpoint/stream key สำหรับ Facebook และ YouTube
- ส่ง media chunks จาก MediaRecorder ไป backend ตามลำดับ
- backend สร้าง FFmpeg relay แบบ tee เพื่อส่งไปสอง RTMP destinations พร้อมกัน
- แสดงสถานะการเชื่อมต่อและหยุดสตรีมอย่างปลอดภัย

## ข้อจำกัดที่สำคัญ
- Stream Key เป็นข้อมูลลับ: ไม่เก็บใน localStorage/database; เก็บในหน่วยความจำของ browser/backend session เท่านั้น และไม่แสดงใน log
- การเริ่มสตรีมจริงต้องใช้ HTTPS บนมือถือและต้องกรอก Stream Key ของแต่ละแพลตฟอร์ม
- FFmpeg ต้องพร้อมใช้งานใน runtime/production container
- Preview สามารถทดสอบกล้อง/คะแนนได้ แม้ยังไม่กรอก key แต่การส่งจริงจะต้องกรอกอย่างน้อยหนึ่งปลายทาง

## แนวทางเทคนิค
- Frontend: Vanilla HTML/CSS/JavaScript แบบ mobile-first เพื่อให้เริ่มต้นเร็วและไม่มี dependency ที่ไม่จำเป็น
- Backend: Node.js `http` server แบบไม่พึ่ง package ภายนอก
- Media pipeline: `getUserMedia` → canvas compositing → `canvas.captureStream()` + audio track → `MediaRecorder` → HTTP chunk upload → FFmpeg stdin → RTMP tee
- Storage: localStorage สำหรับข้อมูลการแข่งขัน/ชื่อและความชอบเท่านั้น; ไม่เก็บ key
- Runtime: listen ที่ `0.0.0.0:${PORT || 3000}`

## โครงสร้างโปรเจกต์
- `server.js`: static server, health endpoint และ session/FFmpeg relay API
- `public/index.html`: โครงหน้าตั้งค่าและห้องควบคุม
- `public/styles.css`: visual system, responsive layout และ motion
- `public/app.js`: camera, canvas compositor, scoreboard state, chunk upload และ UI interactions
- `public/manus-routes.json`: route manifest ของ WebDev
- `Dockerfile`: production runtime พร้อม FFmpeg
- `app.config.ts`: project logo metadata
- `TODO.md`: acceptance-based deliverables

## Design direction
- **Design Movement:** broadcast control-room ผสมกับสนามกีฬา night-court — จริงจังแต่เข้าถึงง่ายสำหรับผู้จัดแข่งรายย่อย
- **Core Principles:** อ่านได้ในที่แสงน้อย, ปุ่มใหญ่กดด้วยนิ้วโป้ง, สถานะสำคัญต้องเห็นใน 1 วินาที, ความสวยงามต้องไม่บดบังภาพแข่ง
- **Color Philosophy:** พื้น navy/charcoal ลดแสงรบกวน; mint เป็นสีประจำแบรนด์เพื่อสื่อสัญญาณสด; coral ใช้เฉพาะ action/alert; lime ใช้บอก live/healthy
- **Layout Paradigm:** single-column operator console; video เป็น stage หลักด้านบน, score rail ลอยทับด้านล่าง, controls เป็น dock ที่อยู่ใกล้นิ้วหัวแม่มือ
- **Signature Elements:** เส้น court-court grid บางๆ, pill สถานะ LIVE, score cards แบบตัวเลขใหญ่พร้อมขอบเรืองแสง
- **Interaction Philosophy:** แตะครั้งเดียวแล้วเห็นผลทันที; undo อยู่ใกล้ action; start/stop มีข้อความยืนยันในตัวเองและไม่ใช้ modal ซ้อนหลายชั้น
- **Animation:** score เปลี่ยนด้วย spring-like pop สั้นๆ, live pill กระพริบช้า, panel เลื่อนจากด้านล่างบนมือถือ, หลีกเลี่ยง animation ที่ทำให้ปุ่มลอยหรืออ่านยาก
- **Typography:** ใช้ system sans / `Inter`, `Noto Sans Thai`, sans-serif; ตัวเลขคะแนนใช้ monospace เพื่อให้ความกว้างนิ่ง; heading ใช้ weight 800, body 500–600
- **Brand Essence:** ห้องควบคุมไลฟ์สำหรับสนามแบดที่ทำให้การถ่ายทอดสดมืออาชีพเกิดขึ้นได้ในไม่กี่แตะ — กระชับ, มั่นใจ, คล่องตัว
- **Brand Voice:** สั้น ชัด ให้กำลังใจแบบทีมงานถ่ายทอดสด เช่น “พร้อมขึ้นสนามเมื่อคุณพร้อม” และ “แต้มนี้ขึ้นจอแล้ว”
- **Wordmark & Logo:** ตัวอักษร R ที่ตัดด้วยเส้น flight path ของลูกขนไก่; ใช้เป็นไอคอนวงกลมใน header
- **Signature Brand Color:** `#64F1D2` mint signal

## ส่วนเชื่อมต่อกับบริการ
ระบบจะรับ RTMP URL และ Stream Key จากผู้ใช้โดยตรงและส่งต่อจาก backend ไปยังปลายทางที่เลือก การยืนยันว่าแพลตฟอร์มขึ้น LIVE สำเร็จขึ้นกับการตอบรับของ Facebook/YouTube และควรตรวจซ้ำในแดชบอร์ดของแพลตฟอร์ม
