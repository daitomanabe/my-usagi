# Task: my-usagi 会話型ペットアプリ開発

## Overview

3歳の子ども向け「会話して育つウサギ」Webアプリ（PWA）と親向け成長ダッシュボードを開発する。

### コンセプト
- 子どもが話しかける → ウサギが返事（音声/テキスト）
- 遊びの中でウサギが感想・相槌
- 生活習慣を自然に提案（説教しない）
- 会話・音声を保存 → 言語発達のログとして親が閲覧

### 技術スタック
- Frontend: PWA (public/)
- Backend: Cloudflare Workers (src/index.ts)
- State: Durable Objects（会話セッション/短期記憶）
- DB: D1（ログ・語彙・要約・リマインド設定）
- Blob: R2（音声: raw / TTS キャッシュ）
- Async: Queues（解析・再解析・日次サマリ）
- Scheduler: Cron Triggers（時間ベースのリマインド/日次集計）

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

## ⚠️ LOOP_COMPLETE時の追加処理

LOOP_COMPLETEを発行する前に:
1. `COMPLETION_REPORT.md` を生成
2. 最終 git push

## Hat Roles

### Git Setup
- Git/GitHub初期化、失敗時は即終了
- 完了後: ログ記録 → git push → git.ready

### Architect
- システム設計、API仕様策定
- specs/配下に設計ドキュメント生成
- 完了後: ログ記録 → git push → specs.ready.backend, specs.ready.frontend

### Backend Developer
- Cloudflare Workers実装 (src/)
- Durable Objects, D1, R2, Queues, Cron
- 安全性考慮（3歳向けLLM直結リスク）
- 完了後: ログ記録 → git push → backend.done

### Frontend Developer
- PWA実装 (public/)
- 子ども向けUI + 親向けダッシュボード
- 音声入出力（MediaRecorder, TTS）
- 完了後: ログ記録 → git push → frontend.done

### Integrator
- 統合テスト、最終確認
- wrangler devでの動作確認
- 完了後: ログ記録 → git push
- LOOP_COMPLETE時: COMPLETION_REPORT.md生成 → 最終push → LOOP_COMPLETE

## 設計方針（絶対に外さない）

1. **音声は必ず保存**
   - 音声認識精度は今後上がる
   - raw audioをR2に保存、後で再解析可能に

2. **"私のウサギ感"**
   - 口調/記憶/成長の一貫性
   - Durable Objectsで短期記憶管理

3. **繰り返しの価値**
   - 同じフレーズはTTSを一度生成して保存
   - R2キャッシュで速度・安定性・コスト改善

4. **安全（事故らない）**
   - 3歳にLLM直結のリスク考慮
   - 安全なプロンプト設計
   - 拒否・保護者介入導線

## Success Criteria

- [ ] 子どもが話しかける → ウサギが音声で返事
- [ ] 会話ログがD1に保存される
- [ ] 音声ファイルがR2に保存される
- [ ] 親ダッシュボードで会話履歴を閲覧できる
- [ ] PWAとしてインストール可能
- [ ] wrangler dev でローカル動作確認済み
- [ ] 全変更がremoteにpush済み
- [ ] .agent/iteration.log が最新
- [ ] COMPLETION_REPORT.md が生成済み
- [ ] LOOP_COMPLETE

## 開発順序（推奨）

1. API設計（エンドポイント、データモデル）
2. Backend: 基本APIスケルトン
3. Frontend: 子ども向けUI基本構造
4. Backend: 音声処理（R2保存、ASR連携）
5. Frontend: 音声入出力実装
6. Backend: LLM連携、会話生成
7. Frontend: 親ダッシュボード
8. 統合テスト

## 参考資料

- `docs/overview.md`: コンセプト詳細
- `docs/tech-design.md`: 技術設計
- `docs/roadmap.md`: 実装ロードマップ
- `docs/research/`: ブラウザ音声認識、Cloudflareリンク集
