// ---- UI controller ----

let selectedDeviceId = null;
let pollTimer = null;
let ytPlayer = null;

const $ = (id) => document.getElementById(id);

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

// Called by the YouTube IFrame API once it's loaded (script tag in index.html).
function onYouTubeIframeAPIReady() {
  ytPlayer = new YT.Player("yt-player", {
    height: "100%",
    width: "100%",
    playerVars: { playsinline: 1, rel: 0 },
    events: {
      onStateChange: (event) => {
        if (event.data === YT.PlayerState.ENDED) {
          resumeSpotifyAfterYoutube();
        }
      }
    }
  });
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

function wireControls() {
  $("logout-btn").addEventListener("click", () => {
    clearInterval(pollTimer);
    logout();
    window.location.reload();
  });

  $("refresh-devices-btn").addEventListener("click", loadDevices);
  $("start-btn").addEventListener("click", startStation);
  $("skip-btn").addEventListener("click", skipTrack);

  $("seed-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("seed-input");
    const name = input.value.trim();
    if (!name) return;
    $("seed-status").textContent = "Adding...";
    try {
      const found = await Station.addSeedArtist(name);
      $("seed-status").textContent = `Added "${found}" to your station.`;
      input.value = "";
    } catch (err) {
      $("seed-status").textContent = err.message;
    }
  });

  $("yt-seed-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("yt-seed-input");
    const value = input.value.trim();
    if (!value) return;
    $("yt-seed-status").textContent = "Adding...";
    try {
      const found = await Station.addYtSeed(value);
      $("yt-seed-status").textContent = `Added "${found}" to your station.`;
      input.value = "";
    } catch (err) {
      $("yt-seed-status").textContent = err.message;
    }
  });

  $("toggle-log-btn").addEventListener("click", () => {
    $("log-panel").classList.toggle("hidden");
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
}

function renderNowPlaying(kind, item) {
  const badgeText = kind === "episode" ? "PODCAST" : kind === "youtube" ? "VIDEO" : "MUSIC";
  const badgeClass =
    kind === "episode" ? "badge-podcast" : kind === "youtube" ? "badge-video" : "badge-music";
  $("np-badge").textContent = badgeText;
  $("np-badge").className = `badge ${badgeClass}`;
  $("np-title").textContent = item.name || item.title || "—";
  $("np-subtitle").textContent =
    kind === "episode" ? item.show : kind === "youtube" ? item.channelTitle : item.artist;
}

// Pushes up to maxCount picks into Spotify's on-device queue. Stops (without
// consuming that pick) the moment a YouTube video comes up, since Spotify's
// queue can't hold anything but Spotify URIs — the video is stashed as
// pendingYoutubeItem and handled once the Spotify queue actually drains.
async function fillSpotifyQueue(maxCount) {
  for (let i = 0; i < maxCount; i++) {
    const next = Station.pickNext();
    if (!next) break;

    if (next.type === "youtube") {
      Station.pendingYoutubeItem = next.item;
      break;
    }

    await Spotify.addToQueue(next.item.uri, selectedDeviceId);
    Station.remember(next.item.uri);
  }
}

// Pauses Spotify and hands playback over to the embedded YouTube player.
// Foreground-only: the tab has to stay open and active for this to keep
// playing, unlike Spotify Connect segments.
async function playYoutubeItem(item) {
  try {
    await Spotify.pause(selectedDeviceId);
  } catch (e) {
    Station.log(`Couldn't pause Spotify before video: ${e.message}`);
  }

  Station.playingYoutube = true;
  renderNowPlaying("youtube", item);
  setOnAir(true);
  show($("yt-player-panel"));
  ytPlayer.loadVideoById(item.videoId);
}

// Called when the embedded video ends (or is skipped) to hand playback back to Spotify.
async function resumeSpotifyAfterYoutube() {
  hide($("yt-player-panel"));
  Station.playingYoutube = false;

  try {
    const next = Station.pickNext();
    if (!next) {
      Station.log("Nothing left to play after the video segment.");
      setOnAir(false);
      return;
    }

    if (next.type === "youtube") {
      await playYoutubeItem(next.item);
      return;
    }

    await Spotify.startPlayback(selectedDeviceId, [next.item.uri]);
    Station.remember(next.item.uri);
    renderNowPlaying(next.type, next.item);
    setOnAir(true);

    await fillSpotifyQueue(CONFIG.QUEUE_TARGET_SIZE - 1);
  } catch (e) {
    Station.log(`Couldn't resume Spotify after video: ${e.message}`);
  }
}

async function startStation() {
  if (!selectedDeviceId) {
    Station.log("Pick a device first (open Spotify on your phone, then refresh devices).");
    return;
  }

  $("start-btn").disabled = true;
  $("start-btn").textContent = "Tuning in...";

  try {
    await Station.refillPools();

    const first = Station.pickNext();
    if (!first) throw new Error("Couldn't find anything to play. Try adding a seed artist.");

    await Spotify.transferPlayback(selectedDeviceId, false);
    await new Promise((r) => setTimeout(r, 800)); // let transfer settle

    if (first.type === "youtube") {
      await playYoutubeItem(first.item);
    } else {
      await Spotify.startPlayback(selectedDeviceId, [first.item.uri]);
      Station.remember(first.item.uri);
      renderNowPlaying(first.type, first.item);
      setOnAir(true);

      // Queue up a handful more behind it (stops short of any YouTube pick)
      await fillSpotifyQueue(CONFIG.QUEUE_TARGET_SIZE - 1);
    }

    $("start-btn").textContent = "Restart Station";
    $("skip-btn").disabled = false;
    startPolling();
  } catch (e) {
    Station.log(`Couldn't start station: ${e.message}`);
    $("start-btn").textContent = "Start Station";
  } finally {
    $("start-btn").disabled = false;
  }
}

async function skipTrack() {
  try {
    if (Station.playingYoutube) {
      ytPlayer.stopVideo();
      await resumeSpotifyAfterYoutube();
      return;
    }
    await Spotify.skipNext(selectedDeviceId);
    await topUpQueue();
  } catch (e) {
    Station.log(`Skip failed: ${e.message}`);
  }
}

async function topUpQueue() {
  if (Station.playingYoutube) return; // handled by the YouTube player's onStateChange

  try {
    const state = await Spotify.getPlaybackState();
    if (state?.item) {
      const kind = state.currently_playing_type === "episode" ? "episode" : "track";
      const name = state.item.name;
      const subtitle =
        kind === "episode" ? state.item.show?.name : state.item.artists?.[0]?.name;
      renderNowPlaying(kind, { name, artist: subtitle, show: subtitle });
      setOnAir(state.is_playing);
    }

    const queue = await Spotify.getCurrentQueue();
    const upcoming = queue?.queue?.length || 0;

    if (Station.pendingYoutubeItem) {
      // Wait for the last queued track to actually finish (not just start
      // playing with nothing behind it) before cutting over to the video.
      const spotifyStopped = !state || !state.is_playing;
      if (upcoming === 0 && spotifyStopped) {
        const item = Station.pendingYoutubeItem;
        Station.pendingYoutubeItem = null;
        await playYoutubeItem(item);
      }
      return;
    }

    if (upcoming < 3) {
      await fillSpotifyQueue(1);
      if (Station.trackPool.length < 5) {
        await Station.refillPools();
      }
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
