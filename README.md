# tech-trends

GitHub Trending と Zenn から、Web 系・AI 系で「反応が多かったもの」を毎朝 1 回集めて、1 ページで眺めるための仕組み。
GitHub Actions が収集してリポジトリにコミットし、GitHub Pages がそれを配信する。サーバーもデータベースも使わない。

ページ: https://shimomo.github.io/tech-trends/

## 何が見えるか

- 1 日あたり GitHub 最大 10 件、Zenn 最大 10 件のカード
- 🔥 は前日比で急上昇（GitHub: 今日のスター増加数、Zenn: いいね数の前日比増加）
- NEW は初登場（GitHub: 作成から 7 日以内、Zenn: 前日の記録になく公開 2 日以内）
- 「‹ 前日」「翌日 ›」で過去の日に戻れる。URL の `#2026-10-18` でも指定できる
- 収集が止まっていると、ページ上部に警告が出る

## 仕組み

```
GitHub Actions (毎日 06:00 JST ごろ)
  npm run collect
    ├─ GitHub Trending (HTML) → GitHub REST API で補完 → 関心領域で絞る → スター増加数順
    └─ Zenn API (トピック別デイリー) → 前日スナップショットと比較 → いいね増加数順
  → docs/data/YYYY-MM-DD.json, index.json, zenn-snapshot.json をコミット
GitHub Pages (main ブランチの /docs)
  index.html + app.js が JSON を読んでカードを描く
```

GitHub Trending のページと Zenn の JSON API はどちらも**非公式**。構造が変わると収集が失敗するが、
その場合は Actions の実行が赤くなり、ページにも注意書きが出る。取れた分は表示される。

## セットアップ

1. リポジトリを作成して push する（public。Pages を無料で使うため）
2. Pages を有効化する（`main` ブランチの `/docs` を配信）

   ```bash
   gh api -X POST repos/shimomo/tech-trends/pages \
     -f build_type=legacy -f 'source[branch]=main' -f 'source[path]=/docs'
   ```

3. 最初の収集を手動で実行する

   ```bash
   gh workflow run collect.yml
   gh run watch
   ```

   数分後に https://shimomo.github.io/tech-trends/ に当日のカードが出る。

以降は毎日 06:00 JST ごろに自動で動く。GitHub の cron は数十分遅れることがある。

## 設定（config.json）

利用者が編集するのはこのファイルだけ。

| キー | 意味 |
| --- | --- |
| `github.trendingLists` | 読む Trending のリスト。`""` は全言語 |
| `github.languages` | この言語のリポジトリは無条件に採用 |
| `github.topics` | このトピックを持つリポジトリを採用 |
| `github.keywords` | 名前か説明文に当たる正規表現（大文字小文字無視）で採用 |
| `github.maxItems` / `hotThreshold` / `newWithinDays` | 表示件数、🔥 のスター増加数、NEW とみなす日数。全言語リストの上位は日に 500〜3000 スター伸びるので、🔥 が多すぎる／少なすぎると感じたらここを動かす |
| `zenn.topics` | 読む Zenn のトピック |
| `zenn.pagesPerTopic` | トピックごとに読むページ数（1 ページ 48 件） |
| `zenn.windowDays` | 公開からこの日数以内の記事だけを候補にする |
| `zenn.minLikes` | いいね数がこれ未満の記事は出さない |
| `zenn.maxItems` / `hotThreshold` / `newWithinDays` | 表示件数、🔥 のいいね増加数、NEW とみなす日数 |

## ローカルで動かす

```bash
npm ci
GITHUB_TOKEN=$(gh auth token) npm run collect   # docs/data/ に書く
python3 -m http.server 8765 -d docs             # http://localhost:8765/
npm test
```

`GITHUB_TOKEN` が無くても動くが、GitHub API が匿名扱い（60 回/時）になり、補完が途中で失敗することがある。
同じ日に何度実行しても結果は変わらない（Zenn の差分は前日のスナップショットと比べる）。

## 構成

- `src/` 収集スクリプト（TypeScript、Node.js 22）
- `docs/` Pages の配信ルート。`index.html` `app.js` `style.css` と `data/`
- `config.json` 設定
- `docs/superpowers/` 設計書と実装計画
