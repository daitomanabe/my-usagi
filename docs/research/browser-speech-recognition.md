# ブラウザ音声認識（SpeechRecognition）の仕組み

このドキュメントは「ブラウザ内蔵の音声認識」と、その限界・代替案を整理するためのもの。

## 1. 何のAPIか
- いわゆる **Web Speech API** のうち「音声認識」側が `SpeechRecognition`
- もう一方に「読み上げ（音声合成）」の `SpeechSynthesis` がある

参考:
- MDN Web Speech API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API
- MDN SpeechRecognition: https://developer.mozilla.org/ja/docs/Web/API/SpeechRecognition

## 2. ざっくり動作（開発者目線）
典型的なフロー:
1. ユーザーがUI操作（ボタン押下など）→ マイク許可
2. `recognition.start()` で認識開始
3. `onresult` で逐次テキストが返る（`interimResults=true` なら途中経過も）
4. `isFinal` な結果が揃ったら確定テキスト
5. `onend` で終了（無音/エラー/ユーザー操作など）

重要:
- **ブラウザ実装差が大きい**（同じコードでも安定しない）
- “会話が終わった”判定は標準で厳密にはできないので、実装では「無音タイムアウト」などの工夫が必要になる（実装メモ: https://zenn.dev/manase/scraps/1e6e3b1dfe2dc3）

## 3. “裏側で何が起きてるの？”
これが最大の落とし穴。

- MDN に明記されている通り、Chrome など一部ブラウザでは **サーバーベースの認識エンジン**が使われる  
  → 音声が外部サービスへ送られるため **オフラインでは動かない**  
  参考（MDNの注記）: https://developer.mozilla.org/ja/docs/Web/API/SpeechRecognition

つまり:
- `SpeechRecognition` は「ローカルで完結する音声認識」ではない場合がある
- ネットワーク品質やサービス側仕様に振り回される

## 4. ブラウザ対応（2026時点の現実）
- `SpeechRecognition` は MDN 上でも **Limited availability / Baselineではない**と明記されている  
  参考: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition

- Safari は `webkitSpeechRecognition` などベンダープレフィックス前提・部分対応、といった状況が続いている（Can I use）  
  参考: https://caniuse.com/speech-recognition

結論: **“娘のiPhoneで確実に動く”は保証できない**。  
だから最初からフォールバックを入れるのが正解。

## 5. 代替（というか本命）: MediaRecorder + サーバASR
- `MediaRecorder` で raw audio を録音
- サーバ（Workers）へアップロードして
  - Whisper / 外部ASR / その時点のベストモデルで文字起こし
- さらに **raw audioをR2に保存して、将来もう一度解析できる**

この設計が勝つ理由:
- ブラウザ差を吸収できる
- “あとで精度が上がったら再解析”が可能
- 言語発達ログを残すという目的に直結

このリポジトリの `public/app.js` では、SpeechRecognition があれば併用し、常に録音もする、という形にしている。

## 6. iOS Safari の罠（実装で踏む）
- iOS Safari は音声再生やオーディオセッションの制約が強く、音声認識と同時利用で止まるケースなどが報告されている  
  例: https://zenn.dev/takex5g/articles/e3c445810ea085

対策（実装方針）:
- “認識”と“返事の音声再生”を同時に走らせない（状態機械で制御）
- 返事はテキストを先に出して、音声は遅延/ユーザー操作で再生
- どうしてもダメなら TTS は端末側（SpeechSynthesis）で暫定対応し、R2キャッシュは後

## 7. 最低限の実装スニペット
```js
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const r = new SR();
r.lang = "ja-JP";
r.interimResults = true;
r.onresult = (e) => {
  const t = Array.from(e.results).map(r => r[0].transcript).join("");
  console.log(t);
};
r.start();
```

## 8. このプロジェクトでの採用方針（結論）
- **SpeechRecognition は“使えたらラッキー”枠**
- **記録は MediaRecorder + R2 が本線**
- サーバASRにいつでも移行できるよう、データモデルを最初からそれ向けにする
