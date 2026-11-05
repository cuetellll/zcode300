import { RadioWorkerManager } from '../../workers/radio-worker-manager';
import { emitToRadioRoom } from '../../realtime/socket-bus';

/**
 * Process-wide radio manager singleton. Broadcasting goes to the
 * `radio:<channelId>` socket room, which voice-room members join
 * automatically when they connect to a voice channel.
 */
export const radioManager = new RadioWorkerManager((channelId, state) => {
  emitToRadioRoom(channelId, 'radio:state', state);
});
