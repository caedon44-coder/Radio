// ---- Thin wrapper around the YouTube Data API v3 endpoints we're allowed to use ----
// Deliberately avoids search.list (100 quota units/call) in favor of
// playlistItems.list / videos.list / channels.list (1 unit/call) so normal
// station refills stay well inside the 10k/day free quota.

const YT_API_BASE = "https://www.googleapis.com/youtube/v3";

async function ytFetch(path, params = {}) {
  if (!CONFIG.YT_API_KEY) throw new Error("No YouTube API key configured");

  const search = new URLSearchParams({ ...params, key: CONFIG.YT_API_KEY });
  const res = await fetch(`${YT_API_BASE}${path}?${search.toString()}`);

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`YouTube API ${res.status} on ${path}: ${errBody}`);
  }
  return res.json();
}

// Parses ISO-8601 durations like "PT45M12S" into whole seconds.
function parseIsoDuration(iso) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
  if (!match) return 0;
  const [, h, m, s] = match;
  return (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);
}

// Pulls the channel/playlist identifier out of a pasted URL, handle, or bare ID.
function parseSeedInput(input) {
  const trimmed = input.trim();

  const playlistMatch = trimmed.match(/[?&]list=([\w-]+)/);
  if (playlistMatch) return { kind: "playlist", value: playlistMatch[1] };
  if (/^PL[\w-]+$/.test(trimmed)) return { kind: "playlist", value: trimmed };

  const channelIdMatch = trimmed.match(/youtube\.com\/channel\/(UC[\w-]+)/);
  if (channelIdMatch) return { kind: "channelId", value: channelIdMatch[1] };
  if (/^UC[\w-]+$/.test(trimmed)) return { kind: "channelId", value: trimmed };

  const handleMatch = trimmed.match(/youtube\.com\/@([\w.-]+)/);
  if (handleMatch) return { kind: "handle", value: `@${handleMatch[1]}` };
  if (/^@[\w.-]+$/.test(trimmed)) return { kind: "handle", value: trimmed };

  // Fall back to treating it as a bare handle (e.g. "somechannel").
  return { kind: "handle", value: trimmed.startsWith("@") ? trimmed : `@${trimmed}` };
}

const YouTube = {
  // Resolves any supported seed input into { playlistId, title }, the
  // channel's "uploads" playlist when given a channel, or the playlist
  // itself when given a playlist directly.
  async resolveSeed(input) {
    const parsed = parseSeedInput(input);

    if (parsed.kind === "playlist") {
      const data = await ytFetch("/playlists", {
        part: "snippet",
        id: parsed.value
      });
      const item = data.items?.[0];
      if (!item) throw new Error(`No playlist found for "${input}"`);
      return { playlistId: parsed.value, title: item.snippet.title };
    }

    const channelParams =
      parsed.kind === "channelId"
        ? { id: parsed.value }
        : { forHandle: parsed.value };

    const data = await ytFetch("/channels", {
      part: "snippet,contentDetails",
      ...channelParams
    });
    const item = data.items?.[0];
    if (!item) throw new Error(`No channel found for "${input}"`);

    return {
      playlistId: item.contentDetails.relatedPlaylists.uploads,
      title: item.snippet.title
    };
  },

  async getPlaylistItems(playlistId, pageToken) {
    return ytFetch("/playlistItems", {
      part: "snippet,contentDetails",
      playlistId,
      maxResults: 15,
      ...(pageToken ? { pageToken } : {})
    });
  },

  // Batches up to 50 IDs per call, per the API's limit.
  async getVideoDurations(videoIds) {
    if (videoIds.length === 0) return {};
    const data = await ytFetch("/videos", {
      part: "contentDetails",
      id: videoIds.slice(0, 50).join(",")
    });
    const durations = {};
    for (const item of data.items || []) {
      durations[item.id] = parseIsoDuration(item.contentDetails.duration);
    }
    return durations;
  }
};
