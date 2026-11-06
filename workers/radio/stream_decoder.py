"""HTTP radio stream -> PCM frames via FFmpeg.

Design goals (per project requirements):
  - Never trust the URL extension: FFmpeg probes the actual container/codec,
    and ffprobe is used once to log the real codec (RadioX reports
    audio/aac despite .mp3 paths).
  - Bounded buffering: the frame queue holds ~1s of audio; backpressure flows
    into the OS pipe and stalls FFmpeg instead of growing memory.
  - Bounded reconnects with exponential backoff; fatal after the last attempt.
  - Correct pacing: 10 ms frames (480 samples/channel @ 48 kHz, s16le stereo).
"""

import asyncio
import contextlib
import json
import time

SAMPLE_RATE = 48_000
NUM_CHANNELS = 2
MS_PER_FRAME = 10
SAMPLES_PER_FRAME = SAMPLE_RATE * MS_PER_FRAME // 1000  # 480
BYTES_PER_SAMPLE = 2
FRAME_BYTES = SAMPLES_PER_FRAME * NUM_CHANNELS * BYTES_PER_SAMPLE  # 1920
# ~1 second of audio in the queue; the OS pipe adds ~0.3s of natural buffer.
QUEUE_MAX_FRAMES = 100

RECONNECT_BACKOFF_SECONDS = [1, 2, 4, 8, 15, 30]
HEALTHY_RESET_AFTER_FRAMES = 200  # ~2s of continuous audio resets the backoff


def ffmpeg_args(url: str) -> list:
    return [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-reconnect",
        "1",
        "-reconnect_streamed",
        "1",
        "-reconnect_delay_max",
        "10",
        "-user_agent",
        "MahyarRadio/1.0",
        "-i",
        url,
        "-map",
        "a:0",
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        str(SAMPLE_RATE),
        "-ac",
        str(NUM_CHANNELS),
        "-f",
        "s16le",
        "pipe:1",
    ]


async def probe_codec(url: str) -> "str | None":
    """Detect the real audio codec with ffprobe (never trust the extension)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe",
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-select_streams",
            "a:0",
            url,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=20)
        if proc.returncode != 0 or not stdout:
            return None
        info = json.loads(stdout.decode("utf-8", "replace"))
        streams = info.get("streams") or []
        codec = streams[0].get("codec_name") if streams else None
        return codec
    except (asyncio.TimeoutError, json.JSONDecodeError, OSError, IndexError):
        return None


class StreamDecoder:
    """Decodes one station URL into 10ms PCM frames with bounded reconnects."""

    def __init__(self, url: str, label: str = "stream"):
        self.url = url
        self.label = label
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAX_FRAMES)
        self.healthy_event = asyncio.Event()
        self.fatal_message: "str | None" = None
        self._running = False
        self._task: "asyncio.Task | None" = None
        self._proc: "asyncio.subprocess.Process | None" = None
        self._last_frame_ts = time.monotonic()
        self._watchdog: "asyncio.Task | None" = None

    async def start(self) -> None:
        self._running = True
        self._task = asyncio.create_task(self._run())
        self._watchdog = asyncio.create_task(self._stall_watchdog())
        codec = await probe_codec(self.url)
        if codec:
            import protocol

            protocol.log(f"[{self.label}] ffprobe detected codec: {codec}")
        else:
            import protocol

            protocol.log(f"[{self.label}] ffprobe could not detect a codec — relying on ffmpeg probing")

    async def next_frame(self) -> bytes:
        """Await the next 1920-byte PCM frame (10ms @ 48kHz stereo)."""
        return await self.queue.get()

    @property
    def running(self) -> bool:
        return self._running

    async def stop(self) -> None:
        self._running = False
        self.healthy_event.clear()
        if self._watchdog:
            self._watchdog.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._watchdog
            self._watchdog = None
        if self._proc and self._proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                self._proc.kill()
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        # Unblock any consumer waiting on the queue.
        with contextlib.suppress(asyncio.QueueFull):
            self.queue.put_nowait(b"")

    async def wait_healthy(self, timeout: float = 20.0) -> bool:
        try:
            await asyncio.wait_for(self.healthy_event.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            return False


    async def _stall_watchdog(self) -> None:
        """Restart FFmpeg when the stream stalls without exiting.

        RadioX sometimes stops sending data without closing the connection:
        FFmpeg stays alive but produces no frames, so the reconnect-on-exit
        path never triggers. A >12s frame gap is treated as a stall — the
        process is killed and the normal reconnect-with-backoff path runs.
        """
        while self._running:
            await asyncio.sleep(4)
            if not self._running or self._proc is None:
                continue
            if self.healthy_event.is_set() and (time.monotonic() - self._last_frame_ts) > 12:
                import protocol

                protocol.log(f"[{self.label}] stream stalled (>12s without frames) — restarting ffmpeg")
                with contextlib.suppress(ProcessLookupError):
                    self._proc.kill()
                return  # _run notices the exit and reconnects

    # -- internals ----------------------------------------------------------

    async def _run(self) -> None:
        attempt = 0
        frames_since_reset = 0
        while self._running:
            try:
                proc = await asyncio.create_subprocess_exec(
                    *ffmpeg_args(self.url),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                self._proc = proc
                self._last_frame_ts = time.monotonic()
                stderr_task = asyncio.create_task(self._drain_stderr(proc))
                buffer = b""
                produced_any = False
                try:
                    while self._running:
                        chunk = await proc.stdout.read(65_536)
                        if not chunk:
                            break
                        buffer += chunk
                        while len(buffer) >= FRAME_BYTES and self._running:
                            frame = buffer[:FRAME_BYTES]
                            buffer = buffer[FRAME_BYTES:]
                            # Await the bounded queue: backpressure reaches FFmpeg
                            # through the OS pipe instead of growing memory.
                            await self.queue.put(frame)
                            self._last_frame_ts = time.monotonic()
                            produced_any = True
                            frames_since_reset += 1
                            if not self.healthy_event.is_set():
                                self.healthy_event.set()
                            if frames_since_reset >= HEALTHY_RESET_AFTER_FRAMES:
                                attempt = 0
                                frames_since_reset = 0
                finally:
                    stderr_task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await stderr_task

                if not self._running:
                    with contextlib.suppress(ProcessLookupError):
                        proc.kill()
                    return

                # FFmpeg exited (EOF / network error / decode error).
                code = proc.returncode
                import protocol

                protocol.log(f"[{self.label}] ffmpeg exited (code={code}) — reconnecting")
                if produced_any:
                    attempt = 0  # stream worked; reset backoff for the next failure
                if attempt >= len(RECONNECT_BACKOFF_SECONDS):
                    self.fatal_message = (
                        f"Stream '{self.label}' kept dropping — giving up after "
                        f"{attempt} reconnect attempts."
                    )
                    self._running = False
                    return
                delay = RECONNECT_BACKOFF_SECONDS[attempt]
                attempt += 1
                await asyncio.sleep(delay)
            except asyncio.CancelledError:
                return
            except Exception as error:  # noqa: BLE001 — worker must never crash silently
                import protocol

                protocol.log(f"[{self.label}] decoder error: {error!r}")
                if attempt >= len(RECONNECT_BACKOFF_SECONDS):
                    self.fatal_message = f"Stream '{self.label}' decoder failed permanently: {error!r}"
                    self._running = False
                    return
                await asyncio.sleep(RECONNECT_BACKOFF_SECONDS[attempt])
                attempt += 1

    async def _drain_stderr(self, proc: asyncio.subprocess.Process) -> None:
        import protocol

        try:
            while True:
                line = await proc.stderr.readline()
                if not line:
                    return
                text = line.decode("utf-8", "replace").strip()
                if text:
                    protocol.log(f"[{self.label}] ffmpeg: {text}")
        except (asyncio.CancelledError, ValueError):
            return
