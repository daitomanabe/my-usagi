const $ = (id) => document.getElementById(id);

const btnStart = $("btnStart");
const btnStop = $("btnStop");
const transcriptEl = $("transcript");
const statusEl = $("status");
const bunnyTextEl = $("bunnyText");

const profileId = "default";

let recognition = null;
let mediaRecorder = null;
let audioChunks = [];
let lastTranscript = "";

function setStatus(obj) {
  statusEl.textContent = JSON.stringify(obj, null, 2);
}

function setTranscript(t) {
  lastTranscript = t;
  transcriptEl.textContent = t;
}

function setBunnyText(t) {
  bunnyTextEl.textContent = t;
}

function hasSpeechRecognition() {
  return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
}

function createRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR();
  r.lang = "ja-JP";
  r.interimResults = true;
  r.continuous = false;

  r.onresult = (event) => {
    let interim = "";
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      const text = res[0].transcript;
      if (res.isFinal) finalText += text;
      else interim += text;
    }
    setTranscript((finalText || "").trim() || (interim || "").trim());
  };

  r.onerror = (e) => {
    setStatus({ stage: "recognition.onerror", e });
  };

  r.onend = () => {
    setStatus({ stage: "recognition.onend" });
  };

  return r;
}

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioChunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    // stop tracks
    stream.getTracks().forEach((t) => t.stop());
  };

  mediaRecorder.start();
  setStatus({ stage: "recording.started", hasSpeechRecognition: hasSpeechRecognition() });
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}

async function uploadAudioIfAny() {
  if (!audioChunks.length) return null;
  const blob = new Blob(audioChunks, { type: "audio/webm" });

  const resp = await fetch("/api/audio/upload", {
    method: "POST",
    headers: { "content-type": "audio/webm" },
    body: await blob.arrayBuffer(),
  });

  const data = await resp.json();
  if (!data.ok) throw new Error("audio upload failed");
  return data.r2Key;
}

async function sendChat({ text, audioR2Key }) {
  const resp = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      profileId,
      text,
      audioR2Key,
      asr: hasSpeechRecognition() ? { provider: "web_speech" } : undefined,
    }),
  });

  const data = await resp.json();
  if (!data.ok) throw new Error(data.error || "chat failed");
  return data.reply?.text || "…";
}

async function onStart() {
  btnStart.disabled = true;
  btnStop.disabled = false;
  setTranscript("");
  setBunnyText("きいてるよ…");

  try {
    await startRecording();

    if (hasSpeechRecognition()) {
      recognition = createRecognition();
      recognition.start();
      setStatus({ stage: "recognition.started" });
    } else {
      setStatus({ stage: "no_speech_recognition" });
    }
  } catch (e) {
    setStatus({ stage: "start_failed", error: String(e) });
    btnStart.disabled = false;
    btnStop.disabled = true;
    setBunnyText("マイクがつかえないみたい…");
  }
}

async function onStop() {
  btnStop.disabled = true;

  try {
    if (recognition) {
      try { recognition.stop(); } catch {}
    }
    stopRecording();

    // Wait a tick for recorder to flush data
    await new Promise((r) => setTimeout(r, 300));

    const audioR2Key = await uploadAudioIfAny();

    const text = (lastTranscript || "").trim();
    setBunnyText("かんがえてる…");

    const reply = await sendChat({ text, audioR2Key });
    setBunnyText(reply);

    setStatus({
      stage: "done",
      text,
      audioR2Key,
    });
  } catch (e) {
    setStatus({ stage: "stop_failed", error: String(e) });
    setBunnyText("ごめんね、もういっかい？");
  } finally {
    btnStart.disabled = false;
    btnStop.disabled = true;
  }
}

btnStart.addEventListener("click", onStart);
btnStop.addEventListener("click", onStop);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
