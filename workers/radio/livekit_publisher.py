"""LiveKit publishing for the Mahyar Radio bot participant.

The bot joins the voice room as a real participant (identity
`mahyar-radio-<channelId>`) and publishes a single microphone-source audio
track. PCM frames are fed through rtc.AudioSource; `capture_frame` paces
playback to real time (10ms frames).

Human listener counting uses LiveKit participant lists — the bot's own
identity (and any other radio bot) is excluded.
"""

import asyncio
import contextlib

from livekit import rtc

from protocol import log

SAMPLE_RATE = 48_000
NUM_CHANNELS = 2
SAMPLES_PER_FRAME = 480  # 10ms


def is_radio_bot_identity(identity: str) -> bool:
    return identity.startswith("mahyar-radio-")


class RadioPublisher:
    def __init__(self) -> None:
        self.room: "rtc.Room | None" = None
        self._participants_changed: "asyncio.Event | None" = None
        self._track: "rtc.LocalAudioTrack | None" = None
        self._source: "rtc.AudioSource | None" = None

    async def connect(self, url: str, token: str) -> None:
        self.room = rtc.Room()
        self._participants_changed = asyncio.Event()

        def _on_participant_change(_participant=None):
            if self._participants_changed:
                self._participants_changed.set()

        self.room.on("participant_connected")(_on_participant_change)
        self.room.on("participant_disconnected")(_on_participant_change)
        await self.room.connect(url, token)
        log(f"connected to livekit room '{self.room.name}' as '{self.room.local_participant.identity}'")

    def human_count(self) -> int:
        if not self.room:
            return 0
        return sum(
            1
            for participant in self.room.remote_participants.values()
            if not is_radio_bot_identity(participant.identity or "")
        )

    async def wait_participants_changed(self, timeout: float) -> bool:
        if not self._participants_changed:
            return False
        try:
            await asyncio.wait_for(self._participants_changed.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            return False
        finally:
            if self._participants_changed:
                self._participants_changed.clear()

    async def publish_loop(self, get_decoder):
        """Publish the audio track and pump frames from the active decoder.

        `get_decoder` is a callable returning the current StreamDecoder, so a
        station switch swaps the feed without republishing the track.
        """
        if not self.room:
            raise RuntimeError("publisher not connected")
        self._source = rtc.AudioSource(SAMPLE_RATE, NUM_CHANNELS)
        self._track = rtc.LocalAudioTrack.create_audio_track("Mahyar Radio", self._source)
        await self.room.local_participant.publish_track(
            self._track,
            rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
        )
        log("radio audio track published")
        while True:
            decoder = get_decoder()
            if decoder is None:
                await asyncio.sleep(0.05)
                continue
            frame_bytes = await decoder.next_frame()
            if not frame_bytes:
                continue  # decoder stopped / unblocked
            frame = rtc.AudioFrame(
                data=frame_bytes,
                sample_rate=SAMPLE_RATE,
                num_channels=NUM_CHANNELS,
                samples_per_channel=SAMPLES_PER_FRAME,
            )
            await self._source.capture_frame(frame)

    async def disconnect(self) -> None:
        self._source = None
        self._track = None
        if self.room:
            with contextlib.suppress(Exception):
                await self.room.disconnect()
            self.room = None
        log("disconnected from livekit")
