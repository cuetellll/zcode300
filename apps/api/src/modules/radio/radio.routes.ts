import { Router } from 'express';
import { RADIO_STATIONS, publicStation } from '../../config/radio-stations';
import { asyncHandler } from '../../lib/errors';
import { requireAuth, getUserId } from '../../middleware/auth';
import { requireChannelAccess } from '../../middleware/permissions';
import { radioManager } from './radio.context';

export const radioRouter = Router();

/** Public station catalog. Stream URLs are intentionally NOT included. */
radioRouter.get(
  '/stations',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({
      enabled: radioManager.enabled,
      stations: RADIO_STATIONS.map(publicStation),
    });
  }),
);

/** Current radio state snapshot for a voice room (empty state when never started). */
radioRouter.get(
  '/state',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const channelId = String(req.query.channel_id ?? '');
    const channel = await requireChannelAccess(userId, channelId);
    if (channel.type !== 'VOICE') {
      res.json({ channel_id: channelId, status: 'stopped', station_id: null, station_title: null, listeners: 0, error: null });
      return;
    }
    res.json(
      radioManager.getPublicState(channelId) ?? {
        channel_id: channelId,
        server_id: channel.serverId,
        status: 'stopped',
        station_id: null,
        station_title: null,
        listeners: 0,
        error: null,
      },
    );
  }),
);
