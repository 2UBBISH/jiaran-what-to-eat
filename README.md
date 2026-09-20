# 嘉然今天吃什么 · 清华食堂

把小红书「食堂安利 · 清华食堂吃饭指南」的 19 张截图，整理成一份**结构化菜单数据**，
并用它做了两个客户端：

| 目录 | 是什么 | 怎么用 |
| --- | --- | --- |
| `source_pic/` | **数据源**：17 个饭堂 / 10 个楼层条目 / 72 道菜 / 24 个菜系，含价格、辣度、评价权重、来源截图 | 见 `source_pic/README.md` |
| `docs/` | **网页版**：抽「饭堂 + 楼层」→ 推送菜系；含自选菜快传页（`upload.html`）与内容管理台，已部署到 GitHub Pages | 见 `docs/README.md` |
| `tools/` | 生成、校验、测试脚本 | `python3 tools/build_menu_data.py` |
| `.github/workflows/` | Pages 部署 + 贡献索引重建 | push 即自动部署 |

## 上传接口（给 agent / 脚本）

对外接口只要求五项：**饭菜图片 + 饭堂 + 楼层 + 窗口 + 价格**，其余可选。
完整字段表、别名、容错规则、批量格式、错误码与可直接照抄的 `git` 步骤见
**`docs/README.md` 第 1 节**；机器可读版本是 `docs/assets/data/intake-schema.json`（v1）。

```json
{
  "image": "assets/uploads/20260920-abc.jpg",
  "canteen": "澜园",
  "floor": "一楼",
  "window": "自选窗口",
  "price": "12"
}
```

## 快速开始

```bash
python3 tools/build_menu_data.py       # 从截图数据生成 JSON / JS
python3 tools/validate_menu_data.py    # 数据完整性校验（2527 项断言）
node tools/test_site_core.mjs          # 前端核心逻辑测试（36 项）
python3 -m http.server 8080            # 本地预览：http://localhost:8080/docs/
```

## 数据流向

```
source_pic/*.jpg                     原始截图（19 张）
      │  人工录入 + 放大复核
      ▼
tools/build_menu_data.py             唯一数据源（curated 记录 + 校验）
      ├──▶ source_pic/menu_data.json / menu_data.js   → 微信小程序（require 即可）
      └──▶ docs/assets/data/menu.json                 → 网页版（fetch 即可）
                    ▲
                    │ 在线新增内容（管理台 / PR）
        docs/assets/data/contributions/*.json
```

一份数据、两个客户端：小程序用 `source_pic/menu_data.js`（CommonJS），
网页用 `docs/assets/data/menu.json`（fetch + 线上贡献合并）。

## 数据说明（要点）

- 校名是 **清青** 快餐 / 牛拉 / 咖啡 / 永和，截图里容易误读成“清清”，已按“清青”录入。
- 有**两套**帖子都标着「第 2/13 张」（荷园、紫荆园），数据里区分为 `A13` / `B13`。
- 缺失页：`A13` 缺第 1 张，`B13` 仅见第 2 张，`C9` 缺第 1-3 张 —— 这是**部分覆盖**。
- 价格为截图时点价格；`price.text` 保留徽章原文（如 `¥20+，因为是自选`），
  `price.min/max` 是解析结果，`approx/uncertain` 标记“左右 / 待确认”。
- 抽签权重直接来自帖子自带评价：强烈推荐 5、好评/值得一试 3、两极 1.5、
  信息较少 1、差评与已停业 0（默认不进池）。
- 跟帖提到 C 楼蜜雪冰城已撤出、独峰书院已停业，相关记录分别标记为
  `可能已撤出` 与 `status: discontinued`。
- 截图数据里只有固定菜品；**自选窗口与「天天变」的自选菜**在网页版里按
  `窗口（stall）` + `带日期的菜（date）` 两层建模，用 `upload.html` 在线上传。

## 文档索引

- 数据模型、字段、来源索引、小程序用法 → `source_pic/README.md`
- 网页架构、部署、在线上传、抽签规则、维护手册 → `docs/README.md`
- 数据 JSON Schema → `source_pic/schema.json`
