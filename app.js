// ---- UI controller ----

let selectedDeviceId = null;
let pollTimer = null;
let upcomingFeed = []; // [{ uri, name, artist, image, origin }] - what we've actually queued

const $ = (id) => document.getElementById(id);

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

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

// ---- Up-next feed + taste-profile stats ----
function addToFeed(item) {
  upcomingFeed.push(item);
  if (upcomingFeed.length > 8) upcomingFeed.shift();
  renderFeed();
}

function removeFromFeed(uri) {
  const next = upcomingFeed.filter((t) => t.uri !== uri);
  if (next.length !== upcomingFeed.length) {
    upcomingFeed = next;
    renderFeed();
  }
}

function renderFeed() {
  const list = $("feed-list");
  list.innerHTML = "";
  if (upcomingFeed.length === 0) {
    list.innerHTML = '<p class="feed-empty" id="feed-empty">Nothing queued yet.</p>';
    return;
  }
  for (const item of upcomingFeed) {
    const card = document.createElement("div");
    card.className = "feed-card";

    const art = document.createElement("div");
    art.className = "feed-art";
    if (item.image) {
      art.style.backgroundImage = `url("${item.image}")`;
      art.style.backgroundSize = "cover";
    }

    const meta = document.createElement("div");
    meta.className = "feed-meta";
    const name = document.createElement("p");
    name.className = "feed-name";
    name.textContent = item.name || "—";
    const sub = document.createElement("p");
    sub.className = "feed-sub";
    sub.textContent = item.artist || "";
    meta.appendChild(name);
    meta.appendChild(sub);

    card.appendChild(art);
    card.appendChild(meta);

    if (item.origin === "fresh") {
      const tag = document.createElement("span");
      tag.className = "tag tag-accent-2";
      tag.textContent = "new";
      card.appendChild(tag);
    }

    list.appendChild(card);
  }
}

function updateStats() {
  $("stat-tracks").textContent = Station.knownPool.length + Station.freshPool.length;
  $("stat-seeds").textContent = Station.getSeedArtists().length;
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
      } catch (err) {
        $("seed-status").textContent = err.message;
      }
    });
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
  $("np-subtitle").textContent = item.artist || "";

  const art = $("np-art");
  if (item.image) {
    art.src = item.image;
    show(art);
  } else {
    hide(art);
  }

  if (item.uri) {
    removeFromFeed(item.uri);
    updateVuProfile(item.uri);
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
    await Spotify.startPlayback(selectedDeviceId, [first.uri]);
    Station.remember(first.uri);
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
        addToFeed(next);
      } catch (e) {
        Station.log(`Couldn't queue "${next.name}": ${e.message}`);
      }
    }

    $("start-btn").textContent = "Restart Engine";
    $("prev-btn").disabled = false;
    $("play-pause-btn").disabled = false;
    $("next-btn").disabled = false;
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
    const state = await Spotify.getPlaybackState();
    if (state?.item) {
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
    } else {
      Station.log("Spotify reports no active playback.");
    }

    const queue = await Spotify.getCurrentQueue();
    const upcoming = queue?.queue?.length || 0;
    if (upcoming < 3) {
      const next = Station.pickNext();
      if (next) {
        await Spotify.addToQueue(next.uri, selectedDeviceId);
        Station.remember(next.uri);
        addToFeed(next);
      }
      if (Station.knownPool.length + Station.freshPool.length < 5) {
        await Station.refillPools();
      }
      updateStats();
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
