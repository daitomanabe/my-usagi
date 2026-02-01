# my-usagi 🐰 (prototype)

3歳の子ども向け「会話して育つウサギ」Webアプリ（PWA） + 親向け成長ダッシュボードのプロトタイプです。

**重要**: これは「個人用途（自分の娘）前提」で設計しています。  
ただし **リポジトリを公開するなら、その瞬間に“他人が使う/覗く/悪用する”前提に切り替える必要があります**。  
子どもの音声・会話ログは極めてセンシティブです。設計・運用で漏洩可能性を潰してください（下にガードレールを入れています）。

## 何を作るか（超短縮）

- 子どもが**話しかける** → ウサギが**返事**（音声/テキスト）
- 遊びの中でウサギが**感想・相槌**
- 生活習慣（風呂/保育園/就寝）を、説教じゃなく**自然に提案**
- 会話・音声を保存し、あとで**言語発達のログ**（語彙・言い回し・概念の獲得）として親が閲覧

詳細は `docs/` を参照。

## 技術スタック（Cloudflare前提）

- **Frontend**: Static assets (PWA) — `public/`
- **Backend**: Cloudflare Workers — `src/index.ts`
- **State**: Durable Objects（会話セッション/短期記憶）
- **DB**: D1（ログ・語彙・要約・リマインド設定など）
- **Blob**: R2（音声: raw / TTS キャッシュ）
- **Async**: Queues（解析・再解析・日次サマリ生成など）
- **Scheduler**: Cron Triggers（時間ベースのリマインド/日次集計）

Cloudflare Workers の Static Assets は `assets.run_worker_first` を使うと、**API も SPA も同一 Worker で扱えます**（実装もこの形）。  
参考: Cloudflare公式の Static Assets / routing docs。  

## まず動かす（ローカル）

### 0) 必要要件
- Node.js 20+ 推奨
- Cloudflare アカウント
- Wrangler（`npx wrangler ...` でOK）

### 1) インストール
```bash
npm install
```

### 2) 開発用の環境変数（ローカル）
```bash
cp .dev.vars.example .dev.vars
# 必要なら中身を編集（APIキー等）
```

### 3) ローカル起動
```bash
npm run dev
# http://localhost:8787
```

## Cloudflare リソース作成（初回だけ）

### D1
```bash
npx wrangler d1 create my-usagi-db
# 出力された database_id を wrangler.jsonc に反映
```

D1 migration（ローカル）
```bash
npx wrangler d1 migrations apply my-usagi-db --local
```

D1 migration（リモート）
```bash
npx wrangler d1 migrations apply my-usagi-db
```

D1コマンド一覧: Cloudflare公式（`d1 create`, `d1 migrations apply` など）  
参考: docs/research/cloudflare-links.md

### R2
```bash
npx wrangler r2 bucket create my-usagi-audio
# bucket_name を wrangler.jsonc に反映
```

### Queues
```bash
npx wrangler queues create my-usagi-analysis
```

Queueコマンド一覧: `npx wrangler queues create ...` など  
参考: docs/research/cloudflare-links.md

## デプロイ
```bash
npm run deploy
```

## リポジトリ構造

```
.
├─ public/                 # 子どもUI(暫定) + 親ダッシュボード(暫定)
├─ src/
│  └─ index.ts             # Worker + Durable Object（placeholder）
├─ migrations/             # D1 schema
├─ docs/                   # コンセプト/設計/ロードマップ/リサーチ/履歴
└─ .github/workflows/      # CI + AI支援（安全側の雛形）
```

## “AIがGitHubを見て更新する”開発ループ（注意点）

**公開リポジトリで「コメント→AIがコード変更」みたいな仕組みは、ほぼ確実に事故ります。**  
理由: 他人がコメントしただけで GitHub Actions が走り、**Actions secrets（LLM APIキー等）が漏れる/濫用される**可能性がある。

だからこのテンプレでは:
- AIパッチ生成は **workflow_dispatch（手動実行）** を基本
- もし issue_comment で起動する場合も **OWNER だけ** に限定（サンプルでガード）
- PRは必ず人間レビュー（CODEOWNERS推奨）

詳細: `docs/ai/github-ai-dev-loop.md`

## 次にやること（最短で“娘が遊べる”ところまで）

1. iPhone Safari で SpeechRecognition が不安定/制限される前提で、**MediaRecorder + サーバASR** を最初から用意
2. 返事は最初はテキストでOK → 次に TTS キャッシュ（R2）
3. 会話ログ（音声・テキスト）を **必ず保存**（後で再解析できる）

実装ロードマップ: `docs/roadmap.md`
