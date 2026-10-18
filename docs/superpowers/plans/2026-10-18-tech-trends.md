# tech-trends 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Trending と Zenn から Web 系・AI 系の「反応が多かったもの」を毎朝 1 回収集し、GitHub Pages のカードグリッドで見せる仕組みを、GitHub Actions と Pages だけで動かす。

**Architecture:** TypeScript の収集スクリプト（`src/`）が Trending の HTML と Zenn の JSON API を読み、絞り込み・順位付けした結果を `docs/data/YYYY-MM-DD.json` に書いてコミットする。ページ（`docs/`）は素の HTML + ES モジュールの JS で、その JSON を fetch してカードを描く。HTTP とスリープは注入可能にし、テストは実ネットワークに触れない。

**Tech Stack:** Node.js 22（組み込み fetch）、TypeScript（ESM、strict）、tsx、Vitest、Biome、node-html-parser。ページ側は依存ゼロ。

**Spec:** `docs/superpowers/specs/2026-10-18-tech-trends-design.md`

## Global Constraints

- 実行環境は Node.js 22 以上。`package.json` の `engines.node` は `>=22`
- 認証情報は `GITHUB_TOKEN` のみ。環境変数 `GITHUB_TOKEN` が無くても動く（Trending は匿名で取れる。REST API は匿名だと 60 回/時なので警告ログを出す）
- 表示ページはビルドなし、外部ライブラリ・CDN なし。`fetch` は相対パス（`data/...`）のみ
- 日付は JST 基準。`date` は収集実行時の JST 暦日。`generatedAt` は UTC の ISO 文字列
- 1 日の表示は GitHub 最大 10 件、Zenn 最大 10 件
- `errors` が 1 件でもあれば収集プロセスは非ゼロ終了。ただし書き出しは終了前に済ませる
- 同じ日の再実行は冪等（Zenn の差分は「実行日より前の最新スナップショット」と比べる）
- Trending リストの解析結果が 0 件なら、そのリストは失敗扱い
- 依存パッケージは `node-html-parser` と開発用（typescript、tsx、vitest、biome）のみ
- コミットメッセージは Conventional Commits（`feat:` `test:` `docs:` `chore:` `ci:`）

## Review Focus

- Trending の行に言語表示や "stars today" が無い（新しすぎる／言語未判定のリポジトリ）。解析は落ちず、`language: null`、`starsToday: 0` になること → Task 3
- 同じ Zenn 記事が複数トピックから返る。1 件にまとまり、`topics` が和集合になること → Task 6
- 収集が数日止まった後の実行。比較対象が数日前のスナップショットになっても落ちず、複数日分の増加として扱うこと → Task 7
- GitHub REST API がレート制限（403/429 + `retry-after`）を返す。待ってリトライし、候補を落とさないこと → Task 4
- ページで URL ハッシュに存在しない日付を指定した／日付が 1 つしかない。最新にフォールバックして注意書きを出し、前日・翌日ボタンは端で無効になること → Task 10

## File Structure

```
tech-trends/
├── .github/workflows/collect.yml   # 毎朝の収集とコミット
├── .github/workflows/ci.yml        # lint・型チェック・テスト
├── config.json                     # 利用者が編集する設定
├── package.json, tsconfig.json, biome.json, .gitignore
├── src/
│   ├── types.ts        # Item, DayFile, IndexFile, Snapshot*, CollectError, Config*
│   ├── config.ts       # config.json の読み込みと検証
│   ├── dates.ts        # JST 暦日、日数差
│   ├── http.ts         # Http 型（fetch と sleep の注入）、retry、mapLimit
│   ├── sources/
│   │   ├── trending.ts # Trending HTML の解析（純粋関数）
│   │   ├── github.ts   # Trending 取得 + REST API 補完 → GithubCandidate[]
│   │   └── zenn.ts     # Zenn API 取得 → ZennArticle[]（重複統合、期間絞り込み）
│   ├── snapshot.ts     # Zenn スナップショットの前日選択・マージ・2 世代保持
│   ├── select/
│   │   ├── github.ts   # 関心領域の判定、順位付け、hot/new → Item[]
│   │   ├── zenn.ts     # 差分計算、順位付け、hot/new → Item[]
│   │   └── order.ts    # 🔥 先頭、残りは情報源交互
│   ├── write.ts        # docs/data/ の読み書き
│   ├── collect.ts      # runCollect(deps): 全体の流れ
│   └── cli.ts          # エントリポイント（process.exit）
├── tests/
│   ├── fixtures/trending-typescript.html, zenn-llm-daily.json
│   └── *.test.ts
└── docs/
    ├── index.html, app.js, style.css, .nojekyll
    └── data/            # 収集結果（初回は Task 12 で生成）
```

フィクスチャの元ファイルは `/tmp/claude-1000/-home-shimomo-github-shimomo/ffce1173-f0b6-4460-970c-15c80430e081/scratchpad/fixtures/` にある（Task 3 と Task 6 でコピー）。無くなっていた場合の再生成方法は各 Task に書く。

---

### Task 1: プロジェクト雛形と設定ファイル

**Files:**
- Create: `package.json`, `tsconfig.json`, `biome.json`, `.gitignore`, `config.json`, `src/types.ts`, `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `src/types.ts` の型（後続すべてが使う）

```ts
export type Source = "github" | "zenn";
export interface Item {
  id: string; source: Source; title: string; url: string;
  description?: string; author?: string; emoji?: string;
  language?: string | null; topics: string[];
  total: number; delta: number; hot: boolean; isNew: boolean;
  publishedAt: string; // ISO。不明なら ""
}
export interface CollectError { source: Source; scope?: string; message: string }
export interface DayFile { date: string; generatedAt: string; items: Item[]; errors: CollectError[] }
export interface IndexFile { dates: string[]; generatedAt: string }
export interface SnapshotEntry { likes: number; publishedAt: string }
export interface Snapshot { date: string; articles: Record<string, SnapshotEntry> }
export interface SnapshotFile { snapshots: Snapshot[] }
export interface GithubConfig {
  trendingLists: string[]; languages: string[]; topics: string[]; keywords: string[];
  maxItems: number; hotThreshold: number; newWithinDays: number;
}
export interface ZennConfig {
  topics: string[]; pagesPerTopic: number; windowDays: number; minLikes: number;
  maxItems: number; hotThreshold: number; newWithinDays: number;
}
export interface Config { github: GithubConfig; zenn: ZennConfig }
```

- Produces: `src/config.ts` の `parseConfig(json: unknown): Config`（形が違えば `Error("config.github.maxItems must be a number")` のようにパスを含むメッセージで throw）と `loadConfig(path: string): Promise<Config>`

注: 設計書の `zenn-snapshot.json` は `likes: {id: number}` だが、期間外の記事を捨てるために `articles: {id: {likes, publishedAt}}` に拡張する（計画者の判断。設計書 6 章の意図は変えない）。

- [ ] **Step 1: 雛形を作る**

`npm init -y` のあと次を設定。`"type": "module"`、`"engines": {"node": ">=22"}`、scripts: `collect: tsx src/cli.ts`、`test: vitest run`、`typecheck: tsc --noEmit`、`lint: biome check .`、`format: biome format --write .`。
`npm i node-html-parser` と `npm i -D typescript tsx vitest @biomejs/biome @types/node`。
`tsconfig.json`: `target ES2022`、`module NodeNext`、`moduleResolution NodeNext`、`strict true`、`noEmit true`、`include ["src","tests","docs/app.js"]`、`allowJs true`、`checkJs false`。
`biome.json`: recommended ルール、インデントはスペース 2、`docs/data/**` と `tests/fixtures/**` を無視。
`.gitignore`: `node_modules/`、`.superpowers/`。

- [ ] **Step 2: `config.json` を設計書 9 章の形で書く**

初期値: `github.trendingLists = ["", "typescript", "javascript", "python"]`、`languages = ["TypeScript", "JavaScript"]`、`topics` は設計書 5.1 の例をすべて、`keywords = ["\\b(ai|llm|agents?|rag|gpt|claude|gemini|copilot|mcp)\\b"]`、`maxItems 10`、`hotThreshold 500`、`newWithinDays 7`。
`zenn.topics` は設計書 5.2 の例をすべて、`pagesPerTopic 2`、`windowDays 7`、`minLikes 10`、`maxItems 10`、`hotThreshold 50`、`newWithinDays 2`。

- [ ] **Step 3: 失敗するテストを書く** `tests/config.test.ts`

```ts
test("parseConfig accepts the shipped config.json", async () => {
  const cfg = await loadConfig("config.json");
  expect(cfg.github.maxItems).toBe(10);
  expect(cfg.zenn.topics).toContain("react");
});
test("parseConfig rejects a non-number threshold with the path in the message", () => {
  const bad = JSON.parse(JSON.stringify(validConfig)); bad.zenn.hotThreshold = "50";
  expect(() => parseConfig(bad)).toThrow("config.zenn.hotThreshold must be a number");
});
test("parseConfig rejects an invalid keyword regex", () => {
  const bad = structuredClone(validConfig); bad.github.keywords = ["("];
  expect(() => parseConfig(bad)).toThrow("config.github.keywords[0]");
});
```

- [ ] **Step 4: 落ちることを確認** `npx vitest run tests/config.test.ts` → FAIL（モジュールが無い）
- [ ] **Step 5: `src/types.ts` と `src/config.ts` を実装**（外部バリデータは使わず手書きで検証）
- [ ] **Step 6: 通ることを確認** `npx vitest run tests/config.test.ts` → PASS。`npm run typecheck` と `npm run lint` も通す
- [ ] **Step 7: Commit** `chore: scaffold project with config loader`

---

### Task 2: 日付ユーティリティと HTTP ヘルパー

**Files:**
- Create: `src/dates.ts`, `src/http.ts`
- Test: `tests/dates.test.ts`, `tests/http.test.ts`

**Interfaces:**
- Produces (`src/dates.ts`):
  - `jstDate(now: Date): string` — JST の暦日 `YYYY-MM-DD`
  - `daysBetween(fromIso: string, toDate: string): number` — `fromIso` の JST 暦日から `toDate` までの日数（同日 0、未来は負）
  - `withinDays(iso: string, today: string, days: number): boolean` — `0 <= daysBetween <= days`
- Produces (`src/http.ts`):
  - `interface Http { fetch: typeof fetch; sleep: (ms: number) => Promise<void> }`
  - `realHttp(): Http`
  - `fetchWithRetry(http: Http, url: string, init: RequestInit, opts: { retries: number; retryOn: (res: Response) => boolean }): Promise<Response>` — `retryOn` が真、またはネットワーク例外なら `retries` 回まで再試行。429/403 で `retry-after` ヘッダがあればその秒数、無ければ `2 ** attempt` 秒待つ
  - `mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]>` — 順序保持

- [ ] **Step 1: 失敗するテストを書く**

```ts
// dates
expect(jstDate(new Date("2026-10-18T21:05:12Z"))).toBe("2026-10-19");
expect(jstDate(new Date("2026-10-18T14:59:59Z"))).toBe("2026-10-18");
expect(daysBetween("2026-10-16T20:54:20+09:00", "2026-10-19")).toBe(3);
expect(withinDays("2026-10-12T00:00:00+09:00", "2026-10-19", 7)).toBe(true);
expect(withinDays("2026-10-11T23:59:59+09:00", "2026-10-19", 7)).toBe(false);
// http
test("fetchWithRetry waits retry-after seconds then succeeds", async () => {
  const sleeps: number[] = [];
  const responses = [new Response("", { status: 403, headers: { "retry-after": "3" } }), new Response("ok", { status: 200 })];
  const http = { fetch: async () => responses.shift()!, sleep: async (ms) => { sleeps.push(ms); } };
  const res = await fetchWithRetry(http, "u", {}, { retries: 2, retryOn: (r) => r.status === 403 });
  expect(res.status).toBe(200); expect(sleeps).toEqual([3000]);
});
test("fetchWithRetry gives up after retries and returns the last response", ...); // 3 回 503 → status 503
test("mapLimit preserves order and never exceeds the limit", ...); // 同時実行数をカウンタで検証
```

- [ ] **Step 2: 落ちることを確認** → FAIL
- [ ] **Step 3: 実装** `jstDate` は `Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" })` で `YYYY-MM-DD` を得る。ライブラリは入れない
- [ ] **Step 4: 通ることを確認** → PASS
- [ ] **Step 5: Commit** `feat: add date and http helpers`

---

### Task 3: Trending HTML の解析

**Files:**
- Create: `src/sources/trending.ts`, `tests/fixtures/trending-typescript.html`
- Test: `tests/trending.test.ts`

**Interfaces:**
- Produces: `interface TrendingRow { fullName: string; description: string | null; language: string | null; stars: number; starsToday: number }` と `parseTrending(html: string): TrendingRow[]`

- [ ] **Step 1: フィクスチャをコピー** scratchpad の `fixtures/trending-typescript.html` を `tests/fixtures/` へ。5 行入りで、5 行目（`example/nolang`）は言語と "stars today" を意図的に外してある。無い場合は `curl -A Mozilla https://github.com/trending/typescript?since=daily` の `<article class="Box-row">` を 4 つ残し、1 つ複製して `itemprop="programmingLanguage"` の span と `stars today` の span を削って作る

- [ ] **Step 2: 失敗するテストを書く**

```ts
const rows = parseTrending(readFileSync("tests/fixtures/trending-typescript.html", "utf8"));
test("parses every Box-row", () => expect(rows).toHaveLength(5));
test("reads name, description, language, stars and stars today", () => {
  expect(rows[0]).toEqual({ fullName: "anomalyco/opencode", description: "The open source coding agent.", language: "TypeScript", stars: 215922, starsToday: 1417 });
});
test("a row without language or stars today yields null and 0", () => {
  expect(rows[4]).toMatchObject({ fullName: "example/nolang", language: null, starsToday: 0 });
});
test("returns [] for html without rows", () => expect(parseTrending("<html></html>")).toEqual([]));
```

- [ ] **Step 3: 落ちることを確認** → FAIL
- [ ] **Step 4: 実装** `node-html-parser` で `article.Box-row` を列挙。名前は `h2 a` の `href` から先頭の `/` を除く。説明は最初の `p` のテキストを trim（無ければ null）。言語は `span[itemprop=programmingLanguage]`。総スターは `a[href$="/stargazers"]` のテキストからカンマを除いて数値化。stars today は行テキストに `/([\d,]+) stars today/` を当てる
- [ ] **Step 5: 通ることを確認** → PASS
- [ ] **Step 6: Commit** `feat: parse GitHub Trending html`

---

### Task 4: GitHub の取得と REST API 補完

**Files:**
- Create: `src/sources/github.ts`
- Test: `tests/github.test.ts`

**Interfaces:**
- Consumes: `parseTrending`、`Http`、`fetchWithRetry`、`mapLimit`、`GithubConfig`、`CollectError`
- Produces:
  - `interface GithubCandidate extends TrendingRow { url: string; topics: string[]; createdAt: string | null; enriched: boolean }`
  - `fetchTrendingList(language: string, http: Http): Promise<TrendingRow[]>` — URL は `https://github.com/trending/${language}?since=daily`（`""` なら `https://github.com/trending?since=daily`）。HTTP エラー、または 0 行なら throw（メッセージに `"0 rows"` を含める）
  - `enrichRepo(fullName: string, http: Http, token?: string): Promise<{ topics: string[]; createdAt: string; description: string | null; language: string | null; stars: number; url: string } | null>` — `GET https://api.github.com/repos/${fullName}`、ヘッダ `Accept: application/vnd.github+json`、token があれば `Authorization: Bearer`。404 は null。403/429/5xx は `fetchWithRetry`（retries 3）。それでも失敗なら throw
  - `collectGithub(cfg: GithubConfig, http: Http, token?: string): Promise<{ candidates: GithubCandidate[]; errors: CollectError[] }>` — 各リストを取得（失敗は 1 回リトライし、駄目なら `{source:"github", scope:"list:<language>", message}` を記録して続行）。`fullName` で重複統合（`starsToday` は大きい方）。`mapLimit` 5 並列で補完。404 は候補から除く。補完失敗は `enriched:false, topics:[], createdAt:null` で残し `scope:"repo:<fullName>"` を記録

- [ ] **Step 1: 失敗するテストを書く**（`http.fetch` は URL で分岐するスタブ。フィクスチャ HTML を全リストに返す）

```ts
test("collectGithub merges lists, enriches and keeps order-independent results", async () => {
  // 4 リストとも同じフィクスチャ → 候補は 5 件（重複統合）。/repos/* は topics ["agents"], created_at "2026-10-15T00:00:00Z" を返す
  expect(candidates).toHaveLength(5); expect(candidates[0].topics).toEqual(["agents"]); expect(errors).toEqual([]);
});
test("a list that fails twice is recorded and the others continue", async () => {
  // typescript リストだけ 500 を 2 回 → errors に scope "list:typescript"、候補は残りのリストから
});
test("a list with zero rows is treated as a failure", ...); // "<html></html>" → scope "list:python", message に "0 rows"
test("404 on enrichment drops the candidate silently", ...); // 1 件 404 → candidates 4 件、errors []
test("rate limit with retry-after is retried, not dropped", async () => {
  // 最初の /repos/anomalyco/opencode を 403 + retry-after: 1、2 回目 200 → enriched true、sleep に 1000 が記録、errors []
});
test("enrichment failure after retries keeps the candidate unenriched", ...); // 500 ×4 → enriched false, errors に scope "repo:..."
```

- [ ] **Step 2: 落ちることを確認** → FAIL
- [ ] **Step 3: 実装**（トークン無しのときは `console.warn` で「匿名のため 60 回/時」と出す）
- [ ] **Step 4: 通ることを確認** → PASS
- [ ] **Step 5: Commit** `feat: collect GitHub trending candidates with REST enrichment`

---

### Task 5: GitHub の絞り込みと順位付け

**Files:**
- Create: `src/select/github.ts`
- Test: `tests/select-github.test.ts`

**Interfaces:**
- Consumes: `GithubCandidate`、`GithubConfig`、`withinDays`
- Produces:
  - `matchesInterest(c: GithubCandidate, cfg: GithubConfig): boolean` — 言語が `cfg.languages` に含まれる、または `topics` と `cfg.topics` が交わる、または `cfg.keywords` のいずれかの正規表現（`i` フラグ）が `fullName` か `description` に当たる
  - `selectGithub(candidates: GithubCandidate[], cfg: GithubConfig, today: string): Item[]` — `matchesInterest` で絞り、`starsToday` 降順（同数は `stars` 降順）で `maxItems` 件。`Item` は `id: "github:" + fullName`、`title: fullName`、`total: stars`、`delta: starsToday`、`hot: delta >= hotThreshold`、`isNew: createdAt != null && withinDays(createdAt, today, newWithinDays)`、`publishedAt: createdAt ?? ""`

- [ ] **Step 1: 失敗するテストを書く**

```ts
test("matches by language, topic or keyword, and rejects the rest", () => {
  expect(matchesInterest(cand({ language: "TypeScript" }), cfg)).toBe(true);
  expect(matchesInterest(cand({ language: "Python", topics: ["llm"] }), cfg)).toBe(true);
  expect(matchesInterest(cand({ language: "Python", description: "An AI toolkit" }), cfg)).toBe(true);
  expect(matchesInterest(cand({ language: "Python", description: "Numerical routines" }), cfg)).toBe(false);
});
test("ranks by stars today and caps at maxItems", ...); // 12 件入れて 10 件、delta 降順
test("hot and isNew follow the thresholds", () => {
  // starsToday 500 → hot true, 499 → false。createdAt が today-7 日 → isNew true、today-8 日 → false、null → false
});
```

- [ ] **Step 2: 落ちることを確認** → FAIL
- [ ] **Step 3: 実装**
- [ ] **Step 4: 通ることを確認** → PASS
- [ ] **Step 5: Commit** `feat: select GitHub items by interest and stars today`

---

### Task 6: Zenn の取得

**Files:**
- Create: `src/sources/zenn.ts`, `tests/fixtures/zenn-llm-daily.json`
- Test: `tests/zenn.test.ts`

**Interfaces:**
- Consumes: `Http`、`fetchWithRetry`、`ZennConfig`、`withinDays`、`CollectError`
- Produces:
  - `interface ZennArticle { id: number; title: string; url: string; likedCount: number; publishedAt: string; username: string; name: string; emoji: string; topics: string[] }`
  - `fetchZennTopic(topic: string, pages: number, http: Http): Promise<ZennArticle[]>` — `https://zenn.dev/api/articles?topicname=${encodeURIComponent(topic)}&order=daily&count=48&page=${p}` を `p = 1..pages`、`next_page` が null なら打ち切り。`url` は `"https://zenn.dev" + path`。HTTP エラーは throw
  - `collectZenn(cfg: ZennConfig, http: Http, today: string): Promise<{ candidates: ZennArticle[]; errors: CollectError[] }>` — トピックごとに取得（失敗は 1 回リトライ、駄目なら `scope:"topic:<topic>"` を記録して続行）。`id` で統合し `topics` は和集合（設定順）。`withinDays(publishedAt, today, windowDays)` で絞る

- [ ] **Step 1: フィクスチャをコピー** scratchpad の `fixtures/zenn-llm-daily.json`（5 件、`next_page: 2`）。無ければ `curl 'https://zenn.dev/api/articles?topicname=llm&order=daily&count=5'` の結果を保存

- [ ] **Step 2: 失敗するテストを書く**

```ts
test("fetchZennTopic maps the api shape", async () => {
  const [a] = await fetchZennTopic("llm", 1, http);
  expect(a).toEqual({ id: 663665, title: expect.stringContaining("階層ナビゲーション型RAG"), url: "https://zenn.dev/aiforall/articles/8e1803396534de", likedCount: 22, publishedAt: "2026-10-16T11:30:05.084+09:00", username: "aifnishina", name: expect.any(String), emoji: "🌲", topics: ["llm"] });
});
test("fetchZennTopic stops when next_page is null", ...); // page 1 の next_page を null にした応答 → fetch は 1 回だけ
test("collectZenn merges the same article from two topics with topics unioned", async () => {
  // topics ["llm","ai"] 両方が同じフィクスチャ → 候補の id 663665 は 1 件、topics ["llm","ai"]
});
test("collectZenn drops articles outside windowDays", ...); // today "2026-10-25", windowDays 7 → 10-16 公開は除外、10-18 は残る
test("a failing topic is retried once then recorded", ...); // "ai" が 503 ×2 → errors [{source:"zenn", scope:"topic:ai"}]、"llm" の候補は残る
```

- [ ] **Step 3: 落ちることを確認** → FAIL
- [ ] **Step 4: 実装**
- [ ] **Step 5: 通ることを確認** → PASS
- [ ] **Step 6: Commit** `feat: collect Zenn candidates per topic`

---

### Task 7: Zenn スナップショットと選別

**Files:**
- Create: `src/snapshot.ts`, `src/select/zenn.ts`
- Test: `tests/snapshot.test.ts`, `tests/select-zenn.test.ts`

**Interfaces:**
- Consumes: `Snapshot`、`SnapshotFile`、`ZennArticle`、`ZennConfig`、`withinDays`
- Produces (`src/snapshot.ts`):
  - `previousSnapshot(file: SnapshotFile, today: string): Snapshot | null` — `date < today` のうち最新
  - `mergeSnapshot(prev: Snapshot | null, fetched: ZennArticle[], today: string, windowDays: number): Snapshot` — `date: today`。`fetched` の値を入れ、`prev` にあって `fetched` に無い記事は `publishedAt` が期間内なら引き継ぐ
  - `upsertSnapshot(file: SnapshotFile, snap: Snapshot): SnapshotFile` — `snap` と「`snap.date` より前で最新の 1 つ」だけを残す（同日は差し替え）
- Produces (`src/select/zenn.ts`):
  - `selectZenn(candidates: ZennArticle[], prev: Snapshot | null, cfg: ZennConfig, today: string): Item[]` — `likedCount >= minLikes` で絞る。`delta = prev に id あり ? max(0, likedCount - prev.likes) : likedCount`。`isNew = prev に id なし && withinDays(publishedAt, today, newWithinDays)`。`delta` 降順、同数は `likedCount` 降順で `maxItems` 件。`Item` は `id: "zenn:" + id`、`title`、`url`、`author: name`（空なら username）、`emoji`、`topics`、`total: likedCount`、`hot: delta >= hotThreshold`、`publishedAt`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// snapshot
test("previousSnapshot ignores today's own snapshot", () => { /* dates [10-19, 10-18], today 10-19 → 10-18 */ });
test("previousSnapshot works across a gap of several days", () => { /* dates [10-14], today 10-19 → 10-14 */ });
test("mergeSnapshot carries over unfetched articles still inside the window", () => {
  // prev に A(10-15 公開), B(10-05 公開)。fetched は C のみ。today 10-19, window 7 → A と C が残り、B は消える
});
test("upsertSnapshot replaces the same date and keeps exactly one earlier snapshot", () => {
  // file [10-19(古い), 10-18, 10-17] に 10-19(新) → [10-19(新), 10-18]
});
// select
test("delta is the increase since the previous snapshot, floored at 0", () => { /* prev 300 → now 412 = 112; prev 50 → now 40 = 0 */ });
test("an article absent from the previous snapshot uses its full like count and is new only if recent", () => {
  // today 10-19: published 10-18 → isNew true; published 10-10 → isNew false; どちらも delta = likedCount
});
test("filters minLikes, sorts by delta then total, caps maxItems, sets hot", ...);
test("running twice on the same day yields identical items", () => {
  // prev = 10-18 スナップショット、today 10-19。selectZenn を 2 回呼ぶ（2 回目は mergeSnapshot(prev, fetched, "2026-10-19") を previousSnapshot で選び直した結果を渡す）→ 深い等価
});
```

- [ ] **Step 2: 落ちることを確認** → FAIL
- [ ] **Step 3: 実装**
- [ ] **Step 4: 通ることを確認** → PASS
- [ ] **Step 5: Commit** `feat: zenn snapshot diffing and selection`

---

### Task 8: 並び順とファイル書き出し

**Files:**
- Create: `src/select/order.ts`, `src/write.ts`
- Test: `tests/order.test.ts`, `tests/write.test.ts`

**Interfaces:**
- Produces (`src/select/order.ts`): `orderItems(github: Item[], zenn: Item[]): Item[]` — `hot` を先頭に `delta` 降順。残りは GitHub 1 位、Zenn 1 位、GitHub 2 位…と交互（片方が尽きたら残りを続ける）
- Produces (`src/write.ts`、`dir` は `docs/data` の絶対パス):
  - `writeDayFile(dir: string, day: DayFile): Promise<void>` — `${day.date}.json` を 2 スペースインデントで上書き
  - `updateIndex(dir: string, date: string, generatedAt: string): Promise<IndexFile>` — `index.json` を読み（無ければ空）、`date` を重複なく入れ、降順に並べて書く
  - `readSnapshotFile(dir: string): Promise<SnapshotFile>` — 無ければ `{snapshots: []}`
  - `writeSnapshotFile(dir: string, file: SnapshotFile): Promise<void>` — `zenn-snapshot.json`

- [ ] **Step 1: 失敗するテストを書く**（`write` は `fs.mkdtemp` の一時ディレクトリで）

```ts
test("hot items come first by delta, then sources alternate by rank", () => {
  // github [g1(hot,1900), g2(880), g3(600)], zenn [z1(hot,130), z2(90)] → [g1, z1, g2, z2, g3]
});
test("updateIndex inserts once and sorts descending", async () => {
  await updateIndex(dir, "2026-10-18", t); await updateIndex(dir, "2026-10-19", t); const idx = await updateIndex(dir, "2026-10-18", t);
  expect(idx.dates).toEqual(["2026-10-19", "2026-10-18"]);
});
test("writeDayFile overwrites the same date", ...);
test("readSnapshotFile returns an empty file when missing", ...);
```

- [ ] **Step 2: 落ちることを確認** → FAIL
- [ ] **Step 3: 実装**
- [ ] **Step 4: 通ることを確認** → PASS
- [ ] **Step 5: Commit** `feat: order items and write data files`

---

### Task 9: 収集の全体フローと CLI

**Files:**
- Create: `src/collect.ts`, `src/cli.ts`
- Test: `tests/collect.test.ts`

**Interfaces:**
- Consumes: Task 4〜8 のすべて、`jstDate`、`loadConfig`、`realHttp`
- Produces: `interface RunDeps { config: Config; http: Http; token?: string; now: Date; dataDir: string }` と `runCollect(deps: RunDeps): Promise<{ day: DayFile; exitCode: 0 | 1 }>`

流れ: `today = jstDate(now)` → `collectGithub` と `collectZenn` を `Promise.all` → `readSnapshotFile` → `prev = previousSnapshot` → `selectGithub`、`selectZenn` → `orderItems` → `DayFile { date: today, generatedAt: now.toISOString(), items, errors }` → `writeDayFile`、`updateIndex`、`writeSnapshotFile(upsertSnapshot(file, mergeSnapshot(prev, zennCandidates, today, windowDays)))` → `exitCode = errors.length ? 1 : 0`。
Zenn が丸ごと失敗（候補 0 かつ errors あり）した場合はスナップショットを更新しない（前日分を壊さない）。
`src/cli.ts`: `loadConfig("config.json")`、`process.env.GITHUB_TOKEN`、`dataDir = path.resolve("docs/data")`、`console.log` で件数と errors を出し、`process.exit(exitCode)`。

- [ ] **Step 1: 失敗するテストを書く**（fetch スタブ: Trending はフィクスチャ、`/repos/*` は固定 JSON、Zenn はフィクスチャ）

```ts
test("writes the day file, index and snapshot and exits 0 on success", async () => {
  const { day, exitCode } = await runCollect(deps);
  expect(exitCode).toBe(0); expect(day.date).toBe("2026-10-19");
  expect(day.items.some((i) => i.source === "github")).toBe(true);
  expect(JSON.parse(await readFile(`${dir}/index.json`, "utf8")).dates).toEqual(["2026-10-19"]);
  expect(JSON.parse(await readFile(`${dir}/zenn-snapshot.json`, "utf8")).snapshots[0].date).toBe("2026-10-19");
});
test("a failing source still writes the file, records the error and exits 1", async () => {
  // Zenn が全トピック 503 → day.errors.length > 0、github の items はある、exitCode 1、zenn-snapshot.json は書かれない
});
test("both sources failing writes an empty items file and exits 1", ...);
```

- [ ] **Step 2: 落ちることを確認** → FAIL
- [ ] **Step 3: 実装**
- [ ] **Step 4: 通ることを確認** → PASS。さらに `npm run collect` を実ネットワークで 1 回動かし、`docs/data/` に当日のファイルができることを目視する。生成物は Task 10 の目視確認に使うので残すが、この計画の中ではコミットしない（`git add` しない。`.gitignore` にも入れない。Actions が書く場所なので）
- [ ] **Step 5: Commit** `feat: end-to-end collect run and cli`

---

### Task 10: 表示ページ

**Files:**
- Create: `docs/index.html`, `docs/app.js`, `docs/style.css`, `docs/.nojekyll`
- Test: `tests/app.test.ts`

**Interfaces:**
- Produces (`docs/app.js`、ES モジュール。末尾で `if (typeof document !== "undefined") main();`）:
  - `formatCount(n: number): string` — `999` 以下はそのまま、以上は `2.3k`、`100k` 以上は `216k`
  - `formatDelta(n: number): string` — `+1,900`（0 なら `±0`）
  - `dateLabel(date: string): string` — `2026-10-18 (土)`
  - `isStale(latestDate: string, now: Date): boolean` — JST で `latestDate !== today` かつ JST 9:00 以降
  - `resolveDate(hash: string, dates: string[]): { date: string | null; fallback: boolean }` — `#2026-10-17` が `dates` にあればそれ。無ければ最新で `fallback: true`。`dates` が空なら `date: null`
  - `renderCard(item: Item): string` — HTML 文字列。`escapeHtml` を通す。`hot` なら `class="card hot"` と先頭 🔥、`isNew` なら `<span class="new">NEW</span>`、情報源バッジ、GitHub は `★ {formatCount(total)} {formatDelta(delta)}`、Zenn は `♥ ...`
  - `main()` — `data/index.json` → `resolveDate(location.hash)` → `data/${date}.json` → 描画。`hashchange` で再描画。前日・翌日ボタンは `dates` の端で `disabled`。`errors` があれば `.notice` に「{source} の取得に失敗しました（{message}）」、`fallback` なら「指定の日付が無いため最新を表示しています」、`isStale` なら `.warning` に「収集が止まっている可能性があります（最新: {date}）」。`items` が空なら「本日は取得できませんでした」

- [ ] **Step 1: 失敗するテストを書く**（`import { ... } from "../docs/app.js"`）

```ts
expect(formatCount(412)).toBe("412"); expect(formatCount(2340)).toBe("2.3k"); expect(formatCount(215922)).toBe("216k");
expect(formatDelta(1900)).toBe("+1,900"); expect(formatDelta(0)).toBe("±0");
expect(dateLabel("2026-10-18")).toBe("2026-10-18 (土)");
expect(isStale("2026-10-18", new Date("2026-10-18T23:30:00Z"))).toBe(false); // JST 10-19 08:30
expect(isStale("2026-10-18", new Date("2026-10-19T00:00:00Z"))).toBe(true);  // JST 10-19 09:00
expect(isStale("2026-10-19", new Date("2026-10-19T03:00:00Z"))).toBe(false);
expect(resolveDate("#2026-10-17", ["2026-10-19", "2026-10-18"])).toEqual({ date: "2026-10-19", fallback: true });
expect(resolveDate("", [])).toEqual({ date: null, fallback: false });
test("renderCard escapes html and marks hot/new", () => {
  const html = renderCard({ ...item, title: "<b>x</b>", hot: true, isNew: true });
  expect(html).toContain("&lt;b&gt;x&lt;/b&gt;"); expect(html).toContain('class="card hot"'); expect(html).toContain("NEW");
});
```

- [ ] **Step 2: 落ちることを確認** → FAIL
- [ ] **Step 3: `docs/app.js`、`docs/index.html`、`docs/style.css`、空の `docs/.nojekyll` を書く**

`index.html` は `<script type="module" src="app.js">`、ヘッダー（日付、前日・翌日ボタン、凡例、最終更新）、`.notice`/`.warning`、`#grid`。
`style.css`: PC 幅で `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`（1280px で 4 列）、カードは枠線と角丸、`.hot` は枠色をオレンジ系、`.new` は緑のラベル、`prefers-color-scheme: dark` で背景と文字色を反転。1 画面で 20 件が見渡せるよう余白は控えめ。

- [ ] **Step 4: 通ることを確認** → PASS
- [ ] **Step 5: ブラウザで目視** Task 9 で生成した `docs/data/` を使い `npx serve docs`（または `python3 -m http.server -d docs`）で開く。カードが並ぶこと、`#存在しない日付` で注意書きが出ること、ダークモードで読めることを確認
- [ ] **Step 6: Commit** `feat: static page rendering daily cards`

---

### Task 11: GitHub Actions と README

**Files:**
- Create: `.github/workflows/collect.yml`, `.github/workflows/ci.yml`, `README.md`

- [ ] **Step 1: `collect.yml` を書く**

`on: schedule: [{cron: "0 21 * * *"}]` と `workflow_dispatch`。`permissions: contents: write`。`concurrency: { group: collect, cancel-in-progress: false }`。
ジョブ: `actions/checkout@v4` → `actions/setup-node@v4`（`node-version: 22`、`cache: npm`）→ `npm ci` → `id: collect` / `continue-on-error: true` / `env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` で `npm run collect` → `if: always()` で `git config user.name "github-actions[bot]"`、`user.email "41898282+github-actions[bot]@users.noreply.github.com"`、`git add docs/data`、差分があれば `git commit -m "data: $(date -u +%Y-%m-%d)"` と `git push` → `if: steps.collect.outcome == 'failure'` で `exit 1`。

- [ ] **Step 2: `ci.yml` を書く** `push` と `pull_request` で `npm ci` → `npm run lint` → `npm run typecheck` → `npm test`
- [ ] **Step 3: YAML を検証** `node -e 'require("yaml")'` は依存に無いので、`npx --yes yaml-lint .github/workflows/*.yml` か `python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/*.yml` → エラーなし
- [ ] **Step 4: README を書く** 目的（2 行）、ページ URL（`https://shimomo.github.io/tech-trends/`）、セットアップ（リポジトリ作成、Pages 有効化コマンド `gh api -X POST repos/shimomo/tech-trends/pages -f build_type=legacy -f 'source[branch]=main' -f 'source[path]=/docs'`、手動実行 `gh workflow run collect.yml`）、`config.json` の各キーの意味、ローカル実行 `GITHUB_TOKEN=$(gh auth token) npm run collect`、非公式 API に依存している注意
- [ ] **Step 5: Commit** `ci: add collect and ci workflows with readme`

---

### Task 12: 公開と受け入れ確認

この Task は外部に公開する操作を含む。**実行前に作者に確認する**（public リポジトリ `shimomo/tech-trends` を作る、Pages を有効にする）。

- [ ] **Step 1: リポジトリ作成と push** `gh repo create shimomo/tech-trends --public --source . --push --description "Daily Web/AI tech trends from GitHub and Zenn"`
- [ ] **Step 2: Pages を有効化** README のコマンド。`gh api repos/shimomo/tech-trends/pages -q .html_url` が URL を返す
- [ ] **Step 3: 手動実行** `gh workflow run collect.yml` → `gh run watch`。失敗していれば原因を直してから進む（errors があれば赤になるのは仕様。ログで errors の中身を確認し、非公式 API の一時障害でなければ修正）
- [ ] **Step 4: コミットの確認** ローカルで生成した未追跡の `docs/data/` を削除してから `git pull` し、`data: YYYY-MM-DD` コミットが入り、`docs/data/index.json` に当日が 1 つだけあること
- [ ] **Step 5: 同日再実行の冪等性** もう一度 `gh workflow run collect.yml` → 新しいコミットの `YYYY-MM-DD.json` の `items` の `delta`/`hot`/`isNew` が前回と同じ（情報源側の値が動いた分を除く）、`index.json` に重複が無いこと
- [ ] **Step 6: ページの確認** `https://shimomo.github.io/tech-trends/` を開き、カードが並ぶこと。`ci.yml` が緑であること
- [ ] **Step 7: 受け入れ条件の残り** 設計書 12 章の「トピックを 1 つ増やして手動実行」はローカル実行で確認（`config.json` に `zenn.topics` を 1 つ足し `npm run collect`、ログの候補数が増える）。終わったら設定は戻す
