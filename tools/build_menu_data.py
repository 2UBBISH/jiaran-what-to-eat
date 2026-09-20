#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the structured canteen/menu dataset from the source screenshots.

This script is the single source of truth for the curated records that were
read out of ``source_pic/*.jpg`` (a Xiaohongshu "清华食堂吃饭指南" post series).

Run:
    python3 tools/build_menu_data.py

Outputs (all written into ``source_pic/``):
    menu_data.json   canonical dataset (meta + taxonomy + canteens + dishes + indexes + draw config)
    canteens.json    canteen / floor tree with dish counts
    dishes.json      flat dish list (join key: dish.id)
    cuisines.json    cuisine taxonomy + dish ids per cuisine
    menu_data.js     CommonJS module for WeChat mini-program (require)
    schema.json      JSON Schema (draft 2020-12) for menu_data.json
    README.md        human documentation, coverage stats, source index
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = ROOT / "source_pic"
GENERATED_AT = "2026-09-20"
SCHEMA_VERSION = "1.0.0"

# --------------------------------------------------------------------------
# Source posts / pages
# --------------------------------------------------------------------------
# Every screenshot carries a "第 X/Y 张" page label. Two different posts both
# number their pages out of 13, so the series ids below disambiguate them.
POSTS = [
    {
        "id": "A13",
        "title": "食堂安利 · 清华食堂吃饭指南（13 张系列）",
        "totalPages": 13,
        "pagesPresent": [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
        "pagesMissing": [1],
    },
    {
        "id": "B13",
        "title": "食堂安利 · 清华食堂吃饭指南（另一套 13 张系列，仅见第 2 张）",
        "totalPages": 13,
        "pagesPresent": [2],
        "pagesMissing": [1] + list(range(3, 14)),
    },
    {
        "id": "C9",
        "title": "食堂安利 · 清华食堂吃饭指南（9 张系列）",
        "totalPages": 9,
        "pagesPresent": [4, 5, 6, 7, 8, 9],
        "pagesMissing": [1, 2, 3],
    },
]

# image file -> (post id, page label, canteen id)
SOURCE_INDEX = {
    "微信图片_20260920160541_14_10.jpg": ("A13", "2/13", "he_yuan"),
    "微信图片_20260920160540_13_10.jpg": ("A13", "3/13", "guan_chou_yuan"),
    "微信图片_20260920160539_12_10.jpg": ("A13", "4/13", "guan_chou_yuan"),
    "微信图片_20260920160537_11_10.jpg": ("A13", "5/13", "ding_xiang_yuan"),
    "微信图片_20260920160536_10_10.jpg": ("A13", "6/13", "zhi_lan_yuan"),
    "微信图片_20260920160535_9_10.jpg": ("A13", "7/13", "xi_chun_yuan"),
    "微信图片_20260920160534_8_10.jpg": ("A13", "8/13", "du_feng_shu_yuan"),
    "微信图片_20260920160533_7_10.jpg": ("A13", "9/13", "qing_qing_coffee"),
    "微信图片_20260920160532_6_10.jpg": ("A13", "10/13", "qing_qing_niu_la"),
    "微信图片_20260920160531_5_10.jpg": ("A13", "11/13", "qing_qing_kuai_can"),
    "微信图片_20260920160530_4_10.jpg": ("A13", "12/13", "c_lou"),
    "微信图片_20260920160529_3_10.jpg": ("A13", "13/13", "convenience_711"),
    "微信图片_20260920160600_34_10.jpg": ("B13", "2/13", "zi_jing_yuan"),
    "微信图片_20260920160546_20_10.jpg": ("C9", "4/9", "qing_fen_yuan"),
    "微信图片_20260920160546_19_10.jpg": ("C9", "5/9", "ting_tao_yuan"),
    "微信图片_20260920160545_18_10.jpg": ("C9", "6/9", "yu_shu_yuan"),
    "微信图片_20260920160544_17_10.jpg": ("C9", "7/9", "yu_yuan"),
    "微信图片_20260920160543_16_10.jpg": ("C9", "8/9", "lan_yuan"),
    "微信图片_20260920160542_15_10.jpg": ("C9", "9/9", "lan_yuan"),
}

# --------------------------------------------------------------------------
# Taxonomy
# --------------------------------------------------------------------------
CUISINES = [
    ("sichuan", "川菜（麻辣）", "中餐", "🌶️", "麻辣、椒麻、水煮、藤椒、香辣"),
    ("cantonese", "粤菜（广式）", "中餐", "🦆", "烧腊、白切鸡、叉烧、肠粉、煲仔饭"),
    ("jiangzhe", "江浙菜（杭帮·淮扬）", "中餐", "🍤", "龙井虾仁、响油鳝糊、蟹黄豆腐、青团"),
    ("beijing", "京菜（烤鸭·葱爆）", "中餐", "🦆", "北京烤鸭、葱爆羊肉"),
    ("northeast", "东北菜（麻辣拌·烤冷面）", "中餐", "🥟", "麻辣拌、烤冷面、粘豆包、饺子"),
    ("homestyle", "家常菜（红烧·糖醋·炖汤）", "中餐", "🍲", "红烧、糖醋、瓦罐汤、家常小炒"),
    ("northwest", "西北面食（陕甘）", "主食", "🍜", "肉夹馍、油泼面、烩面、炒面片、拉条"),
    ("halal", "清真·牛肉面", "主食", "🐮", "牛肉拉面、炒面片、烩面"),
    ("noodles", "面食·粉面", "主食", "🍜", "拉面、拌面、米线、米粉、面片、汤面"),
    ("rice", "米饭·盖饭·拌饭", "主食", "🍚", "炒饭、盖饭、拌饭、石锅饭"),
    ("hotpot", "香锅·锅仔·冒菜", "中餐", "🥘", "麻辣香锅、锅仔、冒菜、麻辣烫"),
    ("korean", "韩式", "异国", "🇰🇷", "石锅拌饭、辣白菜、芝士铁板鸡"),
    ("japanese", "日式（照烧·咖喱）", "异国", "🍛", "照烧、咖喱、日式简餐"),
    ("taiwanese", "台式", "中餐", "🍗", "三杯鸡、台式小吃"),
    ("minnan", "闽台菜（沙茶）", "中餐", "🥜", "沙茶面、福建风味"),
    ("thai", "泰式·东南亚", "异国", "🍋", "香茅、冬阴功、泰式沙拉"),
    ("western", "西式简餐（披萨·意面·汤）", "西式", "🍕", "披萨、意面、奶油汤、西式小食"),
    ("burger", "汉堡·西式快餐", "西式", "🍔", "汉堡、薯条、炸物套餐"),
    ("grill", "铁板·烧烤·炸物", "小吃", "🍢", "铁板饭、炸鸡、烤翅、烧烤"),
    ("light", "清淡·轻食·沙拉", "健康", "🥗", "清淡、轻食、沙拉、清汤"),
    ("breakfast", "早餐·包子·糕点", "小吃", "🥟", "包子、豆浆、煎饼、肠粉"),
    ("snacks", "小吃·点心", "小吃", "🥠", "肉夹馍、锅贴、抄手、青团、饺子"),
    ("dessert", "甜品·冰淇淋", "甜品饮品", "🍦", "冰淇淋、芭菲、圣代、青团甜点"),
    ("drinks", "饮品·豆浆·咖啡", "甜品饮品", "🥤", "豆浆、现调饮品、咖啡、果汁"),
]

TAGS = {
    "校内公认好吃": ("好评", "帖子里明确说“校内最好吃/公认最好”"),
    "必点": ("好评", "被称作某食堂必点"),
    "性价比高": ("好评", "价格与分量/口味比值被点名"),
    "量大": ("好评", "分量被点名足"),
    "清淡": ("好评", "口味清淡不重口"),
    "汤品": ("中性", "汤类"),
    "现做": ("好评", "现点现做"),
    "现磨": ("好评", "现磨饮品"),
    "可点半份": ("好评", "可以点半份"),
    "自选": ("中性", "自选称重/自选窗口"),
    "轻食": ("好评", "轻食沙拉类"),
    "甜口": ("中性", "偏甜口味"),
    "香口": ("好评", "重香重味"),
    "早餐": ("中性", "适合早餐时段"),
    "清华特色": ("好评", "清华特色单品"),
    "适合请客": ("好评", "适合请客/被请"),
    "教师餐厅": ("中性", "属于教师餐厅，价格略高"),
    "网红": ("中性", "帖子中人气很高的单品"),
    "重口": ("中性", "辣或口味重"),
    "偏油": ("提醒", "容易腻或偏油"),
    "偏咸": ("提醒", "被提到偏咸"),
    "偏贵": ("提醒", "价格被吐槽偏贵"),
    "分量偏少": ("提醒", "分量偏少"),
    "出品不稳定": ("提醒", "出品不稳定"),
    "不推荐": ("提醒", "帖子里明确差评"),
    "已停业": ("提醒", "已停业或撤出"),
    "可能已撤出": ("提醒", "跟帖称该点位已撤出，信息可能过时"),
}

REVIEW_LEVELS = [
    ("strongly_recommended", "强烈推荐", "positive", 5.0, False, "帖子用“强烈推荐”标注"),
    ("positive", "好评", "positive", 3.0, False, "帖子用“好评”标注"),
    ("worth_trying", "值得一试", "positive", 3.0, False, "帖子用“值得一试”标注"),
    ("mixed", "两极", "mixed", 1.5, False, "评价两极，有人喜欢有人不喜欢"),
    ("low_info", "信息较少", "unknown", 1.0, False, "只有菜名，缺少评价"),
    ("negative", "差评", "negative", 0.0, True, "帖子明确差评，默认不进抽签池"),
    ("discontinued", "已停业", "negative", 0.0, True, "已停业，默认不进抽签池"),
]

MEAL_SLOTS = {
    "breakfast": "早餐",
    "lunch": "午餐",
    "dinner": "晚餐",
    "night": "夜宵",
    "drink": "饮品",
    "dessert": "甜品",
}

PRICE_TIERS = [
    ("cheap", "≤10 元", 0, 10),
    ("normal", "10-20 元", 10, 20),
    ("premium", "20-50 元", 20, 50),
    ("restaurant", ">50 元（餐厅档）", 50, None),
]

# --------------------------------------------------------------------------
# Canteens
# --------------------------------------------------------------------------
CANTEENS = [
    {
        "id": "he_yuan",
        "name": "荷园",
        "category": "食堂",
        "tags": ["教师餐厅"],
        "note": "二层为教师餐厅，价格略高，有鲜榨果汁。",
    },
    {
        "id": "zi_jing_yuan",
        "name": "紫荆园",
        "category": "食堂",
        "tags": ["清青披萨", "烧腊饭"],
        "note": "页面上出现“紫荆园 · 1F”分区与清青披萨窗口。",
    },
    {
        "id": "guan_chou_yuan",
        "name": "观畴园",
        "category": "食堂",
        "tags": ["炸鸡窗口", "青团", "北京烤鸭"],
        "note": "分 1F（未标注）/2F（自选、主食区）/3F（北京烤鸭）多个楼层。",
    },
    {
        "id": "ding_xiang_yuan",
        "name": "丁香园",
        "category": "食堂",
        "tags": ["广东窗口", "名厨窗口", "烤肉拌饭"],
        "note": "广东窗口的肠粉、凤爪、排骨煲仔饭被点名推荐。",
    },
    {
        "id": "zhi_lan_yuan",
        "name": "芝兰园",
        "category": "食堂",
        "tags": ["1F"],
        "note": "记录来自“芝兰园 1F”。",
    },
    {
        "id": "xi_chun_yuan",
        "name": "熙春园",
        "category": "餐厅",
        "tags": ["杭帮菜", "淮扬菜"],
        "note": "杭帮/淮扬口味，价格偏高，属餐厅档。",
    },
    {
        "id": "du_feng_shu_yuan",
        "name": "独峰书院",
        "category": "餐厅",
        "tags": ["已停业"],
        "note": "跟帖表示独峰书院已经没了，仅保留记录。",
        "status": "discontinued",
    },
    {
        "id": "qing_qing_coffee",
        "name": "清青咖啡",
        "category": "咖啡简餐",
        "tags": ["西式简餐", "汉堡", "沙拉"],
        "note": "校名写作“清青”，注意不要误写成“清清”。",
    },
    {
        "id": "qing_qing_niu_la",
        "name": "清青牛拉",
        "category": "快餐",
        "tags": ["牛肉拉面"],
        "note": "校名写作“清青”。",
    },
    {
        "id": "qing_qing_kuai_can",
        "name": "清青快餐",
        "category": "快餐",
        "tags": ["甜点"],
        "note": "校名写作“清青”。",
    },
    {
        "id": "c_lou",
        "name": "C楼",
        "category": "小食·饮品",
        "tags": ["小食屋", "蜜雪冰城"],
        "note": "跟帖提到 C 楼的蜜雪冰城已撤出，相关点位信息可能过时。",
    },
    {
        "id": "convenience_711",
        "name": "711",
        "category": "便利店",
        "tags": ["便利店", "冰淇淋"],
        "note": "位于澜园出口顺路位置。",
    },
    {
        "id": "qing_fen_yuan",
        "name": "清芬园",
        "category": "食堂",
        "tags": ["2F", "瓦罐汤"],
        "note": "记录来自“清芬园 2F”。",
    },
    {
        "id": "ting_tao_yuan",
        "name": "听涛园",
        "category": "食堂",
        "tags": ["川味小吃", "桂林米粉", "川香小吃"],
        "note": "含川味小吃、桂林米粉/风味、现磨豆浆、川香小吃等窗口。",
    },
    {
        "id": "yu_shu_yuan",
        "name": "玉树园",
        "category": "食堂",
        "tags": ["2F", "铁板", "石锅", "韩式"],
        "note": "二层以铁板/石锅饭为特色。",
    },
    {
        "id": "yu_yuan",
        "name": "寓园",
        "category": "食堂",
        "tags": ["陕西风味", "香锅", "铁板", "瓦罐汤"],
        "note": "铁板被称“寓园最能打的窗口”，香锅被称校内最好吃。",
    },
    {
        "id": "lan_yuan",
        "name": "澜园",
        "category": "食堂",
        "tags": ["麻辣拌第一", "广东窗口", "锅仔", "麻辣烫"],
        "note": "分 1F/2F/3F；麻辣拌被称校内各食堂第一，3F 广东窗口可闭眼点。",
    },
]

# --------------------------------------------------------------------------
# Dishes
# --------------------------------------------------------------------------
# price      : the badge text exactly as printed in the screenshot
# price_hint : optional override for amounts the parser cannot infer (中文数字等)
# review     : the label prefix used by the post (好评 / 强烈推荐 / 两极 / ...)
# review_text: the text after that label, verbatim
DISHES = [
    # ---------------- 荷园 (A13 2/13) ----------------
    dict(canteen="he_yuan", floor=None, stall="卖面的档口？（忘记名字了）",
         title="肉夹馍", price="大概6r?", review="好评",
         review_text="约 6 元，油旋馍酥脆，获陕西同学认可。",
         cuisines=["northwest", "snacks"], tags=["性价比高"], spicy=0,
         slots=["breakfast", "lunch", "dinner"], vegetarian=False),
    dict(canteen="he_yuan", floor="2F", stall=None,
         title="牛肉面 / 鸡丝面 / 自选", price="¥20-30", review="好评",
         review_text="20-30 元，牛肉面、鸡丝面和自选都出彩，有鲜榨果汁；属教师餐厅，略贵。",
         cuisines=["noodles", "halal"], tags=["教师餐厅"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False,
         variants=["牛肉面", "鸡丝面", "自选"]),
    dict(canteen="he_yuan", floor="2F", stall=None,
         title="咖喱炒饭", price=None, review="好评",
         review_text="不油，好吃。",
         cuisines=["rice", "japanese"], tags=["清淡"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=None),
    dict(canteen="he_yuan", floor="2F", stall="面",
         title="拌面 / 鸡丝面", price="¥10", review="好评",
         review_text="10 元，被认为是校内最好吃的面之一。",
         cuisines=["noodles"], tags=["校内公认好吃", "性价比高"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False,
         variants=["拌面", "鸡丝面"]),
    dict(canteen="he_yuan", floor="2F", stall="8元自选",
         title="糖醋鱼脊", price="¥8", review="好评",
         review_text="8 元自选，糖醋类里最好吃。",
         cuisines=["homestyle"], tags=["性价比高", "甜口"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="he_yuan", floor="2F", stall="面食窗口（二楼）",
         title="茶菇肉丝面", price="十来块，忘了", review="好评",
         review_text="十来块，清淡、菌香浓，汤好喝。",
         price_hint=dict(min=10, max=10, approx=True, uncertain=True, note="十来块"),
         cuisines=["noodles", "light"], tags=["清淡", "汤品"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),

    # ---------------- 紫荆园 (B13 2/13) ----------------
    dict(canteen="zi_jing_yuan", floor=None, stall="清青披萨",
         title="薯格/薯角", price="¥12", review="好评",
         review_text="土豆香足，12 元。",
         cuisines=["western", "grill"], tags=["性价比高"], spicy=0,
         slots=["lunch", "dinner", "night"], vegetarian=True),
    dict(canteen="zi_jing_yuan", floor=None, stall="清青披萨",
         title="烤翅", price="¥5", review="好评",
         review_text="5 元一对现烤，性价比高；对涨价菜品评价不佳。",
         cuisines=["grill", "western"], tags=["性价比高", "现做"], spicy=0,
         slots=["lunch", "dinner", "night"], vegetarian=False),
    dict(canteen="zi_jing_yuan", floor=None, stall="清青披萨",
         title="奶油蘑菇汤", price="¥6", review="两极",
         review_text="有人觉得便宜好喝，有人觉得味道怪。",
         cuisines=["western", "light"], tags=["汤品"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=True),
    dict(canteen="zi_jing_yuan", floor=None, stall="清青披萨",
         title="西班牙土豆汤", price="¥16", review="好评",
         review_text="16 元，好喝。",
         cuisines=["western", "light"], tags=["汤品"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=True),
    dict(canteen="zi_jing_yuan", floor=None, stall="清青披萨",
         title="意大利梅肉", price="¥38?", review="好评",
         review_text="味道出众，38 元左右偏贵。",
         cuisines=["western"], tags=["偏贵"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="zi_jing_yuan", floor="1F", stall=None,
         title="烧鸭饭", price="¥15", review="好评",
         review_text="配梅子酱很出彩，性价比高；但出品不稳定，偏咸、偶尔带腥，价格也有同学提出异议。",
         cuisines=["cantonese", "rice"], tags=["性价比高", "出品不稳定", "偏咸"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),

    # ---------------- 观畴园 (A13 3/13 + 4/13) ----------------
    dict(canteen="guan_chou_yuan", floor=None, stall="最最最左边的炸鸡窗口",
         title="无骨鸡腿", price="¥7", review="好评",
         review_text="7 元，比其他食堂炸鸡更嫩滑；同窗口鸡柳也不错，带骨的不推荐。",
         cuisines=["grill"], tags=["性价比高"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="guan_chou_yuan", floor=None, stall=None,
         title="蒜香鸡块 / 黄金龙骨", price="¥10块左右", review="好评",
         review_text="10 元左右，很香。",
         cuisines=["grill", "homestyle"], tags=["香口"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False,
         variants=["蒜香鸡块", "黄金龙骨"]),
    dict(canteen="guan_chou_yuan", floor=None, stall="清青永和大饼卷翻天窗口旁边",
         title="香菇肉包 / 冬菜肉包", price="¥3或2.5一个", review="好评",
         review_text="2.5-3 元一个，个头大，馅调得好。",
         cuisines=["breakfast", "snacks"], tags=["性价比高", "早餐"], spicy=0,
         slots=["breakfast"], vegetarian=None,
         variants=["香菇肉包", "冬菜肉包"]),
    dict(canteen="guan_chou_yuan", floor=None, stall=None,
         title="藤椒焖面", price="¥16?", review="好评",
         review_text="16 元左右，很香但容易腻、营养不够均衡，口味淡者慎点。",
         cuisines=["sichuan", "noodles"], tags=["重口", "偏油"], spicy=2,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="guan_chou_yuan", floor="2F", stall="自选",
         title="肉松蛋黄青团", price="¥5.8r", review="好评",
         review_text="5.8 元，价格小贵但好吃到嫌自己胃小。",
         cuisines=["jiangzhe", "snacks"], tags=["网红"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="guan_chou_yuan", floor="2F", stall="某个拐角",
         title="鸡汁豆腐", price="¥4.5", review="好评",
         review_text="4.5 元，豆腐泡水煮后淋麻酱，清淡好吃。",
         cuisines=["homestyle", "light"], tags=["清淡", "性价比高"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="guan_chou_yuan", floor="2F", stall="主食区",
         title="肉松青团", price="¥5.8", review="好评",
         review_text="5.8 元，皮薄馅足、艾草香明显，肉松浸了蛋黄油。",
         cuisines=["jiangzhe", "snacks"], tags=["网红"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="guan_chou_yuan", floor=None, stall="入口处",
         title="三杯鸡", price="¥6左右", review="好评",
         review_text="6 元左右，被称清华最好吃的鸡肉。",
         cuisines=["taiwanese", "homestyle"], tags=["校内公认好吃", "性价比高"], spicy=1,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="guan_chou_yuan", floor=None, stall=None,
         title="粘豆包", price="¥3.5", review="好评",
         review_text="3.5 元，甜而不腻。",
         cuisines=["northeast", "snacks", "breakfast"], tags=["甜口", "性价比高"], spicy=0,
         slots=["breakfast", "dessert"], vegetarian=True),
    dict(canteen="guan_chou_yuan", floor=None, stall=None,
         title="美味杏鲍菇", price=None, review="好评",
         review_text="油润好吃。",
         cuisines=["homestyle", "light"], tags=["清淡"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=True),
    dict(canteen="guan_chou_yuan", floor="3F", stall=None,
         title="北京烤鸭", price="¥45/半只", review="好评",
         review_text="45 元半只，不输校外，校内公认最好吃；甲所、玉树一楼也有。",
         cuisines=["beijing"], tags=["校内公认好吃", "必点"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="guan_chou_yuan", floor=None, stall="窗口整体推荐",
         type="stall_recommendation", title="（窗口整体推荐）", price="¥11—20+", review="好评",
         review_text="11-20 元以上，拌酱出彩。",
         cuisines=[], tags=["自选"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=None),

    # ---------------- 丁香园 (A13 5/13) ----------------
    dict(canteen="ding_xiang_yuan", floor=None, stall=None,
         title="紫薯山药", price=None, review="信息较少",
         review_text="只留了菜名，没有评价。",
         cuisines=["light", "homestyle"], tags=[], spicy=0,
         slots=["lunch", "dinner"], vegetarian=True),
    dict(canteen="ding_xiang_yuan", floor=None, stall="烤肉拌饭",
         title="蜜汁肥牛拌饭 / 黑椒鸡肉", price="¥9.5(黑椒鸡肉)/12", review="好评",
         review_text="9.5-12 元，好吃。",
         cuisines=["rice", "korean"], tags=["性价比高"], spicy=1,
         slots=["lunch", "dinner"], vegetarian=False,
         variants=["蜜汁肥牛拌饭", "黑椒鸡肉"]),
    dict(canteen="ding_xiang_yuan", floor=None, stall="广东窗口",
         title="肠粉", price="¥6-10r", review="好评",
         review_text="6-10 元，虽不算完全正宗，但已是附近最好吃的肠粉；同窗口凤爪和排骨煲仔饭也被点名推荐。",
         cuisines=["cantonese", "snacks", "breakfast"], tags=["性价比高", "早餐"], spicy=0,
         slots=["breakfast", "lunch"], vegetarian=False),
    dict(canteen="ding_xiang_yuan", floor=None, stall="名厨窗口",
         title="糖醋排骨 / 红烧排骨", price="¥6?", review="好评",
         review_text="6 元左右，分量足；两个窗口分别是红烧和糖醋，都好吃。",
         cuisines=["homestyle"], tags=["量大", "性价比高"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False,
         variants=["糖醋排骨", "红烧排骨"]),

    # ---------------- 芝兰园 (A13 6/13) ----------------
    dict(canteen="zhi_lan_yuan", floor="1F", stall="一楼左数第二个口",
         title="豆腐虾滑", price="¥15左右", review="好评",
         review_text="15 元左右，可点半份；虾滑大块，豆腐嫩而不碎。",
         cuisines=["homestyle", "light"], tags=["可点半份"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),

    # ---------------- 熙春园 (A13 7/13) ----------------
    dict(canteen="xi_chun_yuan", floor=None, stall=None,
         title="龙井虾仁", price="¥108", review="好评",
         review_text="好吃，但价格比校外杭帮菜馆还贵，108 元。",
         cuisines=["jiangzhe"], tags=["偏贵"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="xi_chun_yuan", floor=None, stall=None,
         title="樟茶鸭、锅贴", price="¥50左右", review="好评",
         review_text="50 元左右，杭帮口味。",
         cuisines=["sichuan", "snacks"], tags=[], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False,
         variants=["樟茶鸭", "锅贴"]),
    dict(canteen="xi_chun_yuan", floor=None, stall=None,
         title="响油鳝糊、蟹黄豆腐", price="¥128", review="两极",
         review_text="菜品精致但口味偏淡，价格 128 元档。",
         cuisines=["jiangzhe"], tags=["偏贵", "清淡"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False,
         variants=["响油鳝糊", "蟹黄豆腐"]),

    # ---------------- 独峰书院 (A13 8/13) ----------------
    dict(canteen="du_feng_shu_yuan", floor=None, stall=None,
         title="西班牙海鲜汤", price=None, review="已停业",
         review_text="跟帖表示独峰书院已经没了。",
         cuisines=["western"], tags=["已停业"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),

    # ---------------- 清青咖啡 (A13 9/13) ----------------
    dict(canteen="qing_qing_coffee", floor=None, stall="主食",
         title="汉堡", price="¥45左右", review="好评",
         review_text="45 元左右，牛肉厚且多汁，薯条脆，接近专门汉堡店水准。",
         cuisines=["burger", "western"], tags=["偏贵"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="qing_qing_coffee", floor=None, stall="好像就一个",
         title="沙拉（各款）", price="¥30-50", review="好评",
         review_text="30-50 元，好吃。",
         cuisines=["light", "western"], tags=["轻食"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=None),
    dict(canteen="qing_qing_coffee", floor=None, stall=None,
         title="泰式香茅烤鸡沙拉碗", price="¥38还是36", review="好评",
         review_text="36-38 元，鸡肉香料味足、酱汁偏中式，配菜丰富。",
         cuisines=["thai", "light"], tags=["轻食"], spicy=1,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="qing_qing_coffee", floor=None, stall=None,
         title="华夫饼", price="忘了好像不是很贵", review="好评",
         review_text="价格不贵，在店内算独立的亮点。",
         price_hint=dict(min=None, max=None, approx=True, uncertain=True, note="价格未记录"),
         cuisines=["dessert", "western"], tags=["甜口"], spicy=0,
         slots=["dessert"], vegetarian=True),

    # ---------------- 清青牛拉 (A13 10/13) ----------------
    dict(canteen="qing_qing_niu_la", floor=None, stall="左数第二个",
         title="炒面片", price="¥20", review="好评",
         review_text="20 元，比附近外卖好吃；但分量偏少，性价比一般。",
         cuisines=["halal", "northwest", "noodles"], tags=["分量偏少"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),

    # ---------------- 清青快餐 (A13 11/13) ----------------
    dict(canteen="qing_qing_kuai_can", floor=None, stall="甜点类",
         title="芭菲", price="¥12r", review="好评",
         review_text="12 元，果味浓、没有香精感，性价比好；跟帖在问哪个窗口有。",
         cuisines=["dessert"], tags=["性价比高"], spicy=0,
         slots=["dessert"], vegetarian=True),

    # ---------------- C楼 (A13 12/13) ----------------
    dict(canteen="c_lou", floor=None, stall="小食屋",
         title="煎饼/烤冷面", price="17-23左右（看加几样东西）", review="好评",
         review_text="17-23 元，基础款配生菜、黑椒肠或鸡排再加芝士最推荐。",
         cuisines=["northeast", "snacks", "breakfast"], tags=["现做"], spicy=0,
         slots=["breakfast", "lunch", "night"], vegetarian=None,
         variants=["煎饼", "烤冷面"]),
    dict(canteen="c_lou", floor=None, stall="蜜雪冰城",
         title="香芋脆皮小圣代（奶布丁版）", price="¥5r", review="好评",
         review_text="5 元，香芋冰淇淋配巧克力脆皮；C楼与观畴的奶布丁口感不同，都好吃。跟帖提到 C楼的蜜雪冰城已撤出。",
         cuisines=["dessert"], tags=["性价比高", "可能已撤出"], spicy=0,
         slots=["dessert"], vegetarian=True,
         variants=["香芋脆皮小圣代（奶布丁版）"]),

    # ---------------- 711 (A13 13/13) ----------------
    dict(canteen="convenience_711", floor=None, stall="澜园出来顺便买",
         title="巧克力冰淇淋", price=None, review="信息较少",
         review_text="澜园出来顺路可买，没有评价。",
         cuisines=["dessert"], tags=[], spicy=0,
         slots=["dessert"], vegetarian=True),

    # ---------------- 清芬园 (C9 4/9) ----------------
    dict(canteen="qing_fen_yuan", floor="2F", stall="瓦罐汤",
         title="白菜豆腐粉丝汤", price="¥3元", review="好评",
         review_text="3 元，看着清淡但味道出乎意料地好。",
         cuisines=["homestyle", "light"], tags=["清淡", "性价比高", "汤品"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=True),
    dict(canteen="qing_fen_yuan", floor="2F", stall="从右往左第二个窗口",
         title="葱爆羊肉", price="¥6（半份）", review="信息较少",
         review_text="可点半份约 6 元，没有评价。",
         cuisines=["homestyle", "beijing"], tags=["可点半份"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),

    # ---------------- 听涛园 (C9 5/9) ----------------
    dict(canteen="ting_tao_yuan", floor=None, stall="川味小吃",
         title="龙抄手", price="¥8r", review="好评",
         review_text="鲜美肉多，不爱吃肉的人也会喜欢，8 元。",
         cuisines=["sichuan", "snacks"], tags=["性价比高"], spicy=1,
         slots=["breakfast", "lunch", "dinner"], vegetarian=False),
    dict(canteen="ting_tao_yuan", floor=None, stall="桂林米粉",
         title="香辣牛肉粉", price="¥9", review="好评",
         review_text="粉细，可请师傅煮软一点，自行加辣加醋更香。",
         cuisines=["sichuan", "noodles"], tags=["重口"], spicy=3,
         slots=["breakfast", "lunch", "dinner"], vegetarian=False),
    dict(canteen="ting_tao_yuan", floor=None, stall="现磨豆浆",
         title="红枣豆浆", price="¥3r", review="好评",
         review_text="现磨浓稠、甜度刚好，底部有红枣碎，3 元。",
         cuisines=["drinks", "breakfast"], tags=["性价比高", "早餐", "现磨"], spicy=0,
         slots=["breakfast", "drink"], vegetarian=True),
    dict(canteen="ting_tao_yuan", floor=None, stall="桂林风味",
         title="肥牛粉", price="¥15r", review="好评",
         review_text="15 元，香。",
         cuisines=["noodles"], tags=[], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="ting_tao_yuan", floor=None, stall="川香小吃",
         title="沙茶面", price="小碗8 大碗10", review="好评",
         review_text="用料丰富，沙茶酱与面很搭；小碗 8 元、大碗 10 元。",
         cuisines=["noodles", "minnan"], tags=["性价比高"], spicy=1,
         slots=["breakfast", "lunch", "dinner"], vegetarian=False),
    dict(canteen="ting_tao_yuan", floor=None, stall=None,
         title="饺子", price=None, review="好评",
         review_text="便宜好吃。",
         cuisines=["snacks", "homestyle"], tags=["性价比高"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=None),

    # ---------------- 玉树园 (C9 6/9) ----------------
    dict(canteen="yu_shu_yuan", floor=None, stall=None,
         title="紫荆花开（饮料）", price=None, review="好评",
         review_text="清华特色现调饮品（酸奶+紫荆花汁），好看好喝，适合被人请客时点。",
         cuisines=["drinks"], tags=["清华特色", "适合请客"], spicy=0,
         slots=["drink"], vegetarian=True),
    dict(canteen="yu_shu_yuan", floor="2F", stall=None,
         title="辣白菜五花肉石锅拌饭", price="¥16", review="好评",
         review_text="16 元，好吃又实惠。",
         cuisines=["korean", "rice"], tags=["性价比高"], spicy=1,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="yu_shu_yuan", floor="2F", stall=None,
         title="辣白菜肥牛饭", price="¥25r", review="好评",
         review_text="25 元，评价正面。",
         cuisines=["korean", "rice"], tags=[], spicy=1,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="yu_shu_yuan", floor="2F", stall=None,
         title="照烧鸡饭", price="¥20", review="好评",
         review_text="来玉树必点，20 元。",
         cuisines=["japanese", "rice"], tags=["必点"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="yu_shu_yuan", floor="2F", stall=None,
         title="铁板菌菇鸡柳饭", price="¥18", review="好评",
         review_text="18 元，味不重但好吃。",
         cuisines=["grill", "rice"], tags=["清淡"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="yu_shu_yuan", floor="2F", stall=None,
         title="铁板芝士鸡配米饭", price="¥22", review="好评",
         review_text="22 元，韩式甜辣（几乎不辣），近似奥尔良烤鸡味。",
         cuisines=["korean", "grill", "rice"], tags=[], spicy=1,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="yu_shu_yuan", floor="2F", stall=None,
         title="铁板菌香鸡柳饭", price="¥18", review="好评",
         review_text="18 元，评价很高。",
         cuisines=["grill", "rice"], tags=[], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="yu_shu_yuan", floor="2F", stall=None,
         title="石锅照烧五花肉", price="¥18", review="好评",
         review_text="18 元，量大肉多、荤素搭配合理，偏甜带洋葱。",
         cuisines=["japanese", "grill"], tags=["量大", "甜口"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),

    # ---------------- 寓园 (C9 7/9) ----------------
    dict(canteen="yu_yuan", floor=None, stall="铁板旁边的瓦罐汤",
         title="瓦罐汤（竹荪排骨 / 萝卜排骨）", price="¥10元以下", review="好评",
         review_text="瓦罐汤各款都不错，10 元以下。",
         cuisines=["homestyle", "light"], tags=["汤品", "性价比高"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False,
         variants=["竹荪排骨", "萝卜排骨"]),
    dict(canteen="yu_yuan", floor=None, stall=None,
         title="铁板", price="¥16-18", review="好评",
         review_text="铁板 16-18 元，被称为寓园最能打的窗口；同食堂香锅、肉夹馍也获陕西同学认可。",
         cuisines=["grill"], tags=["必点", "性价比高"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=None),
    dict(canteen="yu_yuan", floor=None, stall="陕西风味",
         title="肉夹馍", price="¥7", review="好评",
         review_text="7 元，肉多味好、一个女生能吃饱；馍一般。",
         cuisines=["northwest", "snacks"], tags=["量大"], spicy=0,
         slots=["breakfast", "lunch", "dinner"], vegetarian=False),
    dict(canteen="yu_yuan", floor=None, stall=None,
         title="麻辣香锅", price="按重量收费，一顿大约20", review="值得一试",
         review_text="按重量计费，一顿约 20 元。",
         cuisines=["hotpot", "sichuan"], tags=[], spicy=3,
         slots=["lunch", "dinner"], vegetarian=None),
    dict(canteen="yu_yuan", floor=None, stall="香锅",
         title="麻辣香锅（中辣）", price="¥20r", review="好评",
         review_text="鸡胗出色、味道正，被称校内最好吃的香锅，20 元。",
         cuisines=["hotpot", "sichuan"], tags=["校内公认好吃", "必点"], spicy=2,
         slots=["lunch", "dinner"], vegetarian=False),

    # ---------------- 澜园 (C9 8/9 + 9/9) ----------------
    dict(canteen="lan_yuan", floor=None, stall=None,
         title="精品冒菜", price="¥20-50r", review="好评",
         review_text="20-50 元，建议选辣，可不要调料；牛心、黄喉值得点。",
         cuisines=["hotpot", "sichuan"], tags=["必点"], spicy=2,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="lan_yuan", floor="1F", floor_source="window", stall="一楼米饭自选",
         title="椒麻鸡", price="¥10r", review="好评",
         review_text="10 元，来澜园必点系列。",
         cuisines=["sichuan"], tags=["必点", "性价比高"], spicy=2,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="lan_yuan", floor="2F", stall="二楼面类",
         title="三合一", price="¥11", review="好评",
         review_text="11 元，澜园面食公认最好吃（尤其各种炒拉条）；也有人觉得偏咸。",
         cuisines=["noodles", "northwest"], tags=["校内公认好吃", "偏咸"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="lan_yuan", floor="3F", stall="锅仔",
         title="羊肉锅（不辣）", price="¥18", review="好评",
         review_text="18 元，巨好吃。",
         cuisines=["hotpot"], tags=[], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="lan_yuan", floor="3F", stall="广东窗口",
         type="stall_recommendation", title="（窗口整体推荐）", price=None, review="好评",
         review_text="广东窗口可闭眼点，白切鸡、叉烧、烧鸭、脆皮五花都好吃，随意双拼。",
         cuisines=["cantonese"], tags=["必点"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="lan_yuan", floor=None, stall="进门后麻辣烫旁边",
         title="锅仔（牛肉 / 羊肉 / 鸡翅）", price="¥18-25貌似", review="好评",
         review_text="18-25 元抵得上校外火锅，辣与不辣都香，加方便面更佳。",
         cuisines=["hotpot"], tags=["性价比高"], spicy=1,
         slots=["lunch", "dinner"], vegetarian=False,
         variants=["牛肉锅仔", "羊肉锅仔", "鸡翅锅仔"]),
    dict(canteen="lan_yuan", floor=None, stall="左数第二个，陕西窗口",
         title="羊肉烩面", price=None, review="差评",
         review_text="跟帖直言不好吃。",
         cuisines=["northwest", "noodles", "halal"], tags=["不推荐"], spicy=0,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="lan_yuan", floor=None, stall="面？",
         title="油泼面", price="¥8块", review="好评",
         review_text="8 元，做法与常见版本略有不同但好吃。",
         cuisines=["northwest", "noodles"], tags=["性价比高"], spicy=2,
         slots=["lunch", "dinner"], vegetarian=False),
    dict(canteen="lan_yuan", floor=None,
         stall="进门右手第一家麻辣拌，一定要麻辣拌，因为其他还没尝试",
         title="麻辣拌（自选，建议少盐）", price="¥20+，因为是自选", review="强烈推荐",
         review_text="20 元起自选，被称校内各食堂麻辣拌第一；建议少盐、选酸甜少辣。",
         cuisines=["northeast", "hotpot"], tags=["校内公认好吃", "自选"], spicy=3,
         slots=["lunch", "dinner"], vegetarian=None),
]


# --------------------------------------------------------------------------
# Build helpers
# --------------------------------------------------------------------------
CN_DIGITS = {"十": 10, "两": 2, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
             "六": 6, "七": 7, "八": 8, "九": 9}


def parse_price(text, hint=None):
    """Turn a badge string into a structured price object."""
    if hint is not None:
        return {
            "text": text,
            "min": hint.get("min"),
            "max": hint.get("max"),
            "currency": "CNY",
            "approx": bool(hint.get("approx", False)),
            "uncertain": bool(hint.get("uncertain", False)),
            "openEnded": bool(hint.get("openEnded", False)),
            "note": hint.get("note"),
        }
    if not text:
        return {"text": None, "min": None, "max": None, "currency": "CNY",
                "approx": False, "uncertain": False, "openEnded": False, "note": None}

    numbers = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", text)]
    approx = any(k in text for k in ("左右", "大概", "貌似", "约", "大约"))
    uncertain = ("?" in text) or ("？" in text) or ("忘了" in text) or ("还是" in text)
    open_ended = ("+" in text) or ("以上" in text)
    below = "以下" in text

    low = min(numbers) if numbers else None
    high = max(numbers) if numbers else None
    if below:
        low, high = None, high
    if open_ended:
        high = None
    if not numbers:
        low = high = None

    note = None
    for marker in ("半只", "半份", "一个", "小碗", "大碗", "看加几样东西",
                   "按重量收费", "因为是自选", "自选"):
        if marker in text:
            note = marker
            break
    if "小碗" in text and "大碗" in text:
        note = "小碗 / 大碗"

    def norm(value):
        if value is None:
            return None
        return int(value) if float(value).is_integer() else value

    return {
        "text": text,
        "min": norm(low),
        "max": norm(high),
        "currency": "CNY",
        "approx": approx,
        "uncertain": uncertain,
        "openEnded": open_ended,
        "note": note,
    }


def price_tier(price):
    """Bucket a price by its cheapest known amount."""
    anchor = price["min"] if price["min"] is not None else price["max"]
    if anchor is None:
        return None
    for tier_id, _label, low, high in PRICE_TIERS:
        if anchor > low and (high is None or anchor <= high):
            return tier_id
    return None


def slugify(value: str) -> str:
    norm = unicodedata.normalize("NFKD", value)
    norm = re.sub(r"[^0-9A-Za-z]+", "-", norm).strip("-").lower()
    return norm


REVIEW_LABEL_MAP = {label: level for level, label, _, _, _, _ in REVIEW_LEVELS}
REVIEW_META = {level: {"label": label, "sentiment": sentiment, "drawWeight": weight,
                       "excludedByDefault": excluded, "description": desc}
               for level, label, sentiment, weight, excluded, desc in REVIEW_LEVELS}

# Default page each canteen was read from; overridden per dish when a canteen
# spans two screenshots (观畴园 3/13 + 4/13, 澜园 8/9 + 9/9).
# NOTE: a canteen appears twice in SOURCE_INDEX in those cases, so keep the FIRST
# page seen and let PAGE_OVERRIDES move the records that came from the later one.
PAGE_BY_CANTEEN: dict = {}
for _post, _page, _canteen in SOURCE_INDEX.values():
    PAGE_BY_CANTEEN.setdefault(_canteen, _page)
PAGE_OVERRIDES = {
    ("guan_chou_yuan", "三杯鸡"): "4/13",
    ("guan_chou_yuan", "粘豆包"): "4/13",
    ("guan_chou_yuan", "美味杏鲍菇"): "4/13",
    ("guan_chou_yuan", "北京烤鸭"): "4/13",
    ("guan_chou_yuan", "（窗口整体推荐）"): "4/13",
    ("lan_yuan", "锅仔（牛肉 / 羊肉 / 鸡翅）"): "9/9",
    ("lan_yuan", "羊肉烩面"): "9/9",
    ("lan_yuan", "油泼面"): "9/9",
    ("lan_yuan", "麻辣拌（自选，建议少盐）"): "9/9",
}
IMAGE_BY_CANTEEN_PAGE = {(canteen, page): image
                         for image, (_post, page, canteen) in SOURCE_INDEX.items()}
POST_BY_CANTEEN = {canteen: post for post, _page, canteen in SOURCE_INDEX.values()}


def is_drawable(dish: dict) -> bool:
    """默认抽签池里的菜品：非窗口级推荐，且不是差评/已停业。"""
    return dish["type"] != "stall_recommendation" and not dish["excludedByDefault"]


def build():
    canteen_ids = {c["id"] for c in CANTEENS}
    cuisine_ids = {c[0] for c in CUISINES}
    errors = []

    dishes = []
    counters = {}
    for raw in DISHES:
        canteen = raw["canteen"]
        if canteen not in canteen_ids:
            errors.append(f"unknown canteen: {canteen}")
            continue
        counters[canteen] = counters.get(canteen, 0) + 1
        dish_id = f"{canteen}-{counters[canteen]:02d}"

        label = raw["review"]
        if label not in REVIEW_LABEL_MAP:
            errors.append(f"{dish_id}: unknown review label {label}")
            continue
        level = REVIEW_LABEL_MAP[label]

        for cuisine in raw["cuisines"]:
            if cuisine not in cuisine_ids:
                errors.append(f"{dish_id}: unknown cuisine {cuisine}")
        for tag in raw["tags"]:
            if tag not in TAGS:
                errors.append(f"{dish_id}: unknown tag {tag}")

        page = PAGE_OVERRIDES.get((canteen, raw["title"]), PAGE_BY_CANTEEN[canteen])
        image = IMAGE_BY_CANTEEN_PAGE.get((canteen, page))
        if image is None:
            errors.append(f"{dish_id}: no screenshot mapped for {canteen} page {page}")
            source = None
        else:
            source = {"image": image, "post": POST_BY_CANTEEN[canteen], "page": page}

        price = parse_price(raw.get("price"), raw.get("price_hint"))
        variants = raw.get("variants") or []
        search = [raw["title"]] + variants
        if raw.get("stall"):
            search.append(raw["stall"])

        floor = raw.get("floor")
        # "section" = 来自截图里的橙色分区标题（饭堂 · 2F）
        # "window"  = 分区没标楼层，但从窗口原文推断（如“一楼米饭自选”）
        floor_source = raw.get("floor_source", "section" if floor else None)

        dishes.append({
            "id": dish_id,
            "type": raw.get("type", "dish"),
            "name": raw["title"],
            "variants": variants,
            "canteenId": canteen,
            "floor": floor,
            "floorId": f"{canteen}-{floor.lower()}" if floor else None,
            "floorSource": floor_source,
            "stallName": raw.get("stall"),
            "cuisines": raw["cuisines"],
            "primaryCuisine": raw["cuisines"][0] if raw["cuisines"] else None,
            "tags": raw["tags"],
            "spicyLevel": raw["spicy"],
            "mealSlots": raw["slots"],
            "vegetarian": raw["vegetarian"],
            "price": price,
            "priceTier": price_tier(price),
            "reviewLevel": level,
            "reviewLabel": label,
            "reviewText": raw["review_text"],
            "drawWeight": REVIEW_META[level]["drawWeight"],
            "excludedByDefault": REVIEW_META[level]["excludedByDefault"],
            "searchKeys": search,
            "source": source,
        })

    # canteen views -------------------------------------------------------
    canteens = []
    for c in CANTEENS:
        own = [d for d in dishes if d["canteenId"] == c["id"]]
        floors_seen = []
        for dish in own:
            if dish["floor"] and dish["floor"] not in floors_seen:
                floors_seen.append(dish["floor"])
        floors = []
        for floor in sorted(floors_seen):
            floor_dishes = [d for d in own if d["floor"] == floor]
            floors.append({
                "id": f"{c['id']}-{floor.lower()}",
                "canteenId": c["id"],
                "floor": floor,
                "label": MEAL_FLOOR_LABELS.get(floor, floor),
                "stallNames": sorted({d["stallName"] for d in floor_dishes if d["stallName"]}),
                "dishCount": len(floor_dishes),
                "drawableDishCount": len([d for d in floor_dishes if is_drawable(d)]),
                "drawWeight": sum(d["drawWeight"] for d in floor_dishes if is_drawable(d)),
            })
        no_floor = [d for d in own if not d["floor"]]
        record = {
            "id": c["id"],
            "name": c["name"],
            "category": c["category"],
            "status": c.get("status", "open"),
            "tags": c["tags"],
            "note": c["note"],
            "floors": floors,
            "unassignedFloorDishCount": len(no_floor),
            "dishCount": len(own),
            "drawableDishCount": len([d for d in own if is_drawable(d)]),
            "drawWeight": sum(d["drawWeight"] for d in own if is_drawable(d)),
            "stallNames": sorted({d["stallName"] for d in own if d["stallName"]}),
            "cuisines": sorted({cu for d in own for cu in d["cuisines"]}),
        }
        canteens.append(record)

    # indexes -------------------------------------------------------------
    def group(key_fn):
        out = {}
        for dish in dishes:
            for key in key_fn(dish):
                if key is None:
                    continue
                out.setdefault(key, []).append(dish["id"])
        return out

    indexes = {
        "byCanteen": group(lambda d: [d["canteenId"]]),
        "byFloor": group(lambda d: [d["floorId"]]),
        "byCuisine": group(lambda d: d["cuisines"]),
        "byTag": group(lambda d: d["tags"]),
        "byReviewLevel": group(lambda d: [d["reviewLevel"]]),
        "byPriceTier": group(lambda d: [d["priceTier"]]),
        "byMealSlot": group(lambda d: d["mealSlots"]),
        "bySpicyLevel": group(lambda d: [f"L{d['spicyLevel']}"]),
    }

    cuisines = []
    for cid, name, group_name, emoji, keywords in CUISINES:
        dish_ids = indexes["byCuisine"].get(cid, [])
        cuisines.append({
            "id": cid,
            "name": name,
            "group": group_name,
            "emoji": emoji,
            "keywords": keywords.split("、"),
            "dishCount": len(dish_ids),
            "dishIds": dish_ids,
            "canteenIds": sorted({d["canteenId"] for d in dishes if cid in d["cuisines"]}),
        })

    draw = {
        "modes": [
            {
                "id": "canteen_then_dish",
                "name": "今天吃什么（先抽饭堂再抽菜）",
                "steps": ["drawCanteen", "drawFloor", "drawDish"],
                "description": "先按饭堂抽签，再在该饭堂（可选楼层）内按 drawWeight 抽一道菜。",
            },
            {
                "id": "cuisine_first",
                "name": "按菜系推荐",
                "steps": ["filterByCuisine", "rankByScore"],
                "description": "先选菜系/口味，再按 drawWeight、价格、辣度过滤排序。",
            },
            {
                "id": "surprise",
                "name": "完全随机",
                "steps": ["drawDish"],
                "description": "在全部可用菜品中直接抽一道，不再区分饭堂。",
            },
        ],
        "defaults": {
            "excludeReviewLevels": [level for level, meta in REVIEW_META.items()
                                    if meta["excludedByDefault"]],
            "weightsByReviewLevel": {level: meta["drawWeight"] for level, meta in REVIEW_META.items()},
            "excludeTypes": ["stall_recommendation"],
            "maxSpicyLevel": 3,
        },
        "parameters": {
            "canteenId": "限定饭堂",
            "floor": "限定楼层，如 2F",
            "cuisines": "限定菜系 id 数组，命中任一即可",
            "maxPrice": "价格上限（按 price.min 判断）",
            "maxSpicyLevel": "辣度上限 0-3",
            "mealSlot": "breakfast/lunch/dinner/night/drink/dessert",
            "vegetarian": "true 只要素，false 只要荤，null 不限",
            "seed": "整数随机种子，便于把抽签结果分享给同学复现",
        },
        "spicyScale": {
            "0": "不辣",
            "1": "微辣",
            "2": "中辣",
            "3": "重辣",
        },
    }

    stats = {
        "canteenCount": len(canteens),
        "canteenWithFloorCount": len([c for c in canteens if c["floors"]]),
        "floorCount": sum(len(c["floors"]) for c in canteens),
        "dishCount": len(dishes),
        "dishRecordCount": len(dishes),
        "recommendableDishCount": len([d for d in dishes if not d["excludedByDefault"]]),
        "stallRecommendationCount": len([d for d in dishes if d["type"] == "stall_recommendation"]),
        "cuisineCount": len(cuisines),
        "usedCuisineCount": len([c for c in cuisines if c["dishCount"]]),
        "sourceImageCount": len(SOURCE_INDEX),
        "pricedDishCount": len([d for d in dishes if d["price"]["min"] is not None or d["price"]["max"] is not None]),
        "unknownPriceDishCount": len([d for d in dishes if d["price"]["min"] is None and d["price"]["max"] is None]),
        "noReviewCount": len([d for d in dishes if d["reviewLevel"] == "low_info"]),
    }

    meta = {
        "title": "清华食堂吃饭指南 · 结构化数据",
        "subtitle": "不同饭堂 + 楼层 + 菜系的菜品数据，用于“今天吃什么”抽签与菜系推荐",
        "version": SCHEMA_VERSION,
        "generatedAt": GENERATED_AT,
        "generator": "tools/build_menu_data.py",
        "origin": {
            "platform": "小红书",
            "account": "饭饭推荐（小红书号 7411829636，页面水印）",
            "collection": "清华食堂吃饭指南（食堂安利）",
            "images": sorted(SOURCE_INDEX),
            "imageCount": len(SOURCE_INDEX),
        },
        "posts": POSTS,
        "fieldNotes": {
            "id": "饭堂前缀 + 两位序号，稳定不变，可作小程序端主键",
            "floor": "截图里明确标注的楼层，未标注则为 null",
            "floorSource": "section = 来自截图橙色分区标题；window = 分区未标楼层，从窗口原文推断（仅澜园椒麻鸡，窗口写“一楼米饭自选”）",
            "stallName": "截图里“窗口：”后面的原文（保留口语化描述）",
            "price.text": "截图徽章原文，未经改写",
            "price.min/max": "由徽章解析出的价格区间；approx=左右/大概，uncertain=带问号或“忘了”",
            "reviewLevel": "帖子自带的评价标签（好评/强烈推荐/两极/信息较少/差评/已停业/值得一试）",
            "drawWeight": "抽签权重，来自 reviewLevel：强烈推荐 5、好评/值得一试 3、两极 1.5、信息较少 1、差评与已停业 0",
            "spicyLevel": "0 不辣 / 1 微辣 / 2 中辣 / 3 重辣",
        },
        "caveats": [
            "数据来自小红书个人分享，价格为截图时点价格，可能已变动。",
            "两张截图都标注“第 2/13 张”（荷园、紫荆园），说明存在两套 13 张系列的帖子；本数据集把它们区分为 A13 / B13。",
            "缺失页：A13 缺第 1 张，B13 只有第 2 张，C9 缺第 1-3 张。",
            "校名是“清青快餐/清青牛拉/清青咖啡/清青永和”，截图中易误读为“清清”，本数据集已按“清青”录入。",
            "跟帖提到 C 楼蜜雪冰城已撤出、独峰书院已停业，相关记录标记为可能过时/已停业。",
            "“（窗口整体推荐）”类记录 type = stall_recommendation，默认不参与抽签，只作窗口级推荐展示。",
        ],
        "stats": stats,
    }

    data = {
        "meta": meta,
        "taxonomy": {
            "cuisines": [{"id": c[0], "name": c[1], "group": c[2], "emoji": c[3],
                          "keywords": c[4].split("、")} for c in CUISINES],
            "tags": [{"id": slugify(name), "name": name, "polarity": polarity,
                      "description": desc} for name, (polarity, desc) in TAGS.items()],
            "reviewLevels": [{"id": level, "label": label, "sentiment": sentiment,
                              "drawWeight": weight, "excludedByDefault": excluded,
                              "description": desc}
                             for level, label, sentiment, weight, excluded, desc in REVIEW_LEVELS],
            "mealSlots": [{"id": sid, "name": name} for sid, name in MEAL_SLOTS.items()],
            "priceTiers": [{"id": tid, "label": label,
                            "min": low, "max": high} for tid, label, low, high in PRICE_TIERS],
            "spicyScale": [
                {"level": 0, "label": "不辣"},
                {"level": 1, "label": "微辣"},
                {"level": 2, "label": "中辣"},
                {"level": 3, "label": "重辣"},
            ],
            "floors": [
                {"id": "1F", "name": "一层"}, {"id": "2F", "name": "二层"},
                {"id": "3F", "name": "三层"},
            ],
        },
        "canteens": canteens,
        "cuisines": cuisines,
        "dishes": dishes,
        "indexes": indexes,
        "draw": draw,
    }

    if errors:
        raise SystemExit("data errors:\n  " + "\n  ".join(errors))
    return data


MEAL_FLOOR_LABELS = {"1F": "一层", "2F": "二层", "3F": "三层"}


# --------------------------------------------------------------------------
# Writers
# --------------------------------------------------------------------------
def write_json(path: Path, payload) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_schema() -> dict:
    review_ids = [level for level, *_ in REVIEW_LEVELS]
    cuisine_ids = [c[0] for c in CUISINES]
    dish_types = ["dish", "stall_recommendation"]
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://example.local/tsinghua-canteen/menu_data.schema.json",
        "title": "清华食堂吃饭指南 结构化数据",
        "type": "object",
        "required": ["meta", "taxonomy", "canteens", "cuisines", "dishes", "indexes", "draw"],
        "additionalProperties": False,
        "properties": {
            "meta": {"type": "object", "required": ["title", "version", "origin", "stats"]},
            "taxonomy": {
                "type": "object",
                "required": ["cuisines", "tags", "reviewLevels", "mealSlots", "priceTiers"],
            },
            "canteens": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["id", "name", "floors", "dishCount"],
                    "properties": {
                        "id": {"type": "string"},
                        "name": {"type": "string"},
                        "category": {"type": "string"},
                        "status": {"enum": ["open", "discontinued"]},
                        "tags": {"type": "array", "items": {"type": "string"}},
                        "floors": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "required": ["id", "floor", "dishCount"],
                                "properties": {
                                    "id": {"type": "string"},
                                    "canteenId": {"type": "string"},
                                    "floor": {"enum": ["1F", "2F", "3F"]},
                                    "label": {"type": "string"},
                                    "dishCount": {"type": "integer", "minimum": 0},
                                    "stallNames": {"type": "array", "items": {"type": "string"}},
                                },
                            },
                        },
                        "dishCount": {"type": "integer", "minimum": 1},
                    },
                },
            },
            "cuisines": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["id", "name", "dishCount", "dishIds"],
                    "properties": {
                        "id": {"enum": cuisine_ids},
                        "name": {"type": "string"},
                        "group": {"type": "string"},
                        "emoji": {"type": "string"},
                        "dishCount": {"type": "integer", "minimum": 0},
                        "dishIds": {"type": "array", "items": {"type": "string"}},
                    },
                },
            },
            "dishes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["id", "name", "canteenId", "cuisines", "price",
                                 "reviewLevel", "drawWeight", "source"],
                    "properties": {
                        "id": {"type": "string", "pattern": "^[a-z0-9_]+-[0-9]{2}$"},
                        "type": {"enum": dish_types},
                        "name": {"type": "string", "minLength": 1},
                        "variants": {"type": "array", "items": {"type": "string"}},
                        "canteenId": {"type": "string"},
                        "floor": {"oneOf": [{"enum": ["1F", "2F", "3F"]}, {"type": "null"}]},
                        "floorId": {"type": ["string", "null"]},
                        "floorSource": {"oneOf": [{"enum": ["section", "window"]},
                                                  {"type": "null"}]},
                        "stallName": {"type": ["string", "null"]},
                        "cuisines": {"type": "array", "items": {"enum": cuisine_ids}},
                        "primaryCuisine": {"type": ["string", "null"]},
                        "tags": {"type": "array", "items": {"type": "string"}},
                        "spicyLevel": {"type": "integer", "minimum": 0, "maximum": 3},
                        "mealSlots": {"type": "array", "items": {"enum": list(MEAL_SLOTS)}},
                        "vegetarian": {"type": ["boolean", "null"]},
                        "price": {
                            "type": "object",
                            "required": ["text", "currency"],
                            "properties": {
                                "text": {"type": ["string", "null"]},
                                "min": {"type": ["number", "null"]},
                                "max": {"type": ["number", "null"]},
                                "currency": {"const": "CNY"},
                                "approx": {"type": "boolean"},
                                "uncertain": {"type": "boolean"},
                                "openEnded": {"type": "boolean"},
                                "note": {"type": ["string", "null"]},
                            },
                        },
                        "priceTier": {"oneOf": [{"enum": [t[0] for t in PRICE_TIERS]},
                                                {"type": "null"}]},
                        "reviewLevel": {"enum": review_ids},
                        "drawWeight": {"type": "number", "minimum": 0},
                        "excludedByDefault": {"type": "boolean"},
                        "searchKeys": {"type": "array", "items": {"type": "string"}},
                        "source": {
                            "type": "object",
                            "required": ["image", "post", "page"],
                            "properties": {
                                "image": {"type": "string"},
                                "post": {"type": "string"},
                                "page": {"type": "string"},
                            },
                        },
                    },
                },
            },
            "indexes": {"type": "object"},
            "draw": {"type": "object", "required": ["modes", "defaults", "parameters"]},
        },
    }


README_TEMPLATE = """# 清华食堂吃饭指南 · 结构化数据（source_pic）

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

@@COVERAGE_TABLE@@

### 饭堂 × 楼层

@@FLOOR_TABLE@@

### 菜系分布

@@CUISINE_TABLE@@

## 来源索引（截图 -> 帖子 -> 页码 -> 饭堂）

@@SOURCE_TABLE@@

**缺页说明**：@@MISSING_PAGES@@

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

@@CAVEATS@@

## 重新生成 / 校验

```bash
python3 tools/build_menu_data.py          # 生成全部数据文件
python3 tools/validate_menu_data.py       # 校验已生成的数据（schema 关键约束 + 引用完整性）
```
"""


def render_readme(data: dict) -> str:
    meta = data["meta"]
    stats = meta["stats"]
    dishes = data["dishes"]
    name_of = {c["id"]: c["name"] for c in data["canteens"]}

    coverage_rows = [
        ("饭堂", stats["canteenCount"]),
        ("标注了楼层的饭堂", stats["canteenWithFloorCount"]),
        ("楼层条目", stats["floorCount"]),
        ("菜品记录", stats["dishCount"]),
        ("可进抽签池（排除差评/已停业）", stats["recommendableDishCount"]),
        ("窗口级整体推荐（不参与抽签）", stats["stallRecommendationCount"]),
        ("菜系分类", f'{stats["usedCuisineCount"]} / {stats["cuisineCount"]}'),
        ("有价格的菜品", stats["pricedDishCount"]),
        ("价格未记录的菜品", stats["unknownPriceDishCount"]),
        ("来源截图", stats["sourceImageCount"]),
    ]
    coverage_table = "| 指标 | 数量 |\n| --- | --- |\n" + "\n".join(
        f"| {k} | {v} |" for k, v in coverage_rows)

    floor_lines = ["| 饭堂 | 楼层 | 菜品数 | 窗口 |", "| --- | --- | --- | --- |"]
    for canteen in data["canteens"]:
        if canteen["floors"]:
            for floor in canteen["floors"]:
                stalls = "、".join(floor["stallNames"]) or "—"
                floor_lines.append(
                    f'| {canteen["name"]} | {floor["floor"]} | {floor["dishCount"]} | {stalls} |')
        if canteen["unassignedFloorDishCount"]:
            floor_lines.append(
                f'| {canteen["name"]} | 未标注 | {canteen["unassignedFloorDishCount"]} | — |')
    floor_table = "\n".join(floor_lines)

    cuisine_lines = ["| 菜系 | 分组 | 菜品数 | 示例 |", "| --- | --- | --- | --- |"]
    by_id = {d["id"]: d for d in dishes}
    for cuisine in sorted(data["cuisines"], key=lambda c: -c["dishCount"]):
        seen_names = []
        for dish_id in cuisine["dishIds"]:
            dish = by_id[dish_id]
            if dish["type"] != "dish":  # 跳过“（窗口整体推荐）”这类记录
                continue
            if dish["name"] not in seen_names:
                seen_names.append(dish["name"])
            if len(seen_names) == 3:
                break
        examples = "、".join(seen_names) or "—"
        cuisine_lines.append(
            f'| {cuisine["emoji"]} {cuisine["name"]} | {cuisine["group"]} | '
            f'{cuisine["dishCount"]} | {examples} |')
    cuisine_table = "\n".join(cuisine_lines)

    source_lines = ["| 截图文件 | 帖子 | 页码 | 饭堂 | 菜品数 |", "| --- | --- | --- | --- | --- |"]
    per_image = {}
    for dish in dishes:
        per_image.setdefault(dish["source"]["image"], []).append(dish)
    for image in sorted(per_image, key=lambda i: (per_image[i][0]["source"]["post"],
                                                  int(per_image[i][0]["source"]["page"].split("/")[0]))):
        rows = per_image[image]
        source_lines.append(
            f'| `{image}` | {rows[0]["source"]["post"]} | {rows[0]["source"]["page"]} | '
            f'{name_of[rows[0]["canteenId"]]} | {len(rows)} |')
    source_table = "\n".join(source_lines)

    missing = []
    for post in meta["posts"]:
        present = post["pagesPresent"]
        if len(present) <= 2:
            seen = "、".join(str(p) for p in present)
            missing.append(f'{post["id"]}（共 {post["totalPages"]} 张）仅见第 {seen} 张')
        else:
            pages = "、".join(str(p) for p in post["pagesMissing"])
            missing.append(f'{post["id"]}（共 {post["totalPages"]} 张）缺第 {pages} 张')
    missing_pages = "；".join(missing) + "。"

    caveats = "\n".join(f"- {c}" for c in meta["caveats"])

    readme = README_TEMPLATE
    for token, value in (
        ("@@COVERAGE_TABLE@@", coverage_table),
        ("@@FLOOR_TABLE@@", floor_table),
        ("@@CUISINE_TABLE@@", cuisine_table),
        ("@@SOURCE_TABLE@@", source_table),
        ("@@MISSING_PAGES@@", missing_pages),
        ("@@CAVEATS@@", caveats),
    ):
        readme = readme.replace(token, value)
    return readme


# 四种贡献类型的示例（文件以 _ 开头，构建脚本与前端都会跳过）
CONTRIBUTION_EXAMPLES = {
    "_comment": "贡献内容格式示例：dish=常驻菜 / stall=窗口（可含照片）/ canteen=新饭堂 / note=补充说明。文件名以 _ 开头会被跳过。",
    "examples": [
        {
            "id": "20260920-example-dish",
            "kind": "dish",
            "createdAt": "2026-09-20T12:00:00.000Z",
            "author": "匿名同学",
            "payload": {
                "canteenId": "lan_yuan",
                "floor": "3F",
                "stallName": "锅仔",
                "name": "示例·羊肉锅",
                "priceText": "¥18",
                "cuisines": ["hotpot"],
                "spicyLevel": 0,
                "tags": ["必吃"],
                "reviewLabel": "好评",
                "reviewText": "把你在食堂的真实体验写在这里。",
                "image": "assets/uploads/example.jpg",
            },
        },
        {
            "id": "20260920-example-stall",
            "kind": "stall",
            "createdAt": "2026-09-20T11:00:00.000Z",
            "author": "匿名同学",
            "payload": {
                "canteenId": "lan_yuan",
                "floor": "1F",
                "name": "自选窗口",
                "windowType": "自选",
                "note": "每天中午 11:00 出菜，菜色天天不同。",
                "image": "assets/uploads/example-window.jpg",
            },
        },
        {
            "id": "20260920-example-daily",
            "kind": "dish",
            "createdAt": "2026-09-20T11:05:00.000Z",
            "author": "匿名同学",
            "payload": {
                "_comment": "带 date 的菜 = 自选菜，只在该日期参与抽签与展示；同窗口同一天同名会自动去重。",
                "canteenId": "lan_yuan",
                "floor": "1F",
                "stallName": "自选窗口",
                "name": "示例·红烧肉",
                "priceText": "¥12",
                "cuisines": ["homestyle"],
                "spicyLevel": 0,
                "tags": [],
                "reviewLabel": "好评",
                "reviewText": None,
                "image": "assets/uploads/example-dish.jpg",
                "date": "2026-09-20",
            },
        },
    ],
}


def emit_web_bundle(data: dict) -> list[Path]:
    """Write the GitHub Pages data bundle into docs/assets/data/.

    The site is a pure static frontend: it fetches these JSON files and merges
    them with online contributions (docs/assets/data/contributions/*.json).
    """
    web_dir = ROOT / "docs" / "assets" / "data"
    contrib_dir = web_dir / "contributions"
    contrib_dir.mkdir(parents=True, exist_ok=True)

    write_json(web_dir / "menu.json", data)
    write_json(web_dir / "canteens.json", data["canteens"])
    write_json(web_dir / "cuisines.json", data["cuisines"])
    write_json(web_dir / "manifest.json", {
        "version": data["meta"]["version"],
        "generatedAt": data["meta"]["generatedAt"],
        "stats": data["meta"]["stats"],
        "files": {
            "menu": "assets/data/menu.json",
            "canteens": "assets/data/canteens.json",
            "cuisines": "assets/data/cuisines.json",
            "contributions": "assets/data/contributions/index.json",
        },
    })

    index_path = contrib_dir / "index.json"
    if not index_path.exists():
        write_json(index_path, {"generatedAt": None, "files": []})
    example_path = contrib_dir / "_example.json"
    write_json(example_path, CONTRIBUTION_EXAMPLES)

    return [web_dir / "menu.json", web_dir / "canteens.json", web_dir / "cuisines.json",
            web_dir / "manifest.json", index_path, example_path]


def main() -> None:
    data = build()

    write_json(SOURCE_DIR / "menu_data.json", data)
    write_json(SOURCE_DIR / "dishes.json", data["dishes"])
    write_json(SOURCE_DIR / "canteens.json", data["canteens"])
    write_json(SOURCE_DIR / "cuisines.json", data["cuisines"])
    write_json(SOURCE_DIR / "schema.json", build_schema())

    js = (
        "// 由 tools/build_menu_data.py 生成，请勿手改。\n"
        "// 微信小程序可直接 require 本文件；数据结构见 source_pic/README.md。\n"
        "module.exports = "
        + json.dumps(data, ensure_ascii=False, indent=2)
        + "\n"
    )
    (SOURCE_DIR / "menu_data.js").write_text(js, encoding="utf-8")
    (SOURCE_DIR / "README.md").write_text(render_readme(data), encoding="utf-8")

    web_files = emit_web_bundle(data)

    stats = data["meta"]["stats"]
    print("generated:")
    for name in ("menu_data.json", "dishes.json", "canteens.json", "cuisines.json",
                 "menu_data.js", "schema.json", "README.md"):
        path = SOURCE_DIR / name
        print(f"  source_pic/{name:18} {path.stat().st_size:>8,} bytes")
    for path in web_files:
        rel = path.relative_to(ROOT)
        print(f"  {str(rel):42} {path.stat().st_size:>8,} bytes")
    print("stats:", json.dumps(stats, ensure_ascii=False))


if __name__ == "__main__":
    main()
