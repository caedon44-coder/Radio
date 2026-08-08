// ---- UI controller ----

let selectedDeviceId = null;
let pollTimer = null;
let lastKnownPlayingUri = null; // used to detect when Spotify has moved on to a new track
let engineStarted = false; // true once Start Engine has completed successfully at least once
// Spotify's API has no way to delete an arbitrary track from the middle of
// the queue - the only queue-mutating operation it exposes is "skip to
// next." So "remove" on anything but the very next track is implemented as
// "auto-skip the moment it becomes current" - these are the URIs marked
// for that treatment. See toggleQueueRemoval().
let pendingSkipUris = new Set();
let lastQueueSnapshot = []; // the real Spotify queue as of the last poll, for rendering

const $ = (id) => document.getElementById(id);

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

// Builds an open.spotify.com link from a spotify:type:id URI, per Spotify's
// design guidelines requirement that displayed metadata link back to the
// Spotify service.
function spotifyOpenUrl(uri) {
  const parts = uri?.split(":");
  if (!parts || parts.length !== 3) return null;
  return `https://open.spotify.com/${parts[1]}/${parts[2]}`;
}

// ---- VU meter ----
// This app remote-controls Spotify on another device (Spotify Connect), so
// there's no audio stream in this browser tab to analyze - true waveform
// reactivity isn't possible here. Instead we pull the current track's actual
// tempo/energy from Spotify's audio-features endpoint and drive the bars off
// that. That endpoint is restricted to apps with extended API access as of
// late 2024, so on a Development Mode app (like this one, by design) it will
// likely 403 - in which case this quietly falls back to a fixed lively pulse
// rather than breaking.
let vuInterval = null;
let vuBpm = 100;
let vuEnergy = 0.5;
let isOnAir = false;
let lastVuUri = null;
const audioFeatureCache = {};

function trackIdFromUri(uri) {
  return uri ? uri.split(":").pop() : null;
}

function vuTick() {
  const min = 4;
  const max = 6 + vuEnergy * 20;
  document.querySelectorAll("#vu i").forEach((bar) => {
    bar.style.height = `${Math.round(min + Math.random() * (max - min))}px`;
  });
}

function startVu() {
  clearInterval(vuInterval);
  vuInterval = null;
  if (!isOnAir) return;
  vuTick();
  const beatMs = Math.max(90, 60000 / vuBpm / 2);
  vuInterval = setInterval(vuTick, beatMs);
}

function stopVu() {
  clearInterval(vuInterval);
  vuInterval = null;
  document.querySelectorAll("#vu i").forEach((bar) => { bar.style.height = "4px"; });
}

async function updateVuProfile(uri) {
  if (!uri || uri === lastVuUri) return;
  lastVuUri = uri;
  const id = trackIdFromUri(uri);

  if (audioFeatureCache[id]) {
    vuBpm = audioFeatureCache[id].tempo;
    vuEnergy = audioFeatureCache[id].energy;
    startVu();
    return;
  }

  try {
    const features = await Spotify.getAudioFeatures(id);
    const profile = {
      tempo: Math.min(200, Math.max(60, features?.tempo || 100)),
      energy: features?.energy ?? 0.5
    };
    audioFeatureCache[id] = profile;
    vuBpm = profile.tempo;
    vuEnergy = profile.energy;
  } catch (e) {
    Station.log(`Audio features unavailable, using default pulse: ${e.message}`);
    vuBpm = 100;
    vuEnergy = 0.5;
  }
  startVu();
}

// ---- Shared "art + name/sub" row, used by the up-next feed and stats lists ----
// When a url is supplied the card renders as a link out to Spotify (design
// guidelines: displayed Spotify metadata must link back to the service).
// onRemove/pending add an optional remove control (used by the up-next feed).
function buildCard({ rank, image, name, sub, tagText, tagClass, url, onRemove, pending }) {
  const card = document.createElement(url ? "a" : "div");
  card.className = "feed-card";
  if (pending) card.classList.add("feed-card-pending");
  if (url) {
    card.href = url;
    card.target = "_blank";
    card.rel = "noopener";
    card.title = "Listen on Spotify";
  }

  if (rank != null) {
    const rankEl = document.createElement("span");
    rankEl.className = "rank-num";
    rankEl.textContent = rank;
    card.appendChild(rankEl);
  }

  const art = document.createElement("div");
  art.className = "feed-art";
  if (image) {
    art.style.backgroundImage = `url("${image}")`;
    art.style.backgroundSize = "contain"; // never crop artwork
  }
  card.appendChild(art);

  const meta = document.createElement("div");
  meta.className = "feed-meta";
  const nameEl = document.createElement("p");
  nameEl.className = "feed-name";
  nameEl.textContent = name || "—";
  nameEl.title = name || "";
  const subEl = document.createElement("p");
  subEl.className = "feed-sub";
  subEl.textContent = sub || "";
  subEl.title = sub || "";
  meta.appendChild(nameEl);
  meta.appendChild(subEl);
  card.appendChild(meta);

  if (tagText) {
    const tag = document.createElement("span");
    tag.className = `tag ${tagClass}`;
    tag.textContent = tagText;
    card.appendChild(tag);
  }

  if (onRemove) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "feed-remove-btn";
    removeBtn.textContent = pending ? "↺" : "×";
    removeBtn.title = pending ? "Cancel removal" : "Remove from queue";
    removeBtn.setAttribute("aria-label", removeBtn.title);
    removeBtn.addEventListener("click", (e) => {
      e.preventDefault(); // don't follow the card's own Spotify link
      e.stopPropagation();
      onRemove();
    });
    card.appendChild(removeBtn);
  }

  return card;
}

// ---- Up-next feed (rendered straight from Spotify's real queue, not our own
// bookkeeping - the previous local-array approach could drift from what
// Spotify actually plays next, e.g. if another device/app touched the
// queue) + taste-profile stats ----
function renderFeedFromQueue(queueItems) {
  lastQueueSnapshot = queueItems || [];
  const list = $("feed-list");
  list.innerHTML = "";
  if (lastQueueSnapshot.length === 0) {
    list.innerHTML = '<p class="feed-empty">Nothing queued yet.</p>';
    return;
  }
  lastQueueSnapshot.slice(0, 8).forEach((track, idx) => {
    const pending = pendingSkipUris.has(track.uri);
    list.appendChild(
      buildCard({
        image: albumImage(track.album?.images),
        name: track.name,
        sub: track.artists?.[0]?.name,
        tagText: Station.originByUri[track.uri] === "fresh" ? "new" : null,
        tagClass: "tag-accent-2",
        url: spotifyOpenUrl(track.uri),
        pending,
        onRemove: () => toggleQueueRemoval(track.uri, idx === 0)
      })
    );
  });
}

// Spotify's queue has no "delete this specific item" operation. The item
// that's immediately next can genuinely be removed right now (skip to
// next). Anything deeper can only be marked so this app auto-skips it the
// moment it becomes the current track - shown as a struck-through "pending
// removal" card in the meantime, with an undo.
function toggleQueueRemoval(uri, isImmediatelyNext) {
  if (isImmediatelyNext) {
    skipTrack();
    return;
  }
  if (pendingSkipUris.has(uri)) {
    pendingSkipUris.delete(uri);
  } else {
    pendingSkipUris.add(uri);
  }
  renderFeedFromQueue(lastQueueSnapshot);
}

function updateStats() {
  $("stat-tracks").textContent = Station.knownPool.length + Station.freshPool.length;
  $("stat-seeds").textContent = Station.getSeedArtists().length;
}

function renderSeedList() {
  const container = $("seed-list");
  const seeds = Station.getSeedArtists();
  container.innerHTML = "";
  for (const seed of seeds) {
    const chip = document.createElement("div");
    chip.className = "seed-chip";

    const name = document.createElement("span");
    name.textContent = seed.name;
    chip.appendChild(name);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "seed-chip-remove";
    removeBtn.textContent = "×";
    removeBtn.title = `Remove ${seed.name}`;
    removeBtn.setAttribute("aria-label", removeBtn.title);
    removeBtn.addEventListener("click", () => {
      Station.removeSeedArtist(seed.id);
      renderSeedList();
      updateStats();
    });
    chip.appendChild(removeBtn);

    container.appendChild(chip);
  }
}

// ---- Stats tab ----
let currentStatsRange = "medium_term";

function switchTab(tab) {
  const isHome = tab === "home";
  $("home-view").classList.toggle("hidden", !isHome);
  $("stats-view").classList.toggle("hidden", isHome);
  document.querySelectorAll(".dsk-navlink").forEach((el) => {
    el.classList.toggle("active", el.dataset.tab === tab);
  });
  if (!isHome) loadStats(currentStatsRange);
}

function renderRankList(containerId, items) {
  const el = $(containerId);
  el.innerHTML = "";
  if (items.length === 0) {
    el.innerHTML = '<p class="feed-empty">Nothing here yet.</p>';
    return;
  }
  for (const item of items) {
    el.appendChild(buildCard(item));
  }
}

// Spotify's public API doesn't expose monthly listeners or play counts for
// artists/tracks at all - that data only exists in Spotify's own apps and
// Spotify for Artists. Follower count (a real, always-available field,
// separate from the "popularity" score that wasn't returning data for this
// app) is the closest genuine scale indicator available for artists; tracks
// have no equivalent numeric field, so rank is the only number shown there.
function formatCount(n) {
  if (n == null) return "—";
  const trim = (v) => v.replace(/\.0$/, "");
  if (n >= 1000000) return `${trim((n / 1000000).toFixed(1))}M`;
  if (n >= 1000) return `${trim((n / 1000).toFixed(1))}K`;
  return String(n);
}

async function loadStats(range) {
  currentStatsRange = range;
  $("top-artists-list").innerHTML = '<p class="feed-empty">Loading...</p>';
  $("top-tracks-list").innerHTML = '<p class="feed-empty">Loading...</p>';
  try {
    const [artists, tracks] = await Promise.all([
      Spotify.getTopItems("artists", range, 10),
      Spotify.getTopItems("tracks", range, 10)
    ]);

    renderRankList(
      "top-artists-list",
      (artists?.items || []).map((a, i) => ({
        rank: i + 1,
        image: albumImage(a.images),
        name: a.name,
        sub: `${formatCount(a.followers?.total)} followers${a.genres?.length ? " · " + a.genres.slice(0, 2).join(", ") : ""}`,
        url: a.external_urls?.spotify
      }))
    );

    renderRankList(
      "top-tracks-list",
      (tracks?.items || []).map((t, i) => ({
        rank: i + 1,
        image: albumImage(t.album?.images),
        name: t.name,
        sub: t.artists?.[0]?.name || "",
        url: t.external_urls?.spotify
      }))
    );
  } catch (e) {
    Station.log(`Stats unavailable: ${e.message}`);
    $("top-artists-list").innerHTML = '<p class="feed-empty">Couldn\'t load stats.</p>';
    $("top-tracks-list").innerHTML = '<p class="feed-empty">Couldn\'t load stats.</p>';
  }
}

async function init() {
  if (!isLoggedIn()) {
    show($("login-screen"));
    hide($("dashboard"));
    $("login-btn").addEventListener("click", redirectToSpotifyLogin);
    return;
  }

  show($("dashboard"));
  hide($("login-screen"));
  wireControls();

  try {
    const me = await Spotify.getMe();
    $("greeting").textContent = `Signed in as ${me.display_name || "you"}`;
  } catch (e) {
    Station.log(`Couldn't load profile: ${e.message}`);
  }

  await loadDevices();
}

// Runs a single piece of control-wiring in isolation. A missing element
// (e.g. a stale cached app.js paired with a newer index.html after a
// deploy) throws and would otherwise silently abort every remaining
// listener in wireControls() - each block gets its own try/catch instead,
// so one bad ID doesn't take the rest of the UI down with it.
function wireOne(label, fn) {
  try {
    fn();
  } catch (e) {
    console.error(`Failed to wire up ${label}:`, e);
    Station.log(`UI setup problem (${label}): ${e.message}. Try a hard refresh.`);
  }
}

function wireControls() {
  wireOne("logout button", () => {
    $("logout-btn").addEventListener("click", () => {
      clearInterval(pollTimer);
      logout();
      window.location.reload();
    });
  });

  wireOne("device refresh button", () => {
    $("refresh-devices-btn").addEventListener("click", loadDevices);
  });

  wireOne("start button", () => {
    $("start-btn").addEventListener("click", startStation);
  });

  wireOne("transport pad", () => {
    $("prev-btn").addEventListener("click", previousTrack);
    $("play-pause-btn").addEventListener("click", togglePlayPause);
    $("next-btn").addEventListener("click", skipTrack);
  });

  wireOne("seed form", () => {
    $("seed-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = $("seed-input");
      const name = input.value.trim();
      if (!name) return;
      $("seed-status").textContent = "Adding...";
      try {
        const found = await Station.addSeedArtist(name);
        $("seed-status").textContent = `Added "${found}" to your rotation.`;
        input.value = "";
        updateStats();
        renderSeedList();
      } catch (err) {
        $("seed-status").textContent = err.message;
      }
    });
    renderSeedList();
  });

  wireOne("ratio slider", () => {
    const ratioSlider = $("ratio-slider");
    const updateRatioLabel = (pct) => {
      $("ratio-value").textContent = `${pct}% new`;
    };
    const initialPct = Math.round(Station.getNewRatio() * 100);
    ratioSlider.value = initialPct;
    updateRatioLabel(initialPct);
    ratioSlider.addEventListener("input", () => {
      const pct = Number(ratioSlider.value);
      Station.setNewRatio(pct / 100);
      updateRatioLabel(pct);
    });
  });

  wireOne("technical log toggle", () => {
    $("toggle-log-btn").addEventListener("click", () => {
      $("log-panel").classList.toggle("hidden");
    });
  });

  wireOne("nav tabs", () => {
    document.querySelectorAll(".dsk-navlink").forEach((link) => {
      link.addEventListener("click", () => switchTab(link.dataset.tab));
    });
  });

  wireOne("stats range control", () => {
    document.querySelectorAll("#stats-range .seg-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#stats-range .seg-opt").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        loadStats(btn.dataset.range);
      });
    });
  });
}

async function loadDevices() {
  const select = $("device-select");
  select.innerHTML = "<option>Loading devices...</option>";
  try {
    const data = await Spotify.getDevices();
    const devices = data?.devices || [];
    select.innerHTML = "";
    if (devices.length === 0) {
      select.innerHTML = "<option value=''>No devices found — open Spotify on your phone</option>";
      return;
    }
    for (const d of devices) {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = `${d.name} (${d.type})${d.is_active ? " — active" : ""}`;
      select.appendChild(opt);
    }
    selectedDeviceId = devices.find((d) => d.is_active)?.id || devices[0].id;
    select.value = selectedDeviceId;
    select.addEventListener("change", () => {
      selectedDeviceId = select.value;
    });
  } catch (e) {
    select.innerHTML = "<option value=''>Couldn't load devices</option>";
    Station.log(`Device list failed: ${e.message}`);
  }
}

function setOnAir(isOn) {
  $("on-air-dot").classList.toggle("live", isOn);
  $("on-air-label").textContent = isOn ? "ON AIR" : "OFF AIR";
  isOnAir = isOn;

  const playPauseBtn = $("play-pause-btn");
  playPauseBtn.textContent = isOn ? "⏸" : "▶";
  playPauseBtn.setAttribute("aria-label", isOn ? "Pause" : "Play");

  if (isOn) startVu();
  else stopVu();
}

// Spotify's design guidelines require respecting playback restrictions
// (e.g. Free-tier accounts can't always skip/previous on demand) rather
// than always showing every control as available - disallowed actions get
// disabled instead of just failing silently when clicked.
function applyPlaybackRestrictions(disallows = {}) {
  $("prev-btn").disabled = !engineStarted || !!disallows.skipping_prev;
  $("next-btn").disabled = !engineStarted || !!disallows.skipping_next;
  const cantToggle = isOnAir ? disallows.pausing : disallows.resuming;
  $("play-pause-btn").disabled = !engineStarted || !!cantToggle;
}

async function refreshPlaybackRestrictions() {
  try {
    const state = await Spotify.getPlaybackState();
    applyPlaybackRestrictions(state?.actions?.disallows || {});
  } catch (e) {
    // If we can't check, default to enabled rather than stuck disabled -
    // the underlying Spotify call will just fail safely if it really is
    // restricted, and that failure gets logged like any other.
    applyPlaybackRestrictions({});
  }
}

async function togglePlayPause() {
  const action = isOnAir ? "Pause" : "Resume";
  Station.log(`${action}: sending ${isOnAir ? "pause" : "play"} command to Spotify...`);
  try {
    if (isOnAir) {
      await Spotify.pause();
    } else {
      await Spotify.resume();
    }
    Station.log(`${action}: command accepted, refreshing playback state...`);
    await topUpQueue();
  } catch (e) {
    Station.log(`${action} failed: ${e.message}`);
  }
}

async function previousTrack() {
  Station.log("Previous: sending skip-to-previous command to Spotify...");
  try {
    await Spotify.skipPrevious();
    Station.log("Previous: command accepted, refreshing playback state...");
    await topUpQueue();
  } catch (e) {
    Station.log(`Previous track failed: ${e.message}`);
  }
}

function renderNowPlaying(item) {
  const isNew = item.origin === "fresh";
  $("np-badge").textContent = isNew ? "NEW" : "FAMILIAR";
  $("np-badge").className = `tag ${isNew ? "tag-accent-2" : "tag-accent"}`;
  $("np-title").textContent = item.name || "—";
  $("np-title").title = item.name || "";
  $("np-subtitle").textContent = item.artist || "";
  $("np-subtitle").title = item.artist || "";

  const art = $("np-art");
  if (item.image) {
    art.src = item.image;
    show(art);
  } else {
    hide(art);
  }

  const spotifyLink = $("np-spotify-link");
  const openUrl = spotifyOpenUrl(item.uri);
  if (openUrl) {
    spotifyLink.href = openUrl;
    show(spotifyLink);
  } else {
    hide(spotifyLink);
  }

  if (item.uri) {
    updateVuProfile(item.uri);
  }
}

// Spotify's API has no direct "clear queue" endpoint. Draining by skipping
// through whatever's already queued (checking after each skip) is the only
// way to actually guarantee a clean slate before we queue our own picks -
// otherwise leftover tracks from a previous session, or whatever was
// already lined up on the device, can end up mixed in with the new mix.
async function clearSpotifyQueue(maxSkips = 15) {
  for (let i = 0; i < maxSkips; i++) {
    const queue = await Spotify.getCurrentQueue();
    const upcoming = queue?.queue?.length || 0;
    if (upcoming === 0) break;
    await Spotify.skipNext();
  }
}

async function startStation() {
  if (!selectedDeviceId) {
    Station.log("Pick a device first (open Spotify on your phone, then refresh devices).");
    return;
  }

  $("start-btn").disabled = true;
  $("start-btn").textContent = "Spinning up...";

  try {
    await Station.refillPools();
    updateStats();

    const first = Station.pickNext();
    if (!first) throw new Error("Couldn't find anything to play. Try adding a seed artist.");

    await Spotify.transferPlayback(selectedDeviceId, false);
    await new Promise((r) => setTimeout(r, 800)); // let transfer settle

    try {
      Station.log("Clearing existing Spotify queue...");
      await clearSpotifyQueue();
    } catch (e) {
      Station.log(`Couldn't fully clear the queue, continuing anyway: ${e.message}`);
    }

    await Spotify.startPlayback(selectedDeviceId, [first.uri]);
    Station.remember(first.uri);
    lastKnownPlayingUri = first.uri;
    pendingSkipUris = new Set();
    setOnAir(true);
    renderNowPlaying(first);

    // Queue up a handful more behind it. The main track is already playing
    // at this point, so a failure queueing an extra track shouldn't abort
    // startup and leave the transport controls stuck disabled - log it and
    // keep going instead.
    for (let i = 0; i < CONFIG.QUEUE_TARGET_SIZE - 1; i++) {
      const next = Station.pickNext();
      if (!next) break;
      try {
        await Spotify.addToQueue(next.uri, selectedDeviceId);
        Station.remember(next.uri);
      } catch (e) {
        Station.log(`Couldn't queue "${next.name}": ${e.message}`);
      }
    }

    const queueNow = await Spotify.getCurrentQueue();
    renderFeedFromQueue(queueNow?.queue);

    $("start-btn").textContent = "Restart Engine";
    engineStarted = true;
    await refreshPlaybackRestrictions();
    startPolling();
  } catch (e) {
    Station.log(`Couldn't start engine: ${e.message}`);
    $("start-btn").textContent = "Start Engine";
  } finally {
    $("start-btn").disabled = false;
  }
}

async function skipTrack() {
  Station.log("Skip: sending skip-to-next command to Spotify...");
  try {
    await Spotify.skipNext();
    Station.log("Skip: command accepted, refreshing playback state...");
    await topUpQueue();
  } catch (e) {
    Station.log(`Skip failed: ${e.message}`);
  }
}

async function topUpQueue() {
  try {
    let state = await Spotify.getPlaybackState();

    // Honor any "remove from queue" marks placed on tracks deeper than
    // position 0 (see toggleQueueRemoval) the moment they become current.
    if (state?.item && pendingSkipUris.has(state.item.uri)) {
      pendingSkipUris.delete(state.item.uri);
      Station.log(`Auto-skip: "${state.item.name}" was marked for removal, skipping now...`);
      await Spotify.skipNext();
      state = await Spotify.getPlaybackState();
    }

    let trackChanged = false;

    if (state?.item) {
      trackChanged = state.item.uri !== lastKnownPlayingUri;
      lastKnownPlayingUri = state.item.uri;

      Station.log(
        `Spotify reports now playing: "${state.item.name}" — ${state.item.artists?.[0]?.name || "?"} (${state.is_playing ? "playing" : "paused"})`
      );
      renderNowPlaying({
        uri: state.item.uri,
        name: state.item.name,
        artist: state.item.artists?.[0]?.name,
        image: albumImage(state.item.album?.images),
        origin: Station.originByUri[state.item.uri]
      });
      setOnAir(state.is_playing);
      applyPlaybackRestrictions(state.actions?.disallows || {});
    } else {
      Station.log("Spotify reports no active playback.");
    }

    const queue = await Spotify.getCurrentQueue();
    const upcoming = queue?.queue?.length || 0;

    // Add exactly one replacement track once the current song has changed
    // (finished naturally, was skipped, or went to the previous track) -
    // plus a low-buffer safety net in case the queue ever runs dry without
    // a track-change to notice it by (e.g. right after starting up).
    if (trackChanged || upcoming < 3) {
      const next = Station.pickNext();
      if (next) {
        await Spotify.addToQueue(next.uri, selectedDeviceId);
        Station.remember(next.uri);
      }
      if (Station.knownPool.length + Station.freshPool.length < 5) {
        await Station.refillPools();
      }
      updateStats();

      const refreshedQueue = await Spotify.getCurrentQueue();
      renderFeedFromQueue(refreshedQueue?.queue);
    } else {
      renderFeedFromQueue(queue?.queue);
    }
  } catch (e) {
    Station.log(`Queue check failed: ${e.message}`);
  }
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(topUpQueue, 15000);
}

init();
