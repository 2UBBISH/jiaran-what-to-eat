# 嘉然今天吃什么 · 清华食堂抽签（GitHub Pages 前端）

抽 **饭堂 + 楼层**，再推送一个 **菜系** 给你，并列出这一层里该菜系的菜。
纯静态站点：没有服务器、没有数据库，抽签在本机浏览器里跑，结果可复现、可分享。
内容支持**在线新增**：管理台把新菜/新饭堂提交进仓库，Actions 自动重新部署。

```
docs/                              ← GitHub Pages 站点根目录
├── index.html                     抽签页（抽饭堂+楼层 → 推送菜系）
├── admin.html                     内容管理台（在线上传内容）
├── upload.html                    自选菜快传（手机上高频传图用）
├── package.json                   仅用于让 Node 以 ESM 方式跑测试
├── .nojekyll                      关闭 Jekyll 处理
└── assets/
    ├── css/                       tokens / base / components / views 四层设计系统
    ├── js/
    │   ├── core/                  纯逻辑：rng / menu / lottery / share / format（无 DOM、无网络）
    │   ├── data/                  数据层：契约 + static / mock / github / http 四种数据源
    │   ├── ui/                    视图：draw / browse / admin + 组件与 DOM 工具
    │   ├── app.js                 抽签页装配（index.html）
    │   ├── admin.js               管理台装配（admin.html）
    │   ├── store.js / router.js   状态与 hash 路由
    │   └── userData.js            本机历史 / 收藏 / 偏好
    ├── data/                      构建产物 + 线上贡献内容 + 上传接口 schema（见 1 节）
    └── uploads/                   在线上传的图片
```

---

## 1. 上传接口（对外契约 v1）

给其他 agent / 脚本看的接口说明。**必填只有五项：饭菜图片 + 饭堂 + 楼层 + 窗口 + 价格**，
其余都可以不传，系统会补默认值。

机器可读版本：`docs/assets/data/intake-schema.json`（JSON Schema，`x-interface-version: v1`）。
该 schema 与代码常量 `docs/assets/js/core/intake.js` 的 `INTAKE_SPEC` 由测试强制保持一致，
改一边不改另一边会测试失败。

### 1.1 最小请求（一条）

```json
{
  "image": "assets/uploads/20260920-abc.jpg",
  "canteen": "澜园",
  "floor": "一楼",
  "window": "自选窗口",
  "price": "12"
}
```

规范化后的内部记录（自动补全）：

```json
{
  "id": "20260920-dk3f9",
  "kind": "dish",
  "createdAt": "2026-09-20T04:12:33.000Z",
  "author": "匿名同学",
  "payload": {
    "canteenId": "lan_yuan",
    "floor": "1F",
    "stallName": "自选窗口",
    "name": "自选菜",
    "unnamed": true,
    "priceText": "12",
    "cuisines": [],
    "spicyLevel": 0,
    "tags": [],
    "reviewLabel": "好评",
    "reviewText": null,
    "image": "assets/uploads/20260920-abc.jpg",
    "date": "2026-09-20",
    "mealSlots": ["lunch", "dinner"],
    "vegetarian": null
  }
}
```

### 1.2 四种调用方式

| 方式 | 适合谁 | 怎么做 |
| --- | --- | --- |
| **A. 写 JSON 文件 + git push** | agent / 脚本（推荐，不需要 Token） | 图片放 `docs/assets/uploads/`，一条内容一个文件放 `docs/assets/data/contributions/<id>.json`，然后 commit & push |
| **B. JS 接口** | 页面/Node 脚本 | `const { normalizeIntakeBatch } = core/intake` 规范化 → `source.saveMany(records, { images })` |
| **C. HTTP 后端** | 以后接自建服务 | `POST {base}/batch`，body `{ "records": [...], "images": [{name, mime, base64}] }` |
| **D. 网页上传** | 手机上人工传 | `upload.html`（自选菜快传）/ `admin.html`（完整表单） |

方式 A 的完整步骤（可直接照抄）：

```bash
# 1) 放图片（文件名建议 日期-随机.jpg，避免撞名）
cp ~/photo.jpg docs/assets/uploads/20260920-abc.jpg

# 2) 写一条内容：直接写「1.1 的最小请求」就行，不需要包 payload
cat > docs/assets/data/contributions/20260920-abc.json <<'JSON'
{
  "image": "assets/uploads/20260920-abc.jpg",
  "canteen": "澜园",
  "floor": "一楼",
  "window": "自选窗口",
  "price": "¥12",
  "name": "红烧肉"
}
JSON

# 3) 提交（contributions/index.json 由 GitHub Actions 自动重建，不用手改）
git add docs/assets/uploads docs/assets/data/contributions
git commit -m "content: 澜园 1F 自选窗口 红烧肉"
git push          # 约 1 分钟后线上生效
```

**两种格式都收**（`core/menu.js` 的 `prepareContribution`）：

| 写进 `contributions/*.json` 的内容 | 是否接受 | 说明 |
| --- | --- | --- |
| 裸接口格式（1.1 的五项 + 可选字段） | ✅ | 前端读取时自动规范化，并生成**稳定 id**（按内容指纹，刷新不变） |
| 内部记录格式 `{ id, kind, payload }` | ✅ | 网页上传写出的就是这种，老数据也兼容 |
| 裸接口格式但 `image` 用 base64 | ❌ | 文件方式不支持内联图片：请把图片放进 `docs/assets/uploads/` 并写路径，或改用 `upload.html` / `saveMany` 接口 |

> 文件名可以随便取（建议 `日期-序号.json`，便于人工排查）；`_` 开头的文件会被忽略，
> `contributions/index.json` 由 CI 维护，不要手改。

### 1.3 字段规范

必填（缺任何一个都会被拒绝）：

| 字段 | 类型 | 说明 | 别名 |
| --- | --- | --- | --- |
| `image` | string \| object | 饭菜图片，见 1.4 | `imageUrl` `photo` `photoUrl` `pic` |
| `canteen` | string | 饭堂，中文名或 id | `canteenId` `canteenName` `hall` |
| `floor` | string | 楼层，见 1.4；空字符串 = 未标注 | `floorId` `floorLabel` |
| `window` | string | 窗口名，≤40 字 | `stall` `stallName` `counter` |
| `price` | string \| number | 价格，必须能解析出数字 | `priceText` `cost` |

可选（不传就用默认值）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `name` | `自选菜` | 菜名，≤40 字；留空时按图片去重 |
| `date` | 今天 | `YYYY-MM-DD`；**带日期的菜只当天有效**，第二天自动退场 |
| `cuisines` | `[]` | 菜系 id 或中文名；留空归入「未标菜系」，仍能被抽签推送 |
| `spicyLevel` | `0` | 0-3，或 `不辣/微辣/中辣/重辣` |
| `reviewLabel` | `好评` | 也可用 `强烈推荐/值得一试/两极/信息较少` |
| `reviewText` | `null` | 评价正文，≤400 字 |
| `tags` | `[]` | 需来自数据里的标签词表，如 `["必点"]` |
| `author` | `匿名同学` | 上传者昵称 |
| `id` | 自动生成 | 建议留空；重复 id 会覆盖同一条 |

### 1.4 取值容错规则（写错也有人兜）

| 字段 | 接受 | 规范化结果 |
| --- | --- | --- |
| `floor` | `1F` `f1` `1` `一层` `一楼` `1楼` | `1F` |
| | `""` `-` `未标注` `未知` `none` | `null` |
| | 其他（如 `9F`） | ❌ 报错「楼层无法识别」 |
| `price` | `12`（数字）、`"12"`、`"¥12"`、`"12-15"`、`"10元以下"`、`"按重量约20"` | 文本原样保留，数字则格式化为 `¥12` |
| | 不含数字（如 `"很便宜"`） | ❌ 报错「价格里没有数字」 |
| `canteen` | id `lan_yuan` / 中文名 `澜园` | `lan_yuan` |
| | 不存在 | ❌ 报错并**列出全部可用饭堂名** |
| `cuisines` | `sichuan` / `川菜` / `家常菜` | `homestyle` 等 id |
| | 多个候选（如 `菜`） | ❌ 报错「有歧义，请用 id」 |
| `image` | `assets/uploads/a.jpg` | 原样 |
| | `https://cdn…/a.jpg` | 原样（外链） |
| | `a.jpg`（裸文件名） | `assets/uploads/a.jpg` |
| | `data:image/jpeg;base64,…` | 落盘为 `assets/uploads/intake-*.jpg` |
| | `{"name":"a.jpg","base64":"…"}` | `assets/uploads/a.jpg` |
| | 其他（如 `ftp://…`） | ❌ 报错「图片地址无法识别」 |
| `spicyLevel` | `0/1/2/3`、`不辣/微辣/中辣/重辣` | `0-3` |
| `name` | 不传 / 空 | `自选菜`，并标记 `unnamed: true` |

### 1.5 批量上传

```json
{
  "records": [
    { "image": "assets/uploads/a.jpg", "canteen": "澜园", "floor": "1F", "window": "自选窗口", "price": "12", "name": "红烧肉" },
    { "image": "assets/uploads/b.jpg", "canteen": "澜园", "floor": "1F", "window": "自选窗口", "price": "6" },
    { "image": {"name": "c.jpg", "base64": "/9j/4AAQ…"}, "canteen": "听涛园", "floor": "2F", "window": "桂林米粉", "price": "9" }
  ]
}
```

**一条坏不影响其他**：成功的照常入库，失败的返回下标与原因：

```json
{
  "records": [ { "id": "20260920-d1", "kind": "dish", "payload": { "…": "…" } } ],
  "assets": [ { "name": "c.jpg", "base64": "…" } ],
  "failed": [
    { "index": 1, "errors": ["饭堂无法识别：不存在（可用中文名或 id；现有：荷园、紫荆园、观畴园…）"] }
  ]
}
```

### 1.6 常见报错与处理

| 报错 | 原因 | 处理 |
| --- | --- | --- |
| `饭堂无法识别：xxx` | 饭堂名/ id 不对 | 用报错信息里列出的名字，或先跑 `GET assets/data/canteens.json` 取 id |
| `楼层无法识别：9F` | 楼层不在 1F/2F/3F | 用 `1F`，或留空表示未标注 |
| `价格里没有数字：很便宜` | 价格没有数字 | 传 `"12"` 这类可解析值 |
| `缺少饭菜图片` / `图片地址无法识别` | image 缺失或格式怪 | 用约定路径 / 外链 / base64 对象 |
| `菜系不存在：xxx` / `有歧义` | 菜系名不对 | 用 `GET assets/data/cuisines.json` 里的 id |
| `date 需为 YYYY-MM-DD` | 日期格式错 | 用 `2026-09-20` 这种格式，或干脆不传（默认今天） |
| 提交后线上没变化 | 索引/部署还在跑 | 等约 1 分钟；看 Actions 里 `Rebuild contributions index` 与 `Deploy GitHub Pages` |

### 1.7 图片规则

- 落盘位置固定：`docs/assets/uploads/<文件名>`，记录里写 `assets/uploads/<文件名>`
- 单张 ≤ 2MB（`githubSource` 默认上限）；网页上传会在浏览器先压到最长边 1280px / JPEG
- **一次上传的所有图片与 JSON 只产生 1 个 commit**（GitHub 数据源走 Git Data API；
  `upload.html` 就是这个路径），不会因为传了 5 张图刷 5 条历史
- 同一次上传里内容与图片若要绑定，请让 `payload.image` 与图片文件名一致（约定路径）

### 1.8 去重与覆盖规则

| 情况 | 行为 |
| --- | --- |
| 同饭堂 + 同楼层 + 同窗口 + 同一天 + **同名** | 只保留最后上传的一条（重拍同一道菜不会重复计入抽签权重） |
| 同上但**没有菜名** | 按图片去重：不同照片是不同菜，同一张照片重复上传会合并 |
| 不同窗口 / 不同日期 | 互不影响 |
| `id` 相同 | 覆盖同一条内容 |

## 2. 本地预览

因为用了 ES Module，必须用 HTTP 打开（不能双击 html）：

```bash
cd /path/to/food
python3 -m http.server 8080
# 抽签页    http://localhost:8080/docs/
# 内容管理  http://localhost:8080/docs/admin.html
```

静态数据来自 `docs/assets/data/menu.json`，由 `tools/build_menu_data.py` 从
`source_pic/` 的截图数据生成：

```bash
python3 tools/build_menu_data.py      # 生成 source_pic/* + docs/assets/data/*
python3 tools/validate_menu_data.py   # 数据完整性校验
```

## 3. 部署到 GitHub Pages

**当前部署状态**

| 项 | 值 |
| --- | --- |
| 站点 | **https://2ubbish.github.io/jiaran-what-to-eat/** |
| 仓库 | `2UBBISH/jiaran-what-to-eat`（public） |
| 数据源 | `static`（只读静态 JSON） |
| Pages Source | GitHub Actions（`.github/workflows/pages.yml`） |

日常更新只需 push 到 `main`：工作流会依次 **生成数据 → 校验数据 → 跑前端 core 测试 →
检查贡献索引 → 发布 `docs/`**，约 1 分钟生效。

**如果要在别处重新部署**

```bash
git init -b main && git add . && git commit -m "feat: 嘉然今天吃什么"
git remote add origin git@github.com:<用户名>/<仓库名>.git
git push -u origin main
```

然后到仓库 **Settings → Pages → Source 选 “GitHub Actions”**（首次需要手动选一次）。

> 仓库名只能用 ASCII 字母/数字/`.`/`-`/`_`：中文名会被 GitHub 规范化成一个 `-`，
> 所以仓库用 `jiaran-what-to-eat`，站点里显示的中文名由 `assets/js/brand.js` 控制。

> 因为用了 hash 路由（`#/draw`、`#/r?k=...`），刷新子页面不会 404，也不需要 404.html 兜底。

## 4. 在线上传内容

打开 `https://<用户名>.github.io/<仓库名>/admin.html`，在「数据源」里选一种：

| 模式 | 能做什么 | 适用场景 |
| --- | --- | --- |
| 静态数据（只读） | 只读 | 线上默认；预览、访客浏览 |
| **GitHub 仓库（可写）** | 新增/覆盖/删除内容 + 上传图片 | **线上真实上传（推荐）** |
| 本地演示（可写） | 上传只写进本机 localStorage | 演示、试填、不污染线上 |
| 自建 REST 后端 | 走你自己的 API | 以后接真后端 |

### 用 GitHub 模式上传（无需服务器）

1. 生成 fine-grained Token：GitHub → Settings → Developer settings →
   **Fine-grained tokens** → Generate new token
   - Repository access：只勾这一个仓库
   - Permissions → Repository permissions → **Contents: Read and write**
   - 有效期建议 90 天，用完随时吊销
2. 在管理台填 `owner / repo / branch / Token`，点「保存配置」→「测试连接」（应显示“可写入”）。
3. 表单里选类型（新增菜品 / 新增饭堂 / 补充说明）→ 填内容 → 选图片（可选，浏览器会自动压缩）
   → 看到「✓ 校验通过，可以提交」→ 点「提交到线上」。
4. 提交会写入：
   - 内容：`docs/assets/data/contributions/<id>.json`
   - 图片：`docs/assets/uploads/<时间戳>-<随机>-<名字>.jpg`
5. `.github/workflows/data-index.yml` 自动重建 `contributions/index.json`，
   `pages.yml` 重新部署，约 1 分钟后线上生效（页面刷新即见）。

> **Token 只存在你浏览器本地 localStorage**，不会上传到任何服务器；但它等同于写权限，
> 请不要在公共电脑上保存，也不要贴进聊天记录。

### 不想用 Token 的替代路径

- 管理台「导出全部内容」得到 JSON，手动放到 `docs/assets/data/contributions/` 再提交；
- 或者直接以 PR 形式改 `docs/assets/data/contributions/<id>.json`（格式见
  `contributions/_example.json`），CI 会校验。

### 内容格式与校验

所有上传都会经过 `core/menu.js` 的同一套校验（菜名长度、饭堂/菜系/标签是否在词表内、
辣度范围、评价标签合法性…），不通过就不允许提交/会被前端跳过，坏数据进不了仓库。

```jsonc
// docs/assets/data/contributions/20260920-ab12cd.json
{
  "id": "20260920-ab12cd",
  "kind": "dish",                       // dish | canteen | note
  "createdAt": "2026-09-20T12:00:00.000Z",
  "author": "匿名同学",
  "payload": {
    "canteenId": "lan_yuan",
    "floor": "3F",                      // 1F | 2F | 3F | null
    "stallName": "锅仔",
    "name": "羊肉锅（不辣）",
    "priceText": "¥18",
    "cuisines": ["hotpot"],             // 必须来自 taxonomy.cuisines
    "spicyLevel": 0,                    // 0-3
    "tags": ["必点"],                    // 必须来自 taxonomy.tags
    "reviewLabel": "好评",               // 必须来自 taxonomy.reviewLevels
    "reviewText": "18 元，巨好吃。",
    "image": "assets/uploads/xxx.jpg"
  }
}
```

## 5. 自选窗口与「天天变」的自选菜

食堂的自选窗口菜品每天都不一样，所以数据模型分两层：

| 概念 | 表示 | 行为 |
| --- | --- | --- |
| **窗口** | `kind: "stall"` 贡献内容，`windowType: 自选 \| 固定 \| 窗口` | 一等实体：有名字、楼层、照片、备注；也会从截图数据里的 `窗口：` 自动派生（当前 41 个） |
| **自选菜** | 普通 `kind: "dish"`，但带 `date: "YYYY-MM-DD"` | **只在该日期有效**：当天进抽签池、进「今日自选」；第二天自动退场 |
| 常驻菜 | `kind: "dish"`，不带 `date` | 一直有效（截图里整理出来的 72 道都是这类） |

配套的三个细节：

1. **按本地日期判定**：用 UTC 的话北京时间早上 8 点才翻篇，午饭时段会算错一天，
   所以 `core/date.js` 统一按本地日期算「今天」（抽签的每日签也用同一套）。
2. **自动去重**：同窗口 + 同一天 + 同名 只保留最后上传的一条。菜拍糊了重拍、一天传两次，
   都不会把抽签权重悄悄放大。
3. **可回看**：浏览页有「显示往日的自选菜」开关；抽签页的筛选里也有「包含往日的自选菜」。

### 在线上传自选菜（upload.html）

手机打开 `https://2ubbish.github.io/jiaran-what-to-eat/upload.html`：

1. 第一次先点「设置」把数据源切到 **GitHub 仓库**，填 owner / repo / branch / Token（只存本机）
2. 选饭堂 → 楼层 → 窗口（已有窗口直接点，新窗口输入名字，**提交时自动建档为「自选」窗口**）
3. 点「拍照 / 从相册选择」一次选多张 → 逐张填菜名（价格可选）
4. 选中共同属性（菜系 / 辣度 / 评价）→ 点「一次提交 N 道菜」

设计要点：

- **位置与菜系记住上次选择**，第二次打开直接传，不用重复填。
- **照片与内容只产生 1 个 commit**：走 `saveMany(records, { images })`，
  GitHub 数据源用 Git Data API（blobs → tree → commit → 更新分支）一次提交，
  不会因为传了 5 张图就刷 5 条提交历史。
- 浏览器先把照片压到最长边 1280px / JPEG 再上传（默认单张上限 2MB）。
- 按钮会直接告诉你还差什么（「还需填 2 个菜名」），未填的输入框标红。
- 日期默认今天，也可以补昨天的（做回溯记录）。

## 6. 架构：前后端分离怎么落的

```
视图层 ui/  ──只读 state、只调 core──▶  core/（纯函数：抽签、合成、校验、分享码）
   │                                        ▲
   │ 需要数据时只调一个接口                  │
   ▼                                        │
数据层 data/index.js ── createDataSource(config) ──▶ DataSource 契约
                                                       ├── staticSource  只读静态 JSON（Pages 默认）
                                                       ├── mockSource    localStorage（演示/离线）
                                                       ├── githubSource  GitHub Contents API（写）
                                                       └── httpSource    自建 REST（写）
```

契约（`docs/assets/js/data/contract.js`）：

| 方法 | 说明 |
| --- | --- |
| `loadMenu()` | 基础数据 + 线上贡献内容 → 合成 Menu |
| `listContributions()` | 列出全部已上传内容 |
| `saveContribution(record)` | 新增/覆盖一条内容 |
| `uploadImage(asset)` | 上传单张图片（前端已压缩为 base64/blob） |
| `saveMany(records, { images })` | 批量新增内容，可同时提交照片；GitHub 数据源一次提交只产生 1 个 commit |
| `uploadImages(assets)` | 批量上传图片 |
| `deleteContribution(id)` | 删除一条内容 |
| `health()` | 连通性与可写性自检 |

**换成自建后端**：实现这 6 个方法并在 `data/index.js` 注册，界面代码零改动
（端点约定写在 `httpSource.js` 顶部）。

## 7. 抽签规则（可复现、可验证）

- 签号即种子：`seed` 派生 `:canteen`、`:floor`、`:cuisine` 三条独立随机流，
  同 `seed` + 同数据 + 同筛选 ⇒ 完全一样的结果。
- 饭堂权重：`balanced`（默认，按该饭堂候选菜权重之和 ÷ (1+最近 5 次抽中次数)），
  可选 `dishWeight` / `uniform`。
- 楼层权重：该层候选菜的权重和（与“直接抽菜”数学等价，不会让菜少的楼层吃亏）。
- 菜系权重：该层菜品权重按菜系数均摊后求和（多菜系菜品不会重复计数）。
- 权重来源：帖子自带评价 —— 强烈推荐 5 / 好评·值得一试 3 / 两极 1.5 / 信息较少 1 /
  差评·已停业 0（且默认不进池）。
- 冷却：默认排除最近 5 次抽到过的菜；若整个池子都被冷却会自动放宽并提示。
- 分享：`#/r?k=v1.<seed36>.<菜系>.<辣度>.<预算>.<只看有楼层>.<餐段>`，
  对方打开后本地重算，必然同一签（不需要后端存结果）。
- 页面上的「概率透明」面板会把本次候选池与各饭堂概率摊开显示，方便核对公平性。
- 动效只是「揭晓方式」，不影响概率：结果先用种子算好，再播放动画；
  并且全程尊重系统的「减少动态效果」设置（开启后直接显示结果，粒子与签号跳动自动关闭）。

## 8. 测试

```bash
node tools/test_site_core.mjs          # 62 项：上传接口容错/裸格式文件/抽签可复现/公平性/自选菜日期语义
python3 tools/validate_menu_data.py    # 2527 项：数据引用与索引完整性
node tools/rebuild_contributions_index.mjs --check   # 索引是否最新

# DOM 集成测试（可选，需要 jsdom；.tmp-jsdom 已被 .gitignore 忽略）
mkdir -p .tmp-jsdom && cd .tmp-jsdom && npm init -y >/dev/null && npm install --cache ./.npm-cache jsdom
cd .. && node tools/test_site_dom.mjs
#   抽签页 13 + 管理台 10 + 抽签动效 6 + 自选菜快传 10 + 子路径部署 2 = 41 项
#   另有 2 项校验 README 里的接口示例真的能跑通（防止文档漂移）
#   其中「动效」用例会打开 prefers-reduced-motion=false，验证
#   逐行高亮 → 锁定 → 粒子 → 签号乱码落定 → 结果入场 的完整状态机

# 线上 E2E：把已部署的站点整包抓下来，用同一套用例再跑一遍
node tools/test_live_e2e.mjs
#   会先逐字节比对线上产物与本地（不一致会提示线上是旧版本），再跑全部 DOM 用例
#   另可指定地址：node tools/test_live_e2e.mjs https://user.github.io/repo/
```

DOM 测试会真的把页面跑起来：点抽签 → 检查「推送菜系」页 → 打开分享深链接复现同一签
→ 逛一逛 → 筛选抽屉 → 管理台校验 → 真实提交一条内容并删除。

## 9. 常见维护任务

| 想做的事 | 改哪里 |
| --- | --- |
| 加/改菜品（一次性批量） | `tools/build_menu_data.py` 里的 `DISHES`，然后重新生成 |
| 加/改菜品（线上即时） | 管理台上传，或直接加 `contributions/*.json` |
| 调整抽签权重 | `DISHES` 的 `review` 标签，或 `core/menu.js` 的 `taxonomy.reviewLevels` |
| 加菜系 / 标签 | `tools/build_menu_data.py` 的 `CUISINES` / `TAGS`（前端自动跟随 taxonomy） |
| 每天传自选菜 | 打开 `upload.html`（手机上也能用），位置记上次选择 |
| 给窗口配照片 | `upload.html` 的「窗口照片」，或 `admin.html` 的「窗口」页签 |
| 改自选菜的有效期规则 | `core/menu.js` 的 `isDishStale()` / `dedupeDaily()` |
| 改批量提交策略 | `data/githubSource.js` 的 `commitFiles()`（Git Data API） |
| 改上传接口字段 | `core/intake.js` 的 `INTAKE_SPEC` + `assets/data/intake-schema.json`（测试会强制两者一致）+ README 第 1 节 |
| 改视觉 | `assets/css/tokens.css`（颜色/圆角/阴影/动效曲线）优先，其次 components/views |
| 改抽签动效 | `assets/css/views.css` 里的 `reel*` / `burst` / `pushSweep` / `cardIn` 关键帧；粒子与签号乱码在 `ui/dom.js` 的 `burst()` / `scramble()` |
| 换后端 | 实现 `data/contract.js` 的 6 个方法，在 `data/index.js` 注册 |
| 改分享文案 | `core/share.js` 的 `buildShareText` |
