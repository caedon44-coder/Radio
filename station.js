// ---- The "station" itself: taste pool assembly + mixing logic ----
// No /recommendations endpoint exists anymore, so discovery here is honest:
// your top tracks + saved tracks + recently played + deep cuts pulled from
// your favorite artists' other albums, shuffled with memory, plus podcast
// episodes from shows you follow. You can also add manual "seed" artists.

const STATION_STORAGE_KEYS = {
  history: "station_history", // recently queued URIs, oldest first
  seeds: "station_seed_artists", // manually added artist names -> id
  episodeCursor: "station_episode_cursor", // per-show index of next unplayed episode
  ytSeeds: "station_yt_seeds", // manually added channels/playlists -> playlistId
  ytCursor: "station_yt_cursor" // per-playlist index of next unplayed video
};

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

const Station = {
  trackPool: [], // { uri, name, artist }
  episodePool: [], // { uri, name, show }
  ytPool: [], // { videoId, title, channelTitle, playlistId }
  tracksSincePodcast: 0,
  pendingYoutubeItem: null, // set once picked, cleared once actually playing
  playingYoutube: false,

  log(msg) {
    const el = document.getElementById("log");
    if (el) {
      el.textContent = msg + "\n" + el.textContent;
    }
    console.log(msg);
  },

  getHistory() {
    return loadJSON(STATION_STORAGE_KEYS.history, []);
  },
  remember(uri) {
    const hist = this.getHistory();
    hist.push(uri);
    while (hist.length > CONFIG.HISTORY_MEMORY) hist.shift();
    saveJSON(STATION_STORAGE_KEYS.history, hist);
  },
  wasRecentlyPlayed(uri) {
    return this.getHistory().includes(uri);
  },

  getSeedArtists() {
    return loadJSON(STATION_STORAGE_KEYS.seeds, []); // [{id, name}]
  },

  // Add a manually-named artist as a taste seed. Pulls their catalog in
  // alongside your existing top artists.
  async addSeedArtist(name) {
    const result = await Spotify.search(name, "artist", 5);
    const artist = result?.artists?.items?.[0];
    if (!artist) throw new Error(`No artist found for "${name}"`);

    const seeds = this.getSeedArtists();
    if (!seeds.some((s) => s.id === artist.id)) {
      seeds.push({ id: artist.id, name: artist.name });
      saveJSON(STATION_STORAGE_KEYS.seeds, seeds);
    }
    return artist.name;
  },

  getYtSeeds() {
    return loadJSON(STATION_STORAGE_KEYS.ytSeeds, []); // [{playlistId, title}]
  },

  // Add a YouTube channel or playlist as a long-form content seed.
  async addYtSeed(input) {
    const resolved = await YouTube.resolveSeed(input);

    const seeds = this.getYtSeeds();
    if (!seeds.some((s) => s.playlistId === resolved.playlistId)) {
      seeds.push(resolved);
      saveJSON(STATION_STORAGE_KEYS.ytSeeds, seeds);
    }
    return resolved.title;
  },

  // Pull a handful of tracks from an artist's albums (deep cuts, not just hits,
  // since Get Artist's Top Tracks was removed in Feb 2026).
  async tracksForArtist(artistId, maxAlbums = 2, maxTracksPerAlbum = 4) {
    const out = [];
    try {
      const albums = await Spotify.getArtistAlbums(artistId, maxAlbums);
      for (const album of albums?.items || []) {
        const tracks = await Spotify.getAlbumTracks(album.id, maxTracksPerAlbum);
        for (const t of tracks?.items || []) {
          out.push({ uri: t.uri, name: t.name, artist: t.artists?.[0]?.name || "" });
        }
      }
    } catch (e) {
      this.log(`Couldn't pull catalog for artist ${artistId}: ${e.message}`);
    }
    return out;
  },

  // Assemble the pool of candidate tracks from every taste source we have.
  async buildTrackPool() {
    const pool = [];
    const seenUris = new Set();
    const addAll = (items) => {
      for (const t of items) {
        if (t?.uri && !seenUris.has(t.uri)) {
          seenUris.add(t.uri);
          pool.push(t);
        }
      }
    };

    // Top tracks across time ranges, for a mix of old favorites + current rotation
    for (const range of ["short_term", "medium_term", "long_term"]) {
      try {
        const top = await Spotify.getTopItems("tracks", range, 10);
        addAll(
          (top?.items || []).map((t) => ({
            uri: t.uri,
            name: t.name,
            artist: t.artists?.[0]?.name || ""
          }))
        );
      } catch (e) {
        this.log(`Top tracks (${range}) unavailable: ${e.message}`);
      }
    }

    // Saved (liked) tracks
    try {
      const saved = await Spotify.getSavedTracks(20);
      addAll(
        (saved?.items || []).map((i) => ({
          uri: i.track?.uri,
          name: i.track?.name,
          artist: i.track?.artists?.[0]?.name || ""
        }))
      );
    } catch (e) {
      this.log(`Saved tracks unavailable: ${e.message}`);
    }

    // Recently played
    try {
      const recent = await Spotify.getRecentlyPlayed(20);
      addAll(
        (recent?.items || []).map((i) => ({
          uri: i.track?.uri,
          name: i.track?.name,
          artist: i.track?.artists?.[0]?.name || ""
        }))
      );
    } catch (e) {
      this.log(`Recently played unavailable: ${e.message}`);
    }

    // Deep cuts from top artists' catalogs
    try {
      const topArtists = await Spotify.getTopItems("artists", "medium_term", 5);
      for (const artist of topArtists?.items || []) {
        addAll(await this.tracksForArtist(artist.id));
      }
    } catch (e) {
      this.log(`Top artists unavailable: ${e.message}`);
    }

    // Manually seeded artists
    for (const seed of this.getSeedArtists()) {
      addAll(await this.tracksForArtist(seed.id));
    }

    this.trackPool = pool;
    return pool;
  },

  // Assemble the pool of candidate podcast episodes from followed shows.
  async buildEpisodePool() {
    const pool = [];
    const cursor = loadJSON(STATION_STORAGE_KEYS.episodeCursor, {});

    try {
      const shows = await Spotify.getSavedShows(20);
      for (const item of shows?.items || []) {
        const show = item.show;
        if (!show) continue;
        const episodes = await Spotify.getShowEpisodes(show.id, 10);
        const items = episodes?.items || [];
        if (items.length === 0) continue;

        // Play the show's episodes oldest-unplayed-first rather than always
        // the same latest episode.
        const idx = Math.min(cursor[show.id] || 0, items.length - 1);
        const ep = items[idx];
        if (ep?.uri) {
          pool.push({ uri: ep.uri, name: ep.name, show: show.name, showId: show.id });
        }
      }
    } catch (e) {
      this.log(`Saved shows unavailable: ${e.message}`);
    }

    this.episodePool = pool;
    return pool;
  },

  advanceEpisodeCursor(showId) {
    const cursor = loadJSON(STATION_STORAGE_KEYS.episodeCursor, {});
    cursor[showId] = (cursor[showId] || 0) + 1;
    saveJSON(STATION_STORAGE_KEYS.episodeCursor, cursor);
  },

  // Assemble the pool of candidate long-form videos from seeded channels/playlists.
  async buildYtPool() {
    const pool = [];
    if (!CONFIG.YT_API_KEY) {
      this.ytPool = pool;
      return pool;
    }

    const cursor = loadJSON(STATION_STORAGE_KEYS.ytCursor, {});
    const minSeconds = CONFIG.YT_MIN_DURATION_MINUTES * 60;

    for (const seed of this.getYtSeeds()) {
      try {
        const data = await YouTube.getPlaylistItems(seed.playlistId);
        const items = data?.items || [];
        if (items.length === 0) continue;

        const durations = await YouTube.getVideoDurations(
          items.map((i) => i.contentDetails.videoId)
        );
        const longform = items.filter(
          (i) => (durations[i.contentDetails.videoId] || 0) >= minSeconds
        );
        if (longform.length === 0) continue;

        // Oldest-unplayed-first, same pacing as podcast episode selection.
        const idx = Math.min(cursor[seed.playlistId] || 0, longform.length - 1);
        const video = longform[idx];
        pool.push({
          videoId: video.contentDetails.videoId,
          title: video.snippet.title,
          channelTitle: video.snippet.videoOwnerChannelTitle || seed.title,
          playlistId: seed.playlistId
        });
      } catch (e) {
        this.log(`YouTube seed "${seed.title}" unavailable: ${e.message}`);
      }
    }

    this.ytPool = pool;
    return pool;
  },

  advanceYtCursor(playlistId) {
    const cursor = loadJSON(STATION_STORAGE_KEYS.ytCursor, {});
    cursor[playlistId] = (cursor[playlistId] || 0) + 1;
    saveJSON(STATION_STORAGE_KEYS.ytCursor, cursor);
  },

  // Pick the next item to queue: mostly tracks, occasionally a long-form
  // item (podcast episode or YouTube video), always avoiding anything
  // queued too recently.
  pickNext() {
    this.tracksSincePodcast++;

    if (this.tracksSincePodcast >= CONFIG.LONGFORM_EVERY_N) {
      const candidates = [
        ...this.episodePool.map((item) => ({ type: "episode", item })),
        ...this.ytPool.map((item) => ({ type: "youtube", item }))
      ];

      if (candidates.length > 0) {
        const idx = Math.floor(Math.random() * candidates.length);
        const picked = candidates[idx];
        this.tracksSincePodcast = 0;

        if (picked.type === "episode") {
          this.episodePool = this.episodePool.filter((e) => e !== picked.item);
          this.advanceEpisodeCursor(picked.item.showId);
        } else {
          this.ytPool = this.ytPool.filter((v) => v !== picked.item);
          this.advanceYtCursor(picked.item.playlistId);
        }

        return picked;
      }
    }

    const fresh = this.trackPool.filter((t) => !this.wasRecentlyPlayed(t.uri));
    const source = fresh.length > 0 ? fresh : this.trackPool;
    if (source.length === 0) return null;

    const idx = Math.floor(Math.random() * source.length);
    const track = source[idx];
    this.trackPool = this.trackPool.filter((t) => t.uri !== track.uri);
    return { type: "track", item: track };
  },

  async refillPools() {
    await Promise.all([this.buildTrackPool(), this.buildEpisodePool(), this.buildYtPool()]);
  }
};
