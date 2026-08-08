// ---- The "engine" itself: taste pool assembly + mixing logic ----
// No /recommendations endpoint exists anymore, so discovery here is honest:
// candidates are split into a "known" pool (top tracks, saved tracks,
// recently played) and a "fresh" pool (deep cuts from artists you listen
// to that you haven't saved), and a user-adjustable ratio decides which
// pool each pick comes from. You can also add manual "seed" artists.

const STATION_STORAGE_KEYS = {
  history: "station_history", // recently queued URIs, oldest first
  seeds: "station_seed_artists", // manually added artist names -> id
  newRatio: "station_new_ratio" // 0-1 share of picks pulled from the fresh pool
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

// Picks a reasonably-sized thumbnail from a Spotify images array (sorted
// largest-first); falls back to whatever's available, or "" if none.
function albumImage(images) {
  if (!images || images.length === 0) return "";
  return images[1]?.url || images[0]?.url || images[images.length - 1]?.url || "";
}

const Station = {
  knownPool: [], // { uri, name, artist, image } - top tracks, saved tracks, recently played
  freshPool: [], // { uri, name, artist, image } - deep cuts you haven't saved
  originByUri: {}, // uri -> "known" | "fresh", so re-renders after a poll can still badge correctly

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

  getNewRatio() {
    return loadJSON(STATION_STORAGE_KEYS.newRatio, CONFIG.NEW_TRACK_RATIO);
  },
  setNewRatio(ratio) {
    saveJSON(STATION_STORAGE_KEYS.newRatio, Math.max(0, Math.min(1, ratio)));
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

  removeSeedArtist(id) {
    const seeds = this.getSeedArtists().filter((s) => s.id !== id);
    saveJSON(STATION_STORAGE_KEYS.seeds, seeds);
  },

  // Pull a handful of tracks from an artist's albums (deep cuts, not just hits,
  // since Get Artist's Top Tracks was removed in Feb 2026).
  async tracksForArtist(artistId, maxAlbums = 2, maxTracksPerAlbum = 4) {
    const out = [];
    try {
      const albums = await Spotify.getArtistAlbums(artistId, maxAlbums);
      for (const album of albums?.items || []) {
        // The album-tracks endpoint returns simplified track objects with
        // no per-track album/image data, so carry the album's own image
        // down onto each track here.
        const image = albumImage(album.images);
        const tracks = await Spotify.getAlbumTracks(album.id, maxTracksPerAlbum);
        for (const t of tracks?.items || []) {
          out.push({ uri: t.uri, name: t.name, artist: t.artists?.[0]?.name || "", image });
        }
      }
    } catch (e) {
      this.log(`Couldn't pull catalog for artist ${artistId}: ${e.message}`);
    }
    return out;
  },

  // Assemble the "known" pool (things you already listen to) and the
  // "fresh" pool (deep cuts from those same artists that you haven't
  // saved) separately, so pickNext can weight between them.
  async buildPools() {
    const known = [];
    const seenKnown = new Set();
    const addKnown = (items) => {
      for (const t of items) {
        if (t?.uri && !seenKnown.has(t.uri)) {
          seenKnown.add(t.uri);
          known.push(t);
        }
      }
    };

    // Top tracks across time ranges, for a mix of old favorites + current rotation
    for (const range of ["short_term", "medium_term", "long_term"]) {
      try {
        const top = await Spotify.getTopItems("tracks", range, 10);
        addKnown(
          (top?.items || []).map((t) => ({
            uri: t.uri,
            name: t.name,
            artist: t.artists?.[0]?.name || "",
            image: albumImage(t.album?.images)
          }))
        );
      } catch (e) {
        this.log(`Top tracks (${range}) unavailable: ${e.message}`);
      }
    }

    // Saved (liked) tracks
    try {
      const saved = await Spotify.getSavedTracks(50);
      addKnown(
        (saved?.items || []).map((i) => ({
          uri: i.track?.uri,
          name: i.track?.name,
          artist: i.track?.artists?.[0]?.name || "",
          image: albumImage(i.track?.album?.images)
        }))
      );
    } catch (e) {
      this.log(`Saved tracks unavailable: ${e.message}`);
    }

    // Recently played
    try {
      const recent = await Spotify.getRecentlyPlayed(20);
      addKnown(
        (recent?.items || []).map((i) => ({
          uri: i.track?.uri,
          name: i.track?.name,
          artist: i.track?.artists?.[0]?.name || "",
          image: albumImage(i.track?.album?.images)
        }))
      );
    } catch (e) {
      this.log(`Recently played unavailable: ${e.message}`);
    }

    // Deep cuts from top artists' + seed artists' catalogs - candidates
    // for the "fresh" pool, pending a saved-status check below.
    const deepCuts = [];
    const seenDeep = new Set();
    const addDeep = (items) => {
      for (const t of items) {
        if (t?.uri && !seenKnown.has(t.uri) && !seenDeep.has(t.uri)) {
          seenDeep.add(t.uri);
          deepCuts.push(t);
        }
      }
    };

    try {
      const topArtists = await Spotify.getTopItems("artists", "medium_term", 5);
      for (const artist of topArtists?.items || []) {
        addDeep(await this.tracksForArtist(artist.id));
      }
    } catch (e) {
      this.log(`Top artists unavailable: ${e.message}`);
    }

    for (const seed of this.getSeedArtists()) {
      addDeep(await this.tracksForArtist(seed.id));
    }

    // A deep cut can be saved even if it wasn't on the first page of Liked
    // Songs above - double check against your library so "fresh" really
    // means "not saved," not just "not on the first 50."
    const fresh = await this.filterUnsaved(deepCuts);

    this.knownPool = known;
    this.freshPool = fresh;
    return { known, fresh };
  },

  // Splits tracks into "not in your library" by batching /me/tracks/contains
  // (max 50 ids/call). On failure, assumes unsaved rather than blocking
  // discovery on a flaky request.
  async filterUnsaved(tracks) {
    const savedFlags = [];
    for (let i = 0; i < tracks.length; i += 50) {
      const batch = tracks.slice(i, i + 50);
      const ids = batch.map((t) => t.uri.split(":").pop());
      try {
        const result = await Spotify.checkSavedTracks(ids);
        savedFlags.push(...(result || batch.map(() => false)));
      } catch (e) {
        this.log(`Saved-status check unavailable: ${e.message}`);
        savedFlags.push(...batch.map(() => false));
      }
    }
    return tracks.filter((_, i) => !savedFlags[i]);
  },

  // Picks one track from a pool, preferring ones not queued too recently
  // but falling back to the full pool if everything in it was recent.
  pickFromPool(pool) {
    const notRecent = pool.filter((t) => !this.wasRecentlyPlayed(t.uri));
    const source = notRecent.length > 0 ? notRecent : pool;
    if (source.length === 0) return null;
    return source[Math.floor(Math.random() * source.length)];
  },

  // Pick the next track to queue, weighted by the new/familiar ratio,
  // always avoiding anything queued too recently.
  pickNext() {
    const wantFresh = Math.random() < this.getNewRatio();
    let origin = wantFresh ? "fresh" : "known";
    let track = this.pickFromPool(wantFresh ? this.freshPool : this.knownPool);

    if (!track) {
      // The preferred pool is empty - fall back to the other rather than
      // playing nothing.
      origin = wantFresh ? "known" : "fresh";
      track = this.pickFromPool(wantFresh ? this.knownPool : this.freshPool);
    }
    if (!track) return null;

    if (origin === "fresh") {
      this.freshPool = this.freshPool.filter((t) => t.uri !== track.uri);
    } else {
      this.knownPool = this.knownPool.filter((t) => t.uri !== track.uri);
    }
    this.originByUri[track.uri] = origin;

    return { ...track, origin };
  },

  async refillPools() {
    await this.buildPools();
  }
};
