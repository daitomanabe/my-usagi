const $ = (id) => document.getElementById(id);

const pinEl = $("pin");
const btnLoad = $("btnLoad");
const statusEl = $("status");
const eventsEl = $("events");
const vocabEl = $("vocab");

const url = new URL(location.href);
if (url.searchParams.get("pin")) {
  pinEl.value = url.searchParams.get("pin");
}

function setStatus(t) {
  statusEl.textContent = t;
}

async function load() {
  const pin = pinEl.value || "";
  setStatus("loading…");

  const resp = await fetch(`/api/parent/summary?profileId=default`, {
    headers: { "x-parent-pin": pin }
  });
  const data = await resp.json();

  if (!data.ok) {
    setStatus("error: " + JSON.stringify(data));
    return;
  }

  setStatus("ok");
  eventsEl.textContent = JSON.stringify(data.recentEvents, null, 2);
  vocabEl.textContent = JSON.stringify(data.vocab, null, 2);
}

btnLoad.addEventListener("click", load);
