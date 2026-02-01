const $ = (id) => document.getElementById(id);

const btnStart = $("btnStart");
const btnStop = $("btnStop");
const transcriptEl = $("transcript");
const statusEl = $("status");
const bunnyTextEl = $("bunnyText");
const bunnyFace = document.querySelector(".bunny-face");

let sessionId = null;
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

function setBunnyState(state) {
  bunnyFace.className = "bunny-face " + state;
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

async function startSession() {
  try {
    const resp = await fetch("/api/session/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || "Session start failed");

    sessionId = data.sessionId;
    setBunnyText(data.rabbitGreeting || "おはなししよう？");
    setStatus({ stage: "session.started", sessionId });

    if (data.ttsAudioUrl) {
      playAudio(data.ttsAudioUrl);
    }

    return sessionId;
  } catch (e) {
    setStatus({ stage: "session_start_failed", error: String(e) });
    setBunnyText("ごめんね、つながらないみたい…");
    return null;
  }
}

async function playAudio(url) {
  try {
    const audio = new Audio(url);
    setBunnyState("speaking");
    audio.onended = () => setBunnyState("idle");
    audio.onerror = () => setBunnyState("idle");
    await audio.play();
  } catch (e) {
    setBunnyState("idle");
    console.error("Audio playback failed:", e);
  }
}

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioChunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
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

async function sendAudio() {
  if (!audioChunks.length) return null;
  if (!sessionId) {
    sessionId = await startSession();
    if (!sessionId) return null;
  }

  const blob = new Blob(audioChunks, { type: "audio/webm" });
  const formData = new FormData();
  formData.append("sessionId", sessionId);
  formData.append("audio", blob, "recording.webm");
  formData.append("timestamp", new Date().toISOString());

  const resp = await fetch("/api/conversation/audio", {
    method: "POST",
    body: formData,
  });

  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || "Audio processing failed");
  return data;
}

async function sendText(text) {
  if (!sessionId) {
    sessionId = await startSession();
    if (!sessionId) return null;
  }

  const resp = await fetch("/api/conversation/text", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      text,
    }),
  });

  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || "Chat failed");
  return data;
}

async function onStart() {
  btnStart.disabled = true;
  btnStop.disabled = false;
  setTranscript("");
  setBunnyText("きいてるよ…");
  setBunnyState("listening");

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
    setBunnyState("idle");
  }
}

async function onStop() {
  btnStop.disabled = true;
  setBunnyState("thinking");

  try {
    if (recognition) {
      try { recognition.stop(); } catch {}
    }
    stopRecording();

    await new Promise((r) => setTimeout(r, 300));

    setBunnyText("かんがえてる…");

    const result = await sendAudio();

    if (result) {
      if (result.transcription) {
        setTranscript(result.transcription);
      }

      setBunnyText(result.rabbitResponse || "…");

      if (result.ttsAudioUrl) {
        await playAudio(result.ttsAudioUrl);
      }

      setStatus({
        stage: "done",
        transcription: result.transcription,
        turnId: result.turnId,
        vocabularyDetected: result.vocabularyDetected,
      });
    } else {
      setBunnyText("ごめんね、もういっかい？");
    }
  } catch (e) {
    setStatus({ stage: "stop_failed", error: String(e) });
    setBunnyText("ごめんね、もういっかい？");
    setBunnyState("idle");
  } finally {
    btnStart.disabled = false;
    btnStop.disabled = true;
    setBunnyState("idle");
  }
}

btnStart.addEventListener("click", onStart);
btnStop.addEventListener("click", onStop);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

window.addEventListener("load", async () => {
  sessionId = await startSession();
});
