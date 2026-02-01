# GitHubをAIが見て更新する開発ループ（設計）

目的:
- 公開GitHubで開発しつつ、AIが **リポジトリの現状を読んだ上で** パッチを作り、PRとして出す
- 人間（あなた）がレビューしてマージする

**結論**: “常時監視”ではなく **イベント駆動（手動/限定トリガ）** が現実的で安全。

## なぜ常時監視がダメか
- GitHub Actions / bot が継続監視するにはインフラが要る
- 何より **公開repoで自動実行トリガを開くとSecretsが死ぬ**
  - issueコメントで起動 → 他人がコメント → Actionsが走る → LLM API key を燃やされる/漏れる

## 推奨フロー（安全側）
1. あなたが Issue を立てる（要件・受け入れ条件を書く）
2. `workflow_dispatch` で “AI patch” ワークフローを手動実行
3. Actions が:
   - リポジトリをチェックアウト
   - 指定Issue内容 + 必要ファイルをコンテキストとして LLM に渡す
   - 変更案を生成
   - ブランチを作りコミット
   - PR を作る
4. あなたが PR をレビューしてマージ

## ガードレール（最低限）
- Actions の `permissions` は最小化
- トリガは `workflow_dispatch` のみ（最初は）
- どうしても issue_comment を使うなら:
  - `if: github.event.comment.author_association == 'OWNER'` などでOWNERのみに限定
  - さらに `permissions: read-all` を基本にし、書き込みは必要なジョブだけ

## 実装の雛形
- `.github/workflows/ai-pr.yml` に雛形を入れてある（デフォルトは workflow_dispatch のみ）
- `scripts/ai/ai_patch.mjs` は placeholder。実際には:
  - LLM API（Anthropic/OpenAI等）を叩く
  - “パッチ形式”で出力させて適用する（unified diff など）
  - 失敗時は落とす

## 現実的な運用Tips
- AIに「設計の一貫性」を守らせるために、`docs/tech-design.md` を “Single source of truth” にする
- PRは小さく切る（差分が大きいほどAIの事故率が上がる）
- CIを必須にする（typecheck、lint、簡単なテスト）
