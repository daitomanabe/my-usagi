# Task: my-usagi Phase 2 - AI統合とPWA強化

## Overview

Phase 1で完成した基盤に、Cloudflare Workers AIを統合し、本格的な会話機能を実装する。

### Phase 1 完了済み
- ✅ API エンドポイント（8個）
- ✅ D1 スキーマ（5テーブル）
- ✅ Durable Objects（ConversationSession）
- ✅ Queue Consumer（語彙分析）
- ✅ 子どもUI + 親ダッシュボード
- ✅ TypeScript コンパイル通過

### Phase 2 目標
1. **ASR統合**: Whisper で音声認識
2. **LLM統合**: Llama で会話生成（3歳向け安全プロンプト）
3. **TTS統合**: 音声合成
4. **形態素解析**: kuromoji で語彙抽出精度向上
5. **PWA強化**: オフラインキャッシュ、アイコン
6. **デプロイ準備**: 手順書作成

## ⚠️ CRITICAL: 毎iteration必須事項

**全てのHatは作業完了後、イベント発行前に必ず実行:**

1. `.agent/iteration.log` に記録を追記
   ```
   [{ISO8601}] iteration #{n} | {Hat名} | {状態} | {概要}
   ```

2. Git commit & push
   ```bash
   git add -A
   git commit -m "[Ralph] {Hat名}: {完了内容}"
   git push origin main
   ```

## Cloudflare Workers AI 利用方法

### wrangler.jsonc に追加
```json
{
  "ai": {
    "binding": "AI"
  }
}
```

### ASR (Whisper)
```typescript
const transcription = await env.AI.run('@cf/openai/whisper', {
  audio: audioArrayBuffer,
});
// transcription.text が認識結果
```

### LLM (Llama)
```typescript
const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage }
  ],
  max_tokens: 150,
});
// response.response が生成テキスト
```

### 3歳向けシステムプロンプト例
```
あなたは「うさぴょん」という名前の優しいウサギです。
3歳の子どもと楽しくおしゃべりします。

ルール:
- ひらがなとカタカナだけ使う
- 短い文で話す（20文字以内）
- 「〜だよ」「〜ね」など優しい言い方
- 危ないこと、怖いことは言わない
- 質問されたらシンプルに答える
- 遊びや日常のことを楽しく話す
```

## kuromoji-wasm 利用方法

```typescript
import { Tokenizer } from 'kuromoji-wasm';

const tokenizer = await Tokenizer.create();
const tokens = tokenizer.tokenize('おはようございます');
// tokens = [{ surface_form: 'おはよう', ... }, ...]
```

## Service Worker キャッシュ戦略

```javascript
const CACHE_NAME = 'my-usagi-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/manifest.webmanifest'
];

// Install: 静的アセットをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

// Fetch: キャッシュファースト、ネットワークフォールバック
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
```

## Hat Roles

### Planner
- Phase 2 タスク計画
- specs/phase2-plan.md 作成
- 完了後: plan.ready.ai, plan.ready.pwa

### AI Integrator
- Cloudflare Workers AI 統合
- ASR (Whisper) 実装
- LLM (Llama) 実装
- 3歳向け安全プロンプト
- kuromoji 形態素解析
- 完了後: ai.done

### PWA Enhancer
- Service Worker キャッシュ
- PWA アイコン生成
- オフライン対応
- 完了後: pwa.done

### Deployer
- TypeScript コンパイル確認
- wrangler dev 動作確認
- DEPLOY_GUIDE.md 作成
- 完了後: LOOP_COMPLETE

## Success Criteria

- [ ] ASR: 音声入力 → テキスト変換が動作
- [ ] LLM: 3歳向け安全な応答が生成される
- [ ] TTS: テキスト → 音声が動作（または代替策）
- [ ] 形態素解析: 語彙抽出精度が向上
- [ ] PWA: オフラインでも基本機能が動作
- [ ] アイコン: インストール時に表示される
- [ ] wrangler dev でローカル動作確認済み
- [ ] DEPLOY_GUIDE.md が作成済み
- [ ] 全変更がremoteにpush済み
- [ ] LOOP_COMPLETE

## 参考ドキュメント

- Cloudflare Workers AI: https://developers.cloudflare.com/workers-ai/
- kuromoji: https://github.com/nickmalleson/kuromoji-wasm
- PWA: https://web.dev/progressive-web-apps/
