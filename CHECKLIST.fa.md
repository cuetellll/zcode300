# چک‌لیست نهایی Railway — مهیار گپ

این فایل را هنگام Deploy کنار دست بگذار. مراحل به ترتیب انجام شوند.

## ۱) قبل از Deploy — Backup دیتابیس موجود

اگر دیتابیس Production فعلی (نسخه قبلی Mahyar Gap) کاربر/پیام دارد، **قبل از اولین Deploy نسخه جدید** یک Backup بگیر. از هر سیستمی که `psql`/`pg_dump` دارد:

```bash
pg_dump "$DATABASE_URL_OLD" --no-owner -Fc -f mahyar-gap-backup.dump
```

`$DATABASE_URL_OLD` را از Railway → سرویس PostgreSQL فعلی → Variables کپی کن.

- Migration جدید هیچ داده‌ای حذف نمی‌کند (فقط جدول‌های موسیقی و ستون‌های بلااستفاده)، اما Backup برای خیال راحت الزامی است.
- **هرگز** `prisma migrate reset` اجرا نکن.

## ۲) سرویس‌های لازم در Railway

| سرویس | نوع | نکته |
|---|---|---|
| `mahyar-gap` | Web Service (Deploy from GitHub repo) | Railway خودش `railway.json` را می‌بیند → Dockerfile build |
| `postgres` | PostgreSQL | همان دیتابیس فعلی یا جدید |
| `bucket` | Storage (S3-compatible) | **Private** — فقط برای پیوست‌های چت |

Radio Worker سرویس جداگانه **نخواهد بود** — داخل همان Web Service به‌صورت Child Process تنبل اجرا می‌شود.

## ۳) Variables سرویس Web

باید این متغیرها تنظیم شوند (مقادیر واقعی، نه چیزی که در فایل‌ها باشد):

| متغیر | مقدار |
|---|---|
| `DATABASE_URL` | **Reference** به `${{postgres.DATABASE_URL}}` |
| `JWT_ACCESS_SECRET` | رشته تصادفی ≥۳۲ کاراکتر — `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `LIVEKIT_URL` | `wss://xxxx.livekit.cloud` (از LiveKit Cloud) |
| `LIVEKIT_API_KEY` | از LiveKit Cloud |
| `LIVEKIT_API_SECRET` | از LiveKit Cloud |
| `AWS_ENDPOINT_URL` | **Reference** به Bucket |
| `AWS_ACCESS_KEY_ID` | **Reference** به Bucket |
| `AWS_SECRET_ACCESS_KEY` | **Reference** به Bucket |
| `AWS_S3_BUCKET_NAME` | **Reference** به Bucket (شناسه‌ی باکت، نه نام نمایشی) |
| `AWS_DEFAULT_REGION` | از تب Credentials باکت (یا `auto`) |
| `AWS_S3_URL_STYLE` | فقط اگر Credentials گفت `path` |
| `RADIO_ENABLED` | `true` |
| `RADIO_IDLE_SHUTDOWN_MS` | `30000` |
| `RADIO_MAX_ACTIVE_ROOMS` | `1` |
| `NODE_ENV` | `production` |

اختیاری: `CORS_ORIGIN` (اگر دامنه جدا دارد)، `ACCESS_TOKEN_TTL_SECONDS` (پیش‌فرض ۹۰۰)، `REFRESH_TOKEN_TTL_DAYS` (پیش‌فرض ۳۰)، `RADIO_HEARTBEAT_TIMEOUT_MS` (پیش‌فرض ۴۵۰۰۰).

## ۴) Deploy و بررسی‌ها

1. Push به GitHub → CI (`.github/workflows/ci.yml`) باید سبز شود: typecheck، build، تست، اعمال Migration روی Postgres خالی، چک نحوی پایتون.
2. در Railway دکمه **Deploy** را بزن. لاگ Build باید نشان دهد:
   - `npm install`، `prisma generate`، build API و Web، ساخت `/opt/radio-venv` با `livekit-rtc`، نصب `ffmpeg`.
3. در لاگ Deploy (Start) باید ببینی:
   - چند خط `migration applied` (شامل `20261105000000_radio_rebuild`) — این Migration تبدیل داده + حذف جدول‌های موسیقی را انجام می‌دهد.
   - بعد: `mahyar-gap api listening {"radioEnabled":true,...}`.
4. Healthcheck: `https://<your-app>.up.railway.app/api/health` → `{"status":"ok","radio_active_rooms":0,...}`
   - `radio_active_rooms: 0` یعنی **هیچ Worker رادیویی در Boot اجرا نشده** ✓ (معیار پذیرش ۱)
5. صفحه‌ی اصلی را باز کن → صفحه‌ی ورود → ثبت‌نام/ورود.

## ۵) تست‌های پذیرش رادیو (دو مرورگر)

1. دو مرورگر با دو حساب مختلف وارد یک Voice Room شوند → صدای همدیگر را بشنوند.
2. یکی روی یک ایستگاه رادیو بزند → **Participant جدیدی به نام `Mahyar Radio` در همان اتاق ظاهر شود** و صدای رادیو در هر دو مرورگر پخش شود (این از مسیر LiveKit است، نه UI).
3. یک نفر `Souls` را انتخاب کند → ایستگاه در هر دو مرورگر عوض شود.
4. Micro و رادیو هم‌زمان کار کنند.
5. Volume رادیو را برای یک کاربر کم کن → صدای کاربر دیگر تغییری نکند.
6. Stop بزنی → صدای هر دو قطع و `Mahyar Radio` از اتاق خارج شود.
7. یکی خارج شود، دیگری بماند → رادیو ادامه یابد.
8. آخرین نفر خارج شود → ۳۰ ثانیه بعد در لاگ: `radio idle shutdown` و `radio session removed`؛ در Health: `radio_active_rooms: 0`.
9. بعد از این چرخه، مصرف CPU/RAM سرویس به حالت قبل از پخش برگردد (هیچ FFmpeg فعالی نماند).

## ۶) تست‌های چت/Voice

- پیام از مرورگر ۱ → ظاهرشدن لحظه‌ای در مرورگر ۲ → ماندن پیام بعد از Refresh.
- Reply/Edit/Delete/Reaction/Pin.
- پیوست (عکس/فایل ≤50MB) → آپلود و دانلود با کلیلک؛ فایل غیرمجاز رد شود.
- کانال خصوصی → کاربر غیرمجاز آن را نمی‌بیند.
- Mute/Deafen/Camera/Screen Share بین دو مرورگر.
- قطع کوتاه اینترنت → Reconnect خودکار Voice.

## ۷) اگر خطا دیدی

| خطا | معنی / راه حل |
|---|---|
| `RADIO_NOT_CONFIGURED` در UI | `LIVEKIT_*` را در Variables تنظیم نکرده‌ای |
| `FILE_STORAGE_NOT_CONFIGURED` | متغیرهای `AWS_*` باکت را Reference نکرده‌ای |
| Deploy fail در Migration | لاگ Railway را بفرست؛ Migration تراکنشی است و داده را خراب نکرده |
| `RADIO_CAPACITY_FULL` | یک اتاق دیگر رادیو فعال دارد (`RADIO_MAX_ACTIVE_ROOMS=1`) — یا متغیر را افزایش بده |
| صدای رادیو نیست ولی LIVE است | Worker لاگ `[radio-worker:...]` را در Logs Railway چک کن؛ احتمال بسته‌بودن خروجی به RadioX از سمت Railway نادر است — گزارش بده |

## ۸) محل پاک‌سازی اختیاری

فایل‌های صوتی آپلودی نسخه قبلی در باکت زیر پوشه‌ی `music/` بی‌استفاده شده‌اند. بعد از چند روز که مطمئن شدی به آن‌ها نیاز نداری، می‌توانی از داشبورد باکت پوشه‌ی `music/` را حذف کنی (فضای باکت آزاد می‌شود). پیوست‌های چت زیر `YYYY-MM-DD/...` هستند — دست نزن.
