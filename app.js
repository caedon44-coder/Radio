// ---- UI controller ----

let selectedDeviceId = null;
let pollTimer = null;

const $ = (id) => document.getElementById(id);

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

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
  $("np-badge").textContent = kind === "episode" ? "PODCAST" : "MUSIC";
  $("np-badge").className = `badge ${kind === "episode" ? "badge-podcast" : "badge-music"}`;
  $("np-title").textContent = item.name || "—";
  $("np-subtitle").textContent = kind === "episode" ? item.show : item.artist;
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

    const firstUri = first.item.uri;
    await Spotify.transferPlayback(selectedDeviceId, false);
    await new Promise((r) => setTimeout(r, 800)); // let transfer settle
    await Spotify.startPlayback(selectedDeviceId, [firstUri]);
    Station.remember(firstUri);
    renderNowPlaying(first.type, first.item);
    setOnAir(true);

    // Queue up a handful more behind it
    for (let i = 0; i < CONFIG.QUEUE_TARGET_SIZE - 1; i++) {
      const next = Station.pickNext();
      if (!next) break;
      await Spotify.addToQueue(next.item.uri, selectedDeviceId);
      Station.remember(next.item.uri);
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
    await Spotify.skipNext(selectedDeviceId);
    await topUpQueue();
  } catch (e) {
    Station.log(`Skip failed: ${e.message}`);
  }
}

async function topUpQueue() {
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
    if (upcoming < 3) {
      const next = Station.pickNext();
      if (next) {
        await Spotify.addToQueue(next.item.uri, selectedDeviceId);
        Station.remember(next.item.uri);
      }
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
