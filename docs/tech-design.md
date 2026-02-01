# 技術設計書（Cloudflare / WebApp）

## 1. アーキテクチャの結論（最小で成立する形）

**単一の Cloudflare Worker** が
- 静的アセット（子どもUI・親UI）を配信しつつ
- `/api/*` のAPIを提供し
- Durable Objects / D1 / R2 / Queues を束ねる

という構成にする。理由は単純で、**運用が一番ラク**だから。

Static Assets と Worker script の実行順序は `assets.run_worker_first` で制御できる（Cloudflare公式の routing docs 参照）。  
そのうえで `env.ASSETS.fetch(request)` で静的アセットにフォールバックする実装にする。

## 2. コンポーネント

### 2.1 Frontend（PWA）
- **子ども画面**: `public/`
  - “話す”ボタン（押すと録音 + 可能なら SpeechRecognition）
  - 表示: ウサギのセリフ
- **親画面**: `public/parent/`
  - PINで簡易保護
  - 会話ログ / 語彙（MVPは雑で良い）

#### 音声入力の考え方
- Web Speech API（SpeechRecognition）が使えるなら「即時のテキスト化」に利用
- ただしブラウザ対応が限定的で、オフラインや挙動差があるため、**常に raw audio も保存**（MediaRecorder）
- サーバ側ASR（Whisper等）に切り替えられるようにする

詳細リサーチ: `docs/research/browser-speech-recognition.md`

### 2.2 Backend（Cloudflare Worker）
- `/api/chat` … 会話入力を受け取る（text または audio）
- `/api/audio/upload` … raw audio を R2 に保存
- `/api/parent/summary` … 親向けに集計を返す（暫定）

### 2.3 Durable Objects（短期記憶 / セッション）
- **profileId（= 子ども1人）につき1 DO**
- 目的: “私のウサギ”の一貫性（短期文脈・気分・最近の出来事）を保つ
- DOの永続は SQLite-backed DO（Cloudflare推奨）
  - 初回 migration は `new_sqlite_classes` を使う

### 2.4 D1（長期ログ / 解析結果）
- events: 会話ログ（誰が/いつ/テキスト/音声キー）
- vocab_items: 語彙（初出/最終/回数）
- daily_summaries: 日次の要約（親閲覧用）
- reminders: 習慣リマインド設定（将来）

### 2.5 R2（音声保管）
- raw audio: `audio/raw/YYYY-MM-DD/<id>.webm`
- tts cache: `audio/tts/<voice>/<hash>.mp3`（予定）

### 2.6 Queues（非同期解析）
- `analyze_event`: 受け取ったイベントを解析
- 将来:
  - 語彙抽出（形態素解析）
  - 概念獲得の検知（反省/交渉/心の理論）
  - 日次/週次サマリの生成
  - ASR再実行（新モデル・設定で）

Cloudflare Queues は Wrangler 設定で producer/consumer を定義する。  
参考: Cloudflare公式の configure-queues docs。

### 2.7 Cron Triggers（時間イベント）
- 日次サマリ生成
- リマインド（風呂/保育園/就寝）

Cron は Worker の `scheduled()` ハンドラで処理。

## 3. データフロー

### 3.1 会話ループ（MVP）
1. 子どもがボタン → 録音開始（+ 可能なら SpeechRecognition）
2. stop → audio を `/api/audio/upload` → R2保存 → keyを受け取る
3. `/api/chat` に text + audioR2Key を送る
4. Worker:
   - events テーブルに child event 保存
   - Queue に解析ジョブ送信
   - DO に投げて reply を生成（現状 placeholder）
   - reply を events に bunny event として保存
5. フロントで返事表示（将来TTSで再生）

### 3.2 解析パイプライン（MVP）
- Queue consumer が event を読み、雑トークン化して vocab_items を更新
- これは「形態素解析を入れるまでの仮」だが、**パイプラインを通すことが目的**

## 4. セキュリティ / 安全性（現実）
あなたは「娘だけ」前提で軽視しているが、公開repoならそれは通用しない。最低限:

- R2 bucket は public にしない
- 親画面はちゃんと auth（今は PIN で雑にガードしている）
- GitHub Actions に LLM API key を入れる場合、**外部から起動できない設計**にする
- LLM は“子ども向け安全”のsystem prompt・拒否ルールが必須

## 5. ここからの改善ポイント（優先順）
1. iOS/Safari の音声入力・音声再生のクセを潰す（仕様差が最大の敵）
2. LLM 統合（低温度・短文・安全プロンプト）
3. TTS キャッシュ（R2）で体験を滑らかに
4. 親ダッシュボード（語彙・成長イベント抽出）
