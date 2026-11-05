# Mahyar Gap — مهیار گپ

یک فضای ارتباطی خصوصی با تجربه‌ای الهام‌گرفته از Discord برای یک گروه کوچک از دوستان: چت لحظه‌ای، صدا، ویدئو، اشتراک صفحه — و **رادیو مهیار**، یک رادیوی زنده‌ی مشترک برای هر اتاق صوتی.

> English: [README.md](./README.md)

---

## فناوری‌ها

| لایه | فناوری |
|------|--------|
| وب‌اپ | React 18 + TypeScript + Vite + Tailwind (فارسی/انگلیسی، RTL/LTR) |
| API | Node.js 22، Express، Socket.IO، Zod، Prisma |
| دیتابیس | PostgreSQL (Railway) |
| Realtime | Socket.IO (اتاق‌های مجاز، presence، typing، وضعیت Voice، وضعیت رادیو) |
| صدا/ویدئو | LiveKit (میکروفن، دوربین، اشتراک صفحه + صدای سیستم) |
| رادیو | Worker پایتون (بسته‌ی `livekit` / livekit.rtc) + FFmpeg — فقط **در زمان نیاز** به‌صورت Child Process |
| Storage | باکت خصوصی S3-سازگار Railway (فقط پیوست‌های چت) |

## ساختار مخزن

```
apps/
  api/                 بک‌اند ماژولار (modules/, realtime/, workers/, storage/)
    prisma/            schema + migrationها (تاریخچه حفظ شده — بخش «امنیت Migration»)
    src/
      config/          env، کاتالوگ دسترسی‌ها، ایستگاه‌های رادیو (فقط سمت سرور)
      modules/         auth، users، servers، channels، messages، direct-messages،
                       friends، files، voice، radio، notifications
      realtime/        گیت‌وی Socket.IO (هر ایونت در دیتابیس مجوزسنجی می‌شود)
      storage/         هِلپرهای عمومی S3 (باکت خصوصی؛ جریان از مسیر API)
      workers/         radio-worker-manager.ts (پروسس پایتونِ تنبل)
  web/                 SPA ری‌اکت (features/ برای هر دامنه، i18n fa/en، تم تیره/روشن)
workers/
  radio/               Worker رادیو: main.py، stream_decoder.py،
                       livekit_publisher.py، protocol.py، poc.py
```

## رادیو واقعاً چیست؟

«رادیو مهیار» یک پلیر HTML محلی **نیست**. وقتی اولین عضو یک Voice Room ایستگاهی را انتخاب می‌کند، API برای آن اتاق یک Worker پایتون اجرا می‌کند. این Worker:

1. به‌عنوان یک Participant واقعی (`mahyar-radio-<channelId>` با نام `Mahyar Radio`) وارد اتاق LiveKit می‌شود،
2. استریم را با ffprobe بررسی می‌کند (به پسوند `.mp3` اعتماد نمی‌کند — RadioX پاسخ `audio/aac` می‌دهد)،
3. استریم HTTP را با FFmpeg به فریم‌های ۱۰ms پلی‌سی‌م (48kHz استریو) دیکود می‌کند،
4. آن‌ها را به‌عنوان یک Track صوتی واقعی منتشر می‌کند تا همه‌ی اعضا از مسیر Voice بشنوند.

تضمین‌ها:

- **در زمان Boot هیچ کاری انجام نمی‌شود** — بدون FFmpeg، بدون Worker، بدون اتصال استریم تا اولین فرمان Play معتبر.
- **برای هر اتاق فقط یک استریم** — تعویض ایستگاه ابتدا دیکودر جدید را گرم می‌کند و بعد از پخش سالم جایگزین می‌شود؛ استریم قبلی هرگز مخلوط نمی‌شود.
- **خاموشی خودکار** — با خروج آخرین انسان، Worker و FFmpeg بعد از `RADIO_IDLE_SHUTDOWN_MS` (پیش‌فرض ۳۰ ثانیه) متوقف می‌شوند.
- **تعویض ایستگاه و Stop برای کل اتاق** است؛ Volume فقط برای همان کلاینت محلی است.
- **خطا صادقانه نمایش داده می‌شود** — برچسب `LIVE` فقط بعد از Publish واقعی Track ظاهر می‌شود.
- **`RADIO_MAX_ACTIVE_ROOMS=1`** به‌صورت پیش‌فرض برای محافظت از Railway کم‌منبع.
- **هیچ URL از کلاینت پذیرفته نمی‌شود** — ایستگاه‌ها کاتالوگ سمت سرور هستند (ضد SSRF).
- بعد از Restart/Deploy وضعیت رادیو `stopped` است — بدون Worker یتیم و بدون پخش خودکار.

> ⚠️ **نکته مجوز:** این چهار استریم RadioX عمومی‌اند اما «عمومی بودن» به معنی مجوز بازپخش نیست؛ فقط برای شنیدن خصوصی استفاده شوند. هیچ DRM یا کنترل دسترسی دور زده نمی‌شود.

## مدل احراز هویت

- **Access Token:** JWT کوتاه‌عمر (۱۵ دقیقه)، فقط در حافظه‌ی کلاینت (نه localStorage، نه کوکی).
- **Refresh Token:** مقدار تصادفی ۳۲بایتی در کوکی `HttpOnly`، `SameSite=Lax`، `Path=/api/auth`؛ سمت سرور **هش‌شده** (SHA-256) در جدول `Session` ذخیره و **در هر Refresh چرخانده** می‌شود.
- رمزها با Argon2id.
- CSRF: کوکی‌ها Lax + بررسی Origin.
- تمام Routeها و تمام ایونت‌های Socket دوباره سمت سرور مجوزسنجی می‌شوند.

## امنیت Migration (قبل از اولین Deploy بخوانید)

تاریخچه‌ی Migrationها **حفظ شده** و یک Migration جدید Forward-only به نام `20261105000000_radio_rebuild` در یک تراکنش:

1. واکنش‌ها و پیوست‌های JSON قدیمی را به ردیف‌های رابطه‌ای تبدیل می‌کند،
2. زیرسیستم موسیقی بازنشسته را حذف می‌کند (`MusicTrack`، `MusicPlaylist`، `MusicPlaylistTrack`، `musicEnabled`)،
3. ستون‌های بلااستفاده و جدول `FriendRequest` را حذف می‌کند.

**هیچ داده‌ی کاربر، پیام، DM، سرور، کانال یا پیوستی حذف نمی‌شود.** ردیف‌های JSON خراب با هشدار رد می‌شوند نه اینکه کل Migration را بشکنند.

⚠️ **قبل از هر چیز Backup بگیرید** (از هر سیستمی که به psql دسترسی دارد):

```bash
pg_dump "$DATABASE_URL" --no-owner -Fc -f mahyar-gap-backup.dump
# بازیابی (فقط در صورت نیاز):
# pg_restore -d "$DATABASE_URL" --clean --if-exists mahyar-gap-backup.dump
```

⚠️ هیچ‌وقت روی دیتابیس Production دستور `prisma migrate reset` اجرا نکنید. تنها دستور دیتابیسی که این پروژه به‌طور خودکار اجرا می‌کند `prisma migrate deploy` است (فقط Migrationهای در انتظار را اعمال می‌کند).

## اجرای محلی

پیش‌نیاز: Node 20+، یک دیتابیس PostgreSQL و (اختیاری، برای رادیو) FFmpeg + Python 3.11+ با `pip install -r workers/radio/requirements.txt`.

```bash
npm install            # workspaces (api + web)
npm run db:generate    # prisma client
npm run db:deploy      # اعمال Migrationها
cp .env.example apps/api/.env   # مقادیر را پر کنید
npm run dev:api        # http://localhost:3000
npm run dev:web        # http://localhost:5173 (پروکسی /api و socket.io)
```

## استقرار روی Railway

1. این مخزن را به GitHub پوش کنید (CI شامل typecheck، build، تست و اعمال Migration روی Postgres خالی است — `.github/workflows/ci.yml`).
2. Railway → پروژه‌ی جدید از مخزن. Railway با `railway.json` از Dockerfile می‌سازد. یک **Web Service**، یک **PostgreSQL**، یک **Bucket** (خصوصی).
3. در Variables سرویس وب، متغیرهای Postgres و Bucket را Reference کنید (`DATABASE_URL`، `AWS_*`) و بقیه را از `.env.example` اضافه کنید (`JWT_ACCESS_SECRET`، `LIVEKIT_*`، `RADIO_*`).
4. Deploy. فرمان شروع، اول `prisma migrate deploy` و بعد API را اجرا می‌کند — **قبل از اولین Deploy روی داده‌ی موجود، با pg_dump بکاپ بگیرید**.
5. بررسی: `https://<your-app>.up.railway.app/api/health` → `{"status":"ok"}`.

## تأیید Worker رادیو (POC)

روی هر سیستمی (یا شِل کانتینر Railway) با Python + FFmpeg:

```bash
python3 workers/radio/poc.py \
  --livekit-url wss://… --api-key … --api-secret … \
  --room poc-radio-room --duration 60
```

از یک کلاینت LiveKit به `poc-radio-room` بروید: باید صدای ایستگاه را بشنوید، پارتیسیپنت `poc-radio` را ببینید و پس از پایان همه‌چیز تمیز بسته شود.

## چیزهایی که عمداً حذف شدند

- کل زیرسیستم موسیقی همگام‌سازی مرورگر: `server/music/*`، مسیرهای `/api/music/*`، `js/music.js`، فرمان‌های `/mp`، ایونت‌های `music:*`، مدل‌های `MusicTrack`/`MusicPlaylist`/`MusicPlaylistTrack`، `musicEnabled` و همه‌ی `MUSIC_*`. هِلپرهای Storage داخل ماژول موسیقی بودند — ابتدا به `apps/api/src/storage/` منتقل و مسیر پیوست‌ها با همان باکت خصوصی حفظ شد.
- انواع کانال Announcement/Forum/Stage (در نسخه قدیمی فقط برچسب بودند).
- API عمومی `/tables/:table` (جایگزین شده با Endpointهای صریح و مجازسنجی‌شده).
- صفحات Landing تبلیغاتی (جزو محصول نیستند؛ ورودی، صفحه‌ی Auth است).
- جدول `FriendRequest` (هرگز استفاده نمی‌شد)، `discriminator`، `emailVerified`، `twoFactorEnabled` و `threadName`.

## محدودیت‌های شناخته‌شده

- Presence و Sessionهای رادیو در حافظه‌اند → **فقط یک Replica** (`numReplicas: 1`).
- نشانگر خوانده‌نشده سمت کلاینت است (localStorage) مثل نسخه قبل.
- توکن LiveKit هنگام «تغییر نقش» باطل نمی‌شود (فقط Kick/Ban)؛ TTL سی‌دقیقه‌ای توکن ریسک را محدود می‌کند.
- وضعیت مجوز این چهار استریم در بالا مستند است؛ اگر استریمی در دسترس نباشد، خطای واقعی با دکمه تلاش مجدد نمایش داده می‌شود.
