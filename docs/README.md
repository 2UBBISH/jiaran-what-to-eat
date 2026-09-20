# 嘉然今天吃什么 · 清华食堂抽签（GitHub Pages 前端）

抽 **饭堂 + 楼层**，再推送一个 **菜系** 给你，并列出这一层里该菜系的菜。
纯静态站点：没有服务器、没有数据库，抽签在本机浏览器里跑，结果可复现、可分享。
内容支持**在线新增**：管理台把新菜/新饭堂提交进仓库，Actions 自动重新部署。

```
docs/                              ← GitHub Pages 站点根目录
├── index.html                     抽签页（抽饭堂+楼层 → 推送菜系）
├── admin.html                     内容管理台（在线上传内容）
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
    ├── data/                      构建产物 + 线上贡献内容（见下）
    └── uploads/                   在线上传的图片
```

---

## 1. 本地预览

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

## 2. 部署到 GitHub Pages

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

## 3. 在线上传内容

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

## 4. 架构：前后端分离怎么落的

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
| `uploadImage(asset)` | 上传图片（前端已压缩为 base64/blob） |
| `deleteContribution(id)` | 删除一条内容 |
| `health()` | 连通性与可写性自检 |

**换成自建后端**：实现这 6 个方法并在 `data/index.js` 注册，界面代码零改动
（端点约定写在 `httpSource.js` 顶部）。

## 5. 抽签规则（可复现、可验证）

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

## 6. 测试

```bash
node tools/test_site_core.mjs          # 36 项：抽签可复现/公平性/筛选/分享码/贡献内容合并
python3 tools/validate_menu_data.py    # 2527 项：数据引用与索引完整性
node tools/rebuild_contributions_index.mjs --check   # 索引是否最新

# DOM 集成测试（可选，需要 jsdom；.tmp-jsdom 已被 .gitignore 忽略）
mkdir -p .tmp-jsdom && cd .tmp-jsdom && npm init -y >/dev/null && npm install --cache ./.npm-cache jsdom
cd .. && node tools/test_site_dom.mjs  # 22 项：真跑 index.html / admin.html + 子路径部署
```

DOM 测试会真的把页面跑起来：点抽签 → 检查「推送菜系」页 → 打开分享深链接复现同一签
→ 逛一逛 → 筛选抽屉 → 管理台校验 → 真实提交一条内容并删除。

## 7. 常见维护任务

| 想做的事 | 改哪里 |
| --- | --- |
| 加/改菜品（一次性批量） | `tools/build_menu_data.py` 里的 `DISHES`，然后重新生成 |
| 加/改菜品（线上即时） | 管理台上传，或直接加 `contributions/*.json` |
| 调整抽签权重 | `DISHES` 的 `review` 标签，或 `core/menu.js` 的 `taxonomy.reviewLevels` |
| 加菜系 / 标签 | `tools/build_menu_data.py` 的 `CUISINES` / `TAGS`（前端自动跟随 taxonomy） |
| 改视觉 | `assets/css/tokens.css`（颜色/圆角/阴影/动效）优先，其次 components/views |
| 换后端 | 实现 `data/contract.js` 的 6 个方法，在 `data/index.js` 注册 |
| 改分享文案 | `core/share.js` 的 `buildShareText` |
