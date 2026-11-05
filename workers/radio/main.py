"""Mahyar Radio worker — one process per voice room, spawned lazily.

Lifecycle (protocol with the Node manager, see protocol.py):
  1. Read the `init` message (room, LiveKit token, first station).
  2. Connect to LiveKit, publish the bot audio track.
  3. Decode the station HTTP stream with FFmpeg into paced PCM frames.
  4. `switch` warms a NEW decoder first; only after it produces healthy audio
     does it replace the current feed (old stream is never mixed in).
  5. `stop` / stdin EOF / fatal stream error -> full cleanup and exit.

The process never runs at boot: it exists only while a room plays radio.
"""

import asyncio
import contextlib
import signal
import sys
import threading

from protocol import log, parse_message, read_line, send_message
from stream_decoder import StreamDecoder
from livekit_publisher import RadioPublisher

STATION_HEALTH_TIMEOUT = 20.0
HEARTBEAT_SECONDS = 5.0


class RadioSession:
    """Owns the publisher + the currently playing decoder."""

    def __init__(self) -> None:
        self.publisher = RadioPublisher()
        self.current: "StreamDecoder | None" = None
        self.pump_task: "asyncio.Task | None" = None
        self.station_id: "str | None" = None
        self.live_announced_station: "str | None" = None

    async def start_station(self, station_id: str, station_url: str, announce_live: bool) -> bool:
        """Start a decoder; returns True when healthy audio is flowing."""
        decoder = StreamDecoder(station_url, label=station_id)
        await decoder.start()
        healthy = await decoder.wait_healthy(timeout=STATION_HEALTH_TIMEOUT)
        if not healthy or not decoder.running:
            message = decoder.fatal_message or f"Station '{station_id}' did not produce audio in time."
            await decoder.stop()
            send_message({"type": "error", "message": message, "fatal": not self.current, "station_id": station_id})
            return False
        previous = self.current
        self.current = decoder
        if previous and previous is not decoder:
            await previous.stop()
        self.station_id = station_id
        if announce_live and self.live_announced_station != station_id:
            self.live_announced_station = station_id
            send_message({"type": "live", "station_id": station_id})
        return True

    async def ensure_pump(self) -> None:
        if self.pump_task is None or self.pump_task.done():
            self.pump_task = asyncio.create_task(self.publisher.publish_loop(lambda: self.current))

    async def stop_all(self) -> None:
        if self.pump_task:
            self.pump_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.pump_task
            self.pump_task = None
        if self.current:
            await self.current.stop()
            self.current = None
        await self.publisher.disconnect()


async def heartbeat_loop(session: RadioSession) -> None:
    """Report human listener counts (LiveKit truth) every 5s and on changes."""
    while True:
        humans = session.publisher.human_count()
        send_message({"type": "status", "humans": humans})
        await session.publisher.wait_participants_changed(timeout=HEARTBEAT_SECONDS)


async def run() -> None:
    loop = asyncio.get_running_loop()
    commands: asyncio.Queue = asyncio.Queue()

    def _stdin_reader() -> None:
        while True:
            line = read_line()
            if line is None:
                loop.call_soon_threadsafe(commands.put_nowait, {"type": "stop", "reason": "stdin_eof"})
                return
            message = parse_message(line)
            if message:
                loop.call_soon_threadsafe(commands.put_nowait, message)

    threading.Thread(target=_stdin_reader, daemon=True).start()

    first = await commands.get()
    if first.get("type") != "init":
        send_message({"type": "error", "message": "first message must be init", "fatal": True})
        return

    session = RadioSession()
    session.station_id = first.get("station_id")
    room_id = first.get("room_id")
    try:
        await session.publisher.connect(first["livekit_url"], first["token"])
    except Exception as error:  # noqa: BLE001
        log(f"livekit connect failed: {error!r}")
        send_message({"type": "error", "message": f"Could not join the LiveKit room: {error}", "fatal": True})
        return

    send_message({"type": "ready"})
    if not await session.start_station(first["station_id"], first["station_url"], announce_live=True):
        await session.stop_all()
        return
    await session.ensure_pump()

    heartbeat_task = asyncio.create_task(heartbeat_loop(session))
    exiting_reason = "stop"

    try:
        while True:
            command = await commands.get()
            command_type = command.get("type")
            if command_type == "stop":
                exiting_reason = command.get("reason", "stop")
                break
            if command_type == "switch":
                station_id = str(command.get("station_id"))
                station_url = str(command.get("station_url"))
                send_message({"type": "switching", "station_id": station_id})
                ok = await session.start_station(station_id, station_url, announce_live=True)
                if ok:
                    log(f"station switched to {station_id}")
            elif command_type == "init":
                send_message({"type": "error", "message": "already initialized", "fatal": False})
    finally:
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task
        await session.stop_all()

    send_message({"type": "exited", "reason": exiting_reason})
    log(f"worker exiting ({exiting_reason})")


def main() -> None:
    stop_event = asyncio.Event()

    def _on_signal(*_args) -> None:
        stop_event.set()

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError, ValueError):
            loop.add_signal_handler(sig, _on_signal)

    try:
        loop.run_until_complete(run())
    except KeyboardInterrupt:
        pass
    finally:
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        finally:
            loop.close()
    sys.exit(0)


if __name__ == "__main__":
    main()
