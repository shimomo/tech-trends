# tech-trends 設計書

作成日: 2026-10-18

## 1. 目的と背景

毎朝 5 分で「昨日、Web 系・AI 系で反応が多かったもの」を把握し、深掘りするかどうかを判断するための一覧ページ。
情報源は GitHub と Zenn の 2 つ。収集は GitHub Actions、公開は GitHub Pages のみで行い、サーバーやデータベースは持たない。

利用者は作者本人 1 人。PC のブラウザで見るのが主。

### なぜ作るか

- 普段見ている GitHub と Zenn で「話題になっていたのに気づかなかった」をなくしたい
- 要約や解説は不要。「どこで、何が、どれくらい反応を集めたか」だけ分かれば、読むかどうかは自分で決める

## 2. ゴール / 非ゴール / アンチゴール

### ゴール

- 1 日 1 回、自動で収集・公開される。手動操作なしで毎朝更新されている
- 1 日分の表示件数は GitHub 最大 10 件、Zenn 最大 10 件、合計 20 件前後
- 「🔥 急上昇」と「NEW 初登場」が一目で分かる
- 日付単位で過去に戻れる
- 関心領域（トピック一覧やしきい値）を設定ファイルで足し引きできる

### 非ゴール（今回は作らない）

- 通知（Slack、メール、RSS 配信など）
- 記事やリポジトリの要約・解説
- GitHub と Zenn 以外の情報源（X、Hacker News、Qiita など）。ただし後から足せる構造にはしておく
- 検索、絞り込み UI、お気に入り
- スマホ最適化。崩れない程度のレスポンシブは入れるが、設計は PC 幅を基準にする
- 認証・複数ユーザー

### アンチゴール（これになったら失敗）

- 1 日の表示件数が 30 件を超える。眺めるのに 5 分以上かかる
- ページを見るのにビルド工程が必要になる
- 収集が止まっているのに、ページ上で気づけない（古いデータが最新のように見える）
- 設定を変えるのにコードを読み解く必要がある

## 3. 制約

- GitHub Actions と GitHub Pages だけで動かす。外部サービス、外部 DB、有料枠は使わない
- 言語は TypeScript。実行環境は Node.js 22 以上（組み込み `fetch` を使う）
- 表示ページは素の HTML、CSS、JavaScript。フレームワーク、バンドラー、ビルド工程を持たない
- 認証情報は Actions が自動発行する `GITHUB_TOKEN` だけ。追加の Secrets は使わない
- Zenn の JSON API と GitHub Trending ページは**非公式**。壊れることを前提に、失敗が目に見える設計にする
- リポジトリは public（Pages を無料で使うため）。名前は `tech-trends`、作者のアカウント `shimomo` 配下

## 4. 全体像

```
[GitHub Actions: 毎日 JST 6:00 ごろ]
   collect (TypeScript, Node.js)
     ├─ GitHub Trending (HTML) → 候補リポジトリ → GitHub REST API で補完 → 絞り込み・順位付け
     └─ Zenn JSON API         → 候補記事      → 前日スナップショットと比較   → 絞り込み・順位付け
   → docs/data/YYYY-MM-DD.json, docs/data/index.json, docs/data/zenn-snapshot.json を書き出し
   → main ブランチにコミット & push
[GitHub Pages: main ブランチの /docs を配信]
   index.html + app.js + style.css が data/*.json を fetch してカードを描く
```

## 5. 情報源と「反応」の定義

### 5.1 GitHub

**取得元**: GitHub Trending ページ（`https://github.com/trending/{language}?since=daily`）。
対象リスト: 全言語、TypeScript、JavaScript、Python の 4 リスト。各リスト 25 件程度。

Trending は公式 API がないため HTML を解析する。1 行（`article.Box-row`）から次を読む。

- リポジトリ名（`owner/repo`）
- 説明文
- 主要言語
- 総スター数
- **今日のスター増加数**（"1,234 stars today"）。これを GitHub の「反応」とする

補完: 候補リポジトリごとに `GET /repos/{owner}/{repo}` を 1 回呼び、`topics`、`created_at`、`description`、`language`、`stargazers_count`、`html_url` を取る。
`GITHUB_TOKEN` 付きで呼び、1 回の収集で呼ぶのは最大 100 回程度（認証付きの上限 5,000 回/時に対して十分小さい）。

**絞り込み（Web 系・AI 系の判定）**: 次のいずれかに当たれば採用。

- 主要言語が設定の `github.languages` に含まれる（初期値: TypeScript、JavaScript）
- `topics` のいずれかが設定の `github.topics` に含まれる（初期値の例: `react` `nextjs` `vue` `svelte` `astro` `tailwindcss` `nodejs` `deno` `bun` `web` `frontend` `llm` `ai` `agents` `ai-agents` `machine-learning` `deep-learning` `rag` `openai` `anthropic` `claude` `langchain` `mcp`）
- 説明文または名前が設定の `github.keywords` の正規表現に当たる（初期値の例: `\b(ai|llm|agent|rag|gpt|claude|gemini|copilot|mcp)\b`、大文字小文字無視）

Python 製で Web/AI いずれにも当たらないもの（例: 数値計算、教材リポジトリ）はここで落ちる。

**順位付け**: 「今日のスター増加数」の降順。上位 10 件を採用。

**🔥 急上昇**: 今日のスター増加数が設定の `github.hotThreshold`（初期値 500）以上。
**NEW**: `created_at` が収集日から 7 日以内。

### 5.2 Zenn

**取得元**: Zenn の非公式 JSON API `https://zenn.dev/api/articles?topicname={topic}&order=daily&count={n}`。
`order=daily` はトピック内の「デイリートレンド」順で、`liked_count`（いいね数）、`published_at`、`title`、`path`、`user.username`、`user.name`、`emoji` が返る。`next_page` でページ送りできる。2026-10-18 時点で動作確認済み。

対象トピックは設定の `zenn.topics`（初期値の例: `react` `nextjs` `typescript` `javascript` `vue` `nuxt` `svelte` `astro` `tailwindcss` `nodejs` `deno` `bun` `frontend` `web` `llm` `ai` `生成ai` `openai` `chatgpt` `claude` `claudecode` `gemini` `rag` `aiエージェント` `mcp` `python`）。
トピックごとに 1〜2 ページ（合計 50 件程度）を取り、複数トピックに出る記事は `id` で 1 つにまとめる。

**候補の範囲**: `published_at` が収集日から `zenn.windowDays`（初期値 7）日以内のもの。

**反応の定義**: いいね数の**前日比増加**。
Zenn はその場で増加数が取れないので、収集ごとに候補全件の `id → liked_count` を `docs/data/zenn-snapshot.json` に保存し、翌日の収集で差分を取る。
前日のスナップショットにない記事は、増加数 = いいね数そのもの（初登場）として扱う。

**順位付け**: 増加数の降順、同数なら総いいね数の降順。上位 10 件を採用。
ただし総いいね数が設定の `zenn.minLikes`（初期値 10）未満のものは除く。

**🔥 急上昇**: 増加数が設定の `zenn.hotThreshold`（初期値 50）以上。
**NEW**: 前日のスナップショットになく、かつ `published_at` が 2 日以内。

### 5.3 初日の扱い

Zenn は初日はスナップショットがないため、全件が「増加数 = いいね数」になる。初日だけ NEW が多めに出るのは許容する。GitHub は Trending が増加数を直接返すので初日から正しく出る。

## 6. データ形式

すべて `docs/data/` 配下。Pages から `fetch` できる位置に置くため。

### `docs/data/index.json`

```json
{
  "dates": ["2026-10-19", "2026-10-18"],
  "generatedAt": "2026-10-18T21:05:12.000Z"
}
```

日付は新しい順。ページが「最新の日付」と「前日・翌日の移動」に使う。

### `docs/data/YYYY-MM-DD.json`（1 日分）

```json
{
  "date": "2026-10-19",
  "generatedAt": "2026-10-18T21:05:12.000Z",
  "items": [
    {
      "id": "github:openai/agents-sdk-ts",
      "source": "github",
      "title": "openai/agents-sdk-ts",
      "url": "https://github.com/openai/agents-sdk-ts",
      "description": "Build and run agents with tool use, handoffs and tracing",
      "language": "TypeScript",
      "topics": ["agents", "llm"],
      "total": 2340,
      "delta": 1900,
      "hot": true,
      "isNew": true,
      "publishedAt": "2026-10-15T09:00:00Z"
    },
    {
      "id": "zenn:670270",
      "source": "zenn",
      "title": "Next.js 16 の Cache Components を本番で使ってみた",
      "url": "https://zenn.dev/dev_taro/articles/nextjs16-cache",
      "author": "dev_taro",
      "emoji": "🧪",
      "topics": ["nextjs"],
      "total": 412,
      "delta": 130,
      "hot": true,
      "isNew": false,
      "publishedAt": "2026-10-16T20:54:20+09:00"
    }
  ],
  "errors": []
}
```

- `total` は総スター数 / 総いいね数、`delta` は当日の増加数。表示側は `source` で ★ と ♥ を切り替える
- `errors` は情報源単位の失敗を記録する配列（例: `[{"source":"zenn","message":"HTTP 503"}]`）。空なら正常
- 日付は JST 基準。`date` は**収集を実行した時点の JST の暦日**（朝 6 時に動けばその日）。中身は「その前 24 時間ほどの動き」だが、ファイル名とヘッダーは「見る日」で揃える。`generatedAt` は UTC の ISO 文字列

### `docs/data/zenn-snapshot.json`

```json
{
  "snapshots": [
    { "date": "2026-10-19", "likes": { "670270": 412, "670301": 88 } },
    { "date": "2026-10-18", "likes": { "670270": 282, "670301": 80 } }
  ]
}
```

候補全件（表示されなかったものも含む）のいいね数を、日付ごとに持つ。保持するのは「最新の日付」と「その直前の日付」の 2 つだけ。`windowDays` を過ぎた記事は収集時に捨てるので、サイズは数百件程度で安定する。

**同じ日に 2 回以上実行したとき**（cron の後に手動実行、設定変更の確認など）は冪等にする。

- 差分の比較対象は「実行日より前の日付のうち最新のスナップショット」。同日の前回分とは比べない
- 書き出し時は、実行日のスナップショットを**差し替え**、比較に使った前日分はそのまま残す
- 日次ファイル `YYYY-MM-DD.json` も同日なら上書き。`index.json` の日付配列に同じ日付を重複させない

これにより、同じ日に何度実行しても結果が（情報源側の値が動いた分を除いて）同じになる。

収集が数日止まった後は、比較対象が数日前のスナップショットになり、増加数が複数日分になる。これは許容する。いいね数が減った場合の `delta` は 0 に丸める。

### 保持期間

日次ファイルはすべて残す。1 日 10〜20KB 程度なので、数年分でも問題にならない。

## 7. ページ（GitHub Pages）

配信元: `main` ブランチの `/docs`。構成は `docs/index.html`、`docs/app.js`、`docs/style.css`、`docs/data/`。

### 表示（ブレインストーミングで選んだ案 C「カードのグリッド」）

- ヘッダー: 日付（例 `2026-10-18 (土)`）、「‹ 前日」「翌日 ›」ボタン、凡例（🔥 = 急上昇、NEW = 初登場）、最終更新時刻
- 本文: カードのグリッド。PC 幅で 3〜4 列。カード 1 枚 = 1 項目で、次を載せる
  - タイトル（リンク。GitHub は `owner/repo`、Zenn は記事タイトルに絵文字を添える）
  - 1 行目の補足（GitHub は説明文、Zenn は著者名）。長い場合は省略記号で切る
  - 下段に、情報源バッジ（GitHub / Zenn）、言語またはトピック、`★ 2.3k +1,900` / `♥ 412 +130` の形で総数と増加数
  - 🔥 のカードは枠色で強調し、タイトルの先頭に 🔥 を付ける。NEW は緑のラベル
- 並び順: 🔥 のカードを先頭にまとめ（増加数降順）、残りは GitHub と Zenn を順位ごとに交互に並べる（GitHub 1 位、Zenn 1 位、GitHub 2 位、…）。情報源の単位が違うため、総数で混ぜ比べない
- 日付の指定は URL のハッシュ（`#2026-10-17`）。ハッシュなしなら最新。前日・翌日ボタンは `index.json` の日付配列をたどる
- `errors` が空でない場合は、ヘッダー下に「Zenn の取得に失敗しました（HTTP 503）」のように注意書きを出す
- 最新日付が今日（JST）でなく、かつ JST 9:00 を過ぎていれば、「収集が止まっている可能性があります」と目立つ警告を出す（アンチゴール「気づけない」対策）。cron の遅れを見込んで 9:00 までは出さない。1 回の失敗でその朝のうちに気づける

### 技術的な注意

- `fetch` の相対パス（`data/index.json`）で読む。Pages のサブパス配信（`https://shimomo.github.io/tech-trends/`）でも動くよう、絶対パスは使わない
- 外部ライブラリは読み込まない。CDN 依存も持たない
- ダークモード対応は `prefers-color-scheme` で色だけ切り替える程度でよい

## 8. GitHub Actions

### `collect.yml`

- トリガー: `schedule`（cron `0 21 * * *`、UTC 21:00 = JST 6:00）と `workflow_dispatch`（手動実行）
- 権限: `contents: write`
- 手順: checkout → Node.js 22 セットアップ → `npm ci` → `npm run collect` → `docs/data/` に差分があればコミットして push
- コミットメッセージは `data: 2026-10-18` のような固定形式。コミッターは `github-actions[bot]`
- `concurrency` で同時実行を 1 本に制限する（手動実行と cron の衝突防止）
- cron は数十分遅れることがある。JST 6:00 指定で「起きた頃には更新されている」を狙う

### 失敗時の振る舞い

方針: **取れた分でページを更新し、失敗は必ず赤くする**。部分的に取れたものを捨てない。

- 一方の情報源が丸ごと失敗しても、もう一方の結果で日次ファイルを書き、`errors` に記録してコミットする
- そのうえで、`errors` が 1 件でもあれば収集ジョブは**非ゼロで終了**し、Actions 上で赤く見えるようにする（コミットは失敗より前に済ませ、後続ステップは `if: always()` で動かす）
- 両方失敗した場合も `items` が空の日次ファイルを書く。ページ側は「本日は取得できませんでした」と出す
- Trending の解析結果が 0 件だった場合は HTML 構造が変わった可能性が高いので、そのリストの失敗として扱う

**部分失敗の扱い**。`errors` の要素は `{ "source": "zenn", "scope": "topic:react", "message": "HTTP 503" }` のように、情報源より細かい `scope` を持てる。

- Zenn のトピック単位の失敗: 1 回リトライし、それでも駄目ならそのトピックを `errors` に記録して残りで続行する。スナップショットは「今回取れた記事は新しい値、取れなかった記事は前日の値を引き継ぐ」形で**マージ**して書く。こうしないと、落ちたトピックの記事が翌日「前日にない = 初登場」と誤判定され、偽の 🔥 / NEW が出る
- GitHub の Trending リスト単位の失敗: 同様に 1 回リトライし、`errors` に記録して残りのリストで続行する
- GitHub の `GET /repos` の失敗: 404（削除・改名）はその候補を黙って落とす。レート制限は `retry-after` を尊重して待つ。それ以外の失敗は、Trending から取れた情報だけ（言語、説明文、名前）で絞り込みにかけ、`topics` は空、`isNew` は false とし、`errors` に記録する

### `ci.yml`

- トリガー: `push` と `pull_request`
- 手順: lint、型チェック、テスト

### Pages の有効化

リポジトリ設定で「Deploy from a branch: main / docs」を 1 回選ぶ。これは `gh api` で自動化できるので、セットアップ手順として README に書く。

## 9. リポジトリ構成

```
tech-trends/
├── .github/workflows/
│   ├── collect.yml
│   └── ci.yml
├── config.json              # トピック、キーワード、しきい値、件数（利用者が編集する唯一のファイル）
├── src/
│   ├── main.ts              # エントリポイント。日付決定 → 各ソース収集 → 選別 → 書き出し
│   ├── config.ts            # config.json の読み込みと検証
│   ├── types.ts             # Item、DayFile、Snapshot などの型
│   ├── sources/
│   │   ├── github.ts        # Trending の取得・解析、REST API での補完
│   │   └── zenn.ts          # JSON API の取得、スナップショット差分
│   ├── select.ts            # 絞り込み、順位付け、hot/new 判定、並び順
│   └── write.ts             # docs/data/ への書き出し（index.json の更新を含む）
├── tests/                   # ユニットテスト。Trending の HTML と Zenn の JSON はフィクスチャとして保存
├── docs/                    # Pages の配信ルート
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── data/
│   └── superpowers/specs/   # この設計書
├── package.json
├── tsconfig.json
└── README.md
```

### `config.json` の形

```json
{
  "github": {
    "trendingLists": ["", "typescript", "javascript", "python"],
    "languages": ["TypeScript", "JavaScript"],
    "topics": ["react", "nextjs", "llm", "ai", "agents"],
    "keywords": ["\\b(ai|llm|agent|rag|gpt|claude|gemini|copilot|mcp)\\b"],
    "maxItems": 10,
    "hotThreshold": 500,
    "newWithinDays": 7
  },
  "zenn": {
    "topics": ["react", "nextjs", "typescript", "llm", "claude"],
    "pagesPerTopic": 2,
    "windowDays": 7,
    "minLikes": 10,
    "maxItems": 10,
    "hotThreshold": 50,
    "newWithinDays": 2
  }
}
```

初期値の完全なリストは実装時に埋める。読み込み時に形を検証し、間違っていれば分かりやすいエラーで止める。

## 10. 決めたこと（作者の判断）と、その理由

ブレインストーミングで作者が決めた点:

- 情報源は GitHub と Zenn
- 関心領域は Web 系と AI 系
- 言語は TypeScript、ページは素の HTML
- 表示は案 C（カードのグリッド、急上昇と初登場を強調）
- 主に PC で見る

設計者（Claude）の判断として決めた点。変えても構わない:

- **GitHub は Trending の HTML を解析する**。Search API でも「直近 N 日に作られてスターが多い」は取れるが、既存リポジトリの再燃を拾えず、増加数も自前のスナップショットが要る。Trending は「今日のスター数」を直接返すので、求めているものに最も近い。非公式である点は、解析失敗を明示的なエラーにして補う
- **GitHub の増加数は Trending の値、Zenn の増加数はスナップショット差分**。情報源ごとに取れるものが違うので、無理に揃えない
- **並び順は 🔥 を先頭、以降は情報源を交互**。総数の単位が違うので混ぜ比べない
- **データはリポジトリにコミットして溜める**。Pages のアーティファクト配信だと履歴が残らない。コミット方式なら Git が履歴とバックアップを兼ねる
- **一部失敗でも書いてコミットし、その後に失敗させる**。ページは最新に近づけつつ、Actions 上では赤くして気づけるようにする。トピックやリスト単位の部分失敗も同じ方針で、取れた分は使い、スナップショットは前日分とマージして偽の NEW を防ぐ
- **日付は「実行した朝の JST 暦日」**。中身は前日の動きだが、「見る日」で揃える方が前日・翌日の移動と停止検知が素直になる
- **同日の再実行は冪等**。Zenn のスナップショットを日付つきで 2 世代持ち、同日の前回分とは比べない。設定変更を日中に試しても当日分を壊さない
- **停止検知は「今日の分がなく、JST 9:00 を過ぎている」**。1 回の失敗でその朝に気づける
- **ツール類**: 実行は `tsx`、テストは Vitest、lint と整形は Biome、HTML 解析は `node-html-parser`。依存を最小にしつつ、TypeScript 単体で完結させる
- リポジトリは public、名前は `tech-trends`

## 11. 実装者に任せること

- Trending HTML の具体的なセレクタと、構造変化に対する防御の度合い
- GitHub REST API の呼び出し並列数とリトライ（レート制限の `retry-after` を尊重すること）
- Zenn API のページ送りと `count` の上限の確認
- `config.json` の初期値（トピック、キーワード）の最終的な中身
- カードの具体的な寸法、色、フォント。ただし「PC 幅で 3〜4 列、1 画面で 20 件が見渡せる」は守る
- テストの粒度。ただし、Trending の解析と Zenn の差分計算、hot/new 判定、並び順の 4 点はフィクスチャつきのユニットテストを必ず持つ
- README のセットアップ手順（Pages の有効化、手動実行の方法、`config.json` の編集方法）

## 12. 受け入れ条件

- `workflow_dispatch` で手動実行すると、`docs/data/YYYY-MM-DD.json` と `index.json` がコミットされ、数分後に Pages のページで当日のカードが見える
- 翌日の自動実行後、ページを開くと新しい日付が表示され、「‹ 前日」で前日に戻れる
- `config.json` のトピックを 1 つ増やして手動実行すると、そのトピックの記事が候補に入る
- Zenn の API を意図的に失敗させる（URL を壊す）と、GitHub の結果だけでファイルがコミットされ、ページに注意書きが出て、Actions の実行は失敗（赤）になる
- 同じ日に手動実行を 2 回続けても、2 回目の `delta` と 🔥 / NEW が 1 回目と同じになる（同日の前回分と比べていない）
- `npm test` が通り、Trending の HTML フィクスチャと Zenn の JSON フィクスチャで解析と選別が検証されている
