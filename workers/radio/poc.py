"""Mahyar Radio — standalone Proof of Concept.

Publishes one RadioX station into a LiveKit room as a real participant so
audio can be verified in a browser before the full integration runs.

Prerequisites (any machine or the Railway container shell):
  - python3, ffmpeg + ffprobe on PATH
  - pip install livekit-rtc livekit-api

Usage:
  python3 poc.py \
    --livekit-url wss://your-project.livekit.cloud \
    --api-key APIKeyXXXX --api-secret Yyyy... \
    --room poc-radio-room \
    --stream-url https://stream.radiox.pro/listen/popularfa/radio.mp3 \
    --duration 60

Then open the LiveKit browser playground (or any client) on the same room and
confirm: audio is audible, participant shows as poc-radio, Ctrl+C stops
cleanly and the participant leaves.
"""

import argparse
import asyncio
import contextlib

from livekit import rtc
from livekit_api import AccessToken as ApiAccessToken

from stream_decoder import StreamDecoder
from protocol import log


async def run(args: argparse.Namespace) -> int:
    token_builder = ApiAccessToken(args.api_key, args.api_secret)
    token_builder.with_identity(args.identity).with_name("Mahyar Radio POC").with_grants(
        room_join=True,
        room=args.room,
        can_publish=True,
        can_publish_sources=["microphone"],
        can_subscribe=False,
    )
    token = token_builder.to_jwt()

    room = rtc.Room()
    await room.connect(args.livekit_url, token)
    log(f"connected to room '{room.name}' as '{room.local_participant.identity}'")

    source = rtc.AudioSource(48_000, 2)
    track = rtc.LocalAudioTrack.create_audio_track("Mahyar Radio POC", source)
    await room.local_participant.publish_track(
        track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    )
    log("track published — open the room in a browser to listen")

    decoder = StreamDecoder(args.stream_url, label="poc")
    await decoder.start()
    if not await decoder.wait_healthy(timeout=20):
        log("FATAL: stream did not become healthy — see stderr for ffprobe/ffmpeg output")
        await decoder.stop()
        await room.disconnect()
        return 1
    log("stream healthy — publishing PCM")

    async def pump() -> None:
        while True:
            frame_bytes = await decoder.next_frame()
            if not frame_bytes:
                continue
            frame = rtc.AudioFrame(
                data=frame_bytes, sample_rate=48_000, num_channels=2, samples_per_channel=480
            )
            await source.capture_frame(frame)

    pump_task = asyncio.create_task(pump())
    try:
        await asyncio.sleep(args.duration)
    except asyncio.CancelledError:
        pass
    finally:
        pump_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await pump_task
        await decoder.stop()
        await room.disconnect()
    log("POC finished cleanly (participant left, ffmpeg killed)")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Mahyar Radio LiveKit publish POC")
    parser.add_argument("--livekit-url", required=True)
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--api-secret", required=True)
    parser.add_argument("--room", default="poc-radio-room")
    parser.add_argument("--identity", default="poc-radio")
    parser.add_argument(
        "--stream-url", default="https://stream.radiox.pro/listen/popularfa/radio.mp3"
    )
    parser.add_argument("--duration", type=int, default=60)
    args = parser.parse_args()

    try:
        code = asyncio.run(run(args))
    except KeyboardInterrupt:
        code = 0
    raise SystemExit(code)


if __name__ == "__main__":
    main()
