# AGENTS.md

このファイルはリポジトリで作業するAIエージェント向けのガイドラインです。

## プロジェクト概要

基本的な四則演算を実装したJavaScriptユーティリティライブラリです。Jestによるテストを備えています。

## リポジトリ構成

```
.
├── index.js        # 四則演算関数 (add, subtract, multiply, divide)
├── index.test.js   # Jestテスト
└── package.json    # npm設定 (jest ^29)
```

## 開発コマンド

```bash
npm install       # 依存パッケージのインストール
npm test          # 全テストの実行 (jest)
```

## コード規約

- CommonJS モジュール形式（`require` / `module.exports`）を使用
- TypeScript・ビルドステップなし
- パラメータ化テストには `test.each` を優先使用

## テストのガイドライン

- 変更後は必ず `npm test` を実行して既存テストが通ることを確認する
- 浮動小数点のアサーションには `toBeCloseTo` を使用する
- 正常系・境界値（0、負数）・異常系を網羅する
- `divide(a, 0)` は `Error('Division by zero')` をスローする仕様を変更しない

## エージェントへの注意事項

- 外部ランタイム依存パッケージはユーザーに確認してから追加する
- 関数は副作用のない純粋関数に保つ
- 四則演算関数はすべて `index.js` に実装し `module.exports` でエクスポートする
