# 清华食堂吃饭指南 · 结构化数据（source_pic）

把 `source_pic/` 里的 19 张小红书截图（“食堂安利 · 清华食堂吃饭指南”）整理成
**按饭堂 + 楼层 + 菜系**组织的数据，用于搭建可移植到微信小程序的
「今天吃什么」抽签 + 菜系推荐。

## 文件说明

| 文件 | 用途 |
| --- | --- |
| `menu_data.json` | 主数据文件：meta + 菜系/标签/评价法 taxonomy + 饭堂 + 楼层 + 菜品 + 索引 + 抽签配置 |
| `dishes.json` | 扁平菜品数组（等价 `menu_data.dishes`），适合建表 / 存缓存 |
| `canteens.json` | 饭堂与楼层树（含每层菜品数、窗口名），适合做选择器 |
| `cuisines.json` | 菜系分类及每个菜系下的菜品 id，适合做菜系推荐页 |
| `menu_data.js` | 同一份数据的 CommonJS 模块，小程序里直接 `require('../source_pic/menu_data.js')` |
| `draw.js` | 零依赖的抽签/推荐纯函数：抽饭堂、抽楼层、抽菜品、菜系推荐打分 |
| `schema.json` | `menu_data.json` 的 JSON Schema（draft 2020-12），可做构建期校验 |
| `README.md` | 本文件，含数据模型、统计、来源索引与用法 |

数据由 `tools/build_menu_data.py` 生成（脚本内含全部人工录入的记录，是唯一数据源）：

```bash
python3 tools/build_menu_data.py     # 重新生成上面所有文件
```

## 谁在用这份数据

一份数据、两个客户端，互不耦合：

| 消费方 | 入口文件 | 读取方式 |
| --- | --- | --- |
| 网页版（GitHub Pages） | `docs/assets/data/menu.json` | `fetch` + 合并线上的 `contributions/*.json`，见 `docs/README.md` |
| 微信小程序 | `menu_data.js` | `require()`（CommonJS），配合 `draw.js` 使用 |

网页版是 `docs/` 目录，支持在线上传内容；生成命令同下，会同时写出两份。

## 数据模型

```
menu_data.json
├── meta            标题、版本、来源（小红书账号/图片清单）、缺页说明、统计
├── taxonomy        cuisines(菜系) / tags(标签) / reviewLevels(评价等级+抽签权重)
│                   mealSlots(餐段) / priceTiers(价格档) / spicyScale(辣度) / floors(楼层)
├── canteens[]      饭堂 -> floors[] (floor/label/stallNames/dishCount/drawWeight)
│                   并带 drawableDishCount / drawWeight，可直接做饭堂级抽签
├── cuisines[]      菜系 -> dishIds[]、dishCount、涉及饭堂
├── dishes[]        菜品记录（见下）
├── indexes         倒排索引：byCanteen / byFloor / byCuisine / byTag / byReviewLevel
│                   / byPriceTier / byMealSlot / bySpicyLevel
└── draw            抽签与推荐的模式、默认过滤条件、权重、参数说明
```

单条菜品记录的关键字段：

| 字段 | 含义 |
| --- | --- |
| `id` | `饭堂id-序号`，如 `lan_yuan-09`，稳定主键 |
| `name` / `variants` | 卡片标题原文 / 拆分出的可单独点选的单品 |
| `canteenId` / `floor` / `floorId` | 饭堂、楼层（截图未标注则为 `null`） |
| `floorSource` | `section` = 来自橙色分区标题；`window` = 分区没标楼层、由窗口原文推断（仅澜园椒麻鸡） |
| `stallName` | 截图“窗口：”后的原文（保留了口语化描述，如“最最最左边的炸鸡窗口”） |
| `cuisines` / `primaryCuisine` | 菜系标签（可多个），第一个为主菜系 |
| `tags` | 受控标签：性价比高 / 必点 / 校内公认好吃 / 清淡 / 偏咸 / 已停业 … |
| `spicyLevel` | 0 不辣 / 1 微辣 / 2 中辣 / 3 重辣 |
| `mealSlots` | breakfast / lunch / dinner / night / drink / dessert |
| `price` | `{text, min, max, currency, approx, uncertain, openEnded, note}`，`text` 是截图徽章原文 |
| `priceTier` | cheap(≤10) / normal(10-20) / premium(20-50) / restaurant(>50) |
| `reviewLevel` | 帖子自带评价：好评 / 强烈推荐 / 值得一试 / 两极 / 信息较少 / 差评 / 已停业 |
| `drawWeight` | 抽签权重，见下 |
| `excludedByDefault` | 差评、已停业默认为 true，不进抽签池 |
| `source` | 来源图片文件名 + 所属帖子 + 页码，便于回溯核对 |

抽签权重（来自帖子自带评价，直接可用于加权随机）：

| 评价 | reviewLevel | 权重 | 默认进池 |
| --- | --- | --- | --- |
| 强烈推荐 | `strongly_recommended` | 5 | ✅ |
| 好评 | `positive` | 3 | ✅ |
| 值得一试 | `worth_trying` | 3 | ✅ |
| 两极 | `mixed` | 1.5 | ✅ |
| 信息较少 | `low_info` | 1 | ✅ |
| 差评 | `negative` | 0 | ❌ |
| 已停业 | `discontinued` | 0 | ❌ |

## 覆盖范围

| 指标 | 数量 |
| --- | --- |
| 饭堂 | 17 |
| 标注了楼层的饭堂 | 7 |
| 楼层条目 | 10 |
| 菜品记录 | 72 |
| 可进抽签池（排除差评/已停业） | 70 |
| 窗口级整体推荐（不参与抽签） | 2 |
| 菜系分类 | 24 / 24 |
| 有价格的菜品 | 62 |
| 价格未记录的菜品 | 10 |
| 来源截图 | 19 |

### 饭堂 × 楼层

| 饭堂 | 楼层 | 菜品数 | 窗口 |
| --- | --- | --- | --- |
| 荷园 | 2F | 5 | 8元自选、面、面食窗口（二楼） |
| 荷园 | 未标注 | 1 | — |
| 紫荆园 | 1F | 1 | — |
| 紫荆园 | 未标注 | 5 | — |
| 观畴园 | 2F | 3 | 主食区、某个拐角、自选 |
| 观畴园 | 3F | 1 | — |
| 观畴园 | 未标注 | 8 | — |
| 丁香园 | 未标注 | 4 | — |
| 芝兰园 | 1F | 1 | 一楼左数第二个口 |
| 熙春园 | 未标注 | 3 | — |
| 独峰书院 | 未标注 | 1 | — |
| 清青咖啡 | 未标注 | 4 | — |
| 清青牛拉 | 未标注 | 1 | — |
| 清青快餐 | 未标注 | 1 | — |
| C楼 | 未标注 | 2 | — |
| 711 | 未标注 | 1 | — |
| 清芬园 | 2F | 2 | 从右往左第二个窗口、瓦罐汤 |
| 听涛园 | 未标注 | 6 | — |
| 玉树园 | 2F | 7 | — |
| 玉树园 | 未标注 | 1 | — |
| 寓园 | 未标注 | 5 | — |
| 澜园 | 1F | 1 | 一楼米饭自选 |
| 澜园 | 2F | 1 | 二楼面类 |
| 澜园 | 3F | 2 | 广东窗口、锅仔 |
| 澜园 | 未标注 | 5 | — |

### 菜系分布

| 菜系 | 分组 | 菜品数 | 示例 |
| --- | --- | --- | --- |
| 🍲 家常菜（红烧·糖醋·炖汤） | 中餐 | 12 | 糖醋鱼脊、蒜香鸡块 / 黄金龙骨、鸡汁豆腐 |
| 🍜 面食·粉面 | 主食 | 11 | 牛肉面 / 鸡丝面 / 自选、拌面 / 鸡丝面、茶菇肉丝面 |
| 🥗 清淡·轻食·沙拉 | 健康 | 11 | 茶菇肉丝面、奶油蘑菇汤、西班牙土豆汤 |
| 🥠 小吃·点心 | 小吃 | 11 | 肉夹馍、香菇肉包 / 冬菜肉包、肉松蛋黄青团 |
| 🍚 米饭·盖饭·拌饭 | 主食 | 9 | 咖喱炒饭、烧鸭饭、蜜汁肥牛拌饭 / 黑椒鸡肉 |
| 🍕 西式简餐（披萨·意面·汤） | 西式 | 9 | 薯格/薯角、烤翅、奶油蘑菇汤 |
| 🍢 铁板·烧烤·炸物 | 小吃 | 9 | 薯格/薯角、烤翅、无骨鸡腿 |
| 🌶️ 川菜（麻辣） | 中餐 | 8 | 藤椒焖面、樟茶鸭、锅贴、龙抄手 |
| 🍜 西北面食（陕甘） | 主食 | 6 | 肉夹馍、炒面片、三合一 |
| 🥘 香锅·锅仔·冒菜 | 中餐 | 6 | 麻辣香锅、麻辣香锅（中辣）、精品冒菜 |
| 🥟 早餐·包子·糕点 | 小吃 | 5 | 香菇肉包 / 冬菜肉包、粘豆包、肠粉 |
| 🍤 江浙菜（杭帮·淮扬） | 中餐 | 4 | 肉松蛋黄青团、肉松青团、龙井虾仁 |
| 🇰🇷 韩式 | 异国 | 4 | 蜜汁肥牛拌饭 / 黑椒鸡肉、辣白菜五花肉石锅拌饭、辣白菜肥牛饭 |
| 🍦 甜品·冰淇淋 | 甜品饮品 | 4 | 华夫饼、芭菲、香芋脆皮小圣代（奶布丁版） |
| 🦆 粤菜（广式） | 中餐 | 3 | 烧鸭饭、肠粉 |
| 🥟 东北菜（麻辣拌·烤冷面） | 中餐 | 3 | 粘豆包、煎饼/烤冷面、麻辣拌（自选，建议少盐） |
| 🐮 清真·牛肉面 | 主食 | 3 | 牛肉面 / 鸡丝面 / 自选、炒面片、羊肉烩面 |
| 🍛 日式（照烧·咖喱） | 异国 | 3 | 咖喱炒饭、照烧鸡饭、石锅照烧五花肉 |
| 🦆 京菜（烤鸭·葱爆） | 中餐 | 2 | 北京烤鸭、葱爆羊肉 |
| 🥤 饮品·豆浆·咖啡 | 甜品饮品 | 2 | 红枣豆浆、紫荆花开（饮料） |
| 🍗 台式 | 中餐 | 1 | 三杯鸡 |
| 🥜 闽台菜（沙茶） | 中餐 | 1 | 沙茶面 |
| 🍋 泰式·东南亚 | 异国 | 1 | 泰式香茅烤鸡沙拉碗 |
| 🍔 汉堡·西式快餐 | 西式 | 1 | 汉堡 |

## 来源索引（截图 -> 帖子 -> 页码 -> 饭堂）

| 截图文件 | 帖子 | 页码 | 饭堂 | 菜品数 |
| --- | --- | --- | --- | --- |
| `微信图片_20260920160541_14_10.jpg` | A13 | 2/13 | 荷园 | 6 |
| `微信图片_20260920160540_13_10.jpg` | A13 | 3/13 | 观畴园 | 7 |
| `微信图片_20260920160539_12_10.jpg` | A13 | 4/13 | 观畴园 | 5 |
| `微信图片_20260920160537_11_10.jpg` | A13 | 5/13 | 丁香园 | 4 |
| `微信图片_20260920160536_10_10.jpg` | A13 | 6/13 | 芝兰园 | 1 |
| `微信图片_20260920160535_9_10.jpg` | A13 | 7/13 | 熙春园 | 3 |
| `微信图片_20260920160534_8_10.jpg` | A13 | 8/13 | 独峰书院 | 1 |
| `微信图片_20260920160533_7_10.jpg` | A13 | 9/13 | 清青咖啡 | 4 |
| `微信图片_20260920160532_6_10.jpg` | A13 | 10/13 | 清青牛拉 | 1 |
| `微信图片_20260920160531_5_10.jpg` | A13 | 11/13 | 清青快餐 | 1 |
| `微信图片_20260920160530_4_10.jpg` | A13 | 12/13 | C楼 | 2 |
| `微信图片_20260920160529_3_10.jpg` | A13 | 13/13 | 711 | 1 |
| `微信图片_20260920160600_34_10.jpg` | B13 | 2/13 | 紫荆园 | 6 |
| `微信图片_20260920160546_20_10.jpg` | C9 | 4/9 | 清芬园 | 2 |
| `微信图片_20260920160546_19_10.jpg` | C9 | 5/9 | 听涛园 | 6 |
| `微信图片_20260920160545_18_10.jpg` | C9 | 6/9 | 玉树园 | 8 |
| `微信图片_20260920160544_17_10.jpg` | C9 | 7/9 | 寓园 | 5 |
| `微信图片_20260920160543_16_10.jpg` | C9 | 8/9 | 澜园 | 5 |
| `微信图片_20260920160542_15_10.jpg` | C9 | 9/9 | 澜园 | 4 |

**缺页说明**：A13（共 13 张）缺第 1 张；B13（共 13 张）仅见第 2 张；C9（共 9 张）缺第 1、2、3 张。

## 小程序里怎么用

### 1. 引入数据

```js
// 小程序原生：直接 require 生成的 CommonJS 模块
const menu = require('../source_pic/menu_data.js')

// 或者用 JSON（需要构建期拷贝到小程序包内，并注意主包体积）
// const menu = require('../source_pic/menu_data.json')
```

### 2. 按饭堂 + 楼层筛菜

```js
const list = menu.dishes.filter(d =>
  d.canteenId === 'lan_yuan' && d.floor === '3F' && !d.excludedByDefault
)
```

### 3. 今天吃什么：加权抽签

```js
const pool = menu.dishes.filter(d => !d.excludedByDefault &&
  d.type !== 'stall_recommendation' &&
  (spicyMax == null || d.spicyLevel <= spicyMax))

const total = pool.reduce((s, d) => s + d.drawWeight, 0)
let r = Math.random() * total
const picked = pool.find(d => (r -= d.drawWeight) <= 0)
```

需要“同一结果可复现/可分享”时，用 `draw.js` 里的种子随机数版本。

### 4. 菜系推荐

```js
// 索引直接给出某菜系的全部菜品 id
const sichuanIds = menu.indexes.byCuisine.sichuan
// 或先按菜系筛，再按 drawWeight + 价格排序
```

`draw.js`（本目录）提供了零依赖的纯函数实现：

| 函数 | 作用 |
| --- | --- |
| `createRng(seed)` / `hashSeed(seed)` | 可复现的伪随机数（mulberry32），同一 seed 结果相同 |
| `filterDishes(menu, opts)` | 按饭堂 / 楼层 / 菜系 / 辣度 / 预算 / 餐段 / 素食 / 关键词筛选 |
| `drawCanteen(menu, opts)` | 抽饭堂，权重可用 `dishWeight`（默认）/ `dishCount` / `uniform` |
| `drawDish(menu, opts)` | 按 `drawWeight` 加权抽一道菜 |
| `drawMeal(menu, opts)` | 一条龙：抽饭堂 → 抽楼层 → 抽菜，返回可分享的 seed |
| `recommend(menu, opts)` | 菜系推荐打分排序，返回 `{dish, score, reasons}` |

```js
const menu = require('../source_pic/menu_data.js')
const draw = require('../source_pic/draw.js')

// 同一个 seed 永远给出同一个结果，可以把 seed 和结果一起分享给同学
draw.drawMeal(menu, { seed: 20260920, maxSpicyLevel: 2 })
// { canteen, floor, dish, seed, explain }

draw.recommend(menu, { cuisines: ['sichuan', 'hotpot'], maxPrice: 25, requirePrice: true, limit: 5 })
```

不依赖任何小程序 API、不依赖 `wx`，可直接复制进小程序包。

### 5. 移植性说明

- `menu_data.js` / `draw.js` 都是 CommonJS（`module.exports`），小程序、Node、webpack 均可直接用；
  `draw.js` 同时把 API 挂到 `globalThis.TodayEatDraw`，方便在浏览器里调试。
- 数据体积：`menu_data.json` 约 150 KB、`menu_data.js` 约 150 KB。放进小程序主包没问题；
  若主包紧张，可只打包 `dishes.json`（约 78 KB）+ 少量 taxonomy，或按饭堂拆包。
- `menu_data.js` 里是纯数据（没有函数、没有 `wx.*`、没有时间戳以外的东西），
  可以直接用工具转成 `wxs`/`json` 或写入云开发数据库集合。
- 抽签需要“公平且可复现”时，把 `seed` 存到本地缓存/云端即可复现同一结果。

## 数据可信度与注意事项

- 数据来自小红书个人分享，价格为截图时点价格，可能已变动。
- 两张截图都标注“第 2/13 张”（荷园、紫荆园），说明存在两套 13 张系列的帖子；本数据集把它们区分为 A13 / B13。
- 缺失页：A13 缺第 1 张，B13 只有第 2 张，C9 缺第 1-3 张。
- 校名是“清青快餐/清青牛拉/清青咖啡/清青永和”，截图中易误读为“清清”，本数据集已按“清青”录入。
- 跟帖提到 C 楼蜜雪冰城已撤出、独峰书院已停业，相关记录标记为可能过时/已停业。
- “（窗口整体推荐）”类记录 type = stall_recommendation，默认不参与抽签，只作窗口级推荐展示。

## 重新生成 / 校验

```bash
python3 tools/build_menu_data.py          # 生成全部数据文件
python3 tools/validate_menu_data.py       # 校验已生成的数据（schema 关键约束 + 引用完整性）
```
