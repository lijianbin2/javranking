# JavRanking 全榜单通用 - 字幕最小磁链脚本

## 文件
- `javranking-magnet-min.user.js`：油猴脚本 v1.1.0

## 功能
- 适配 `javranking.cc` 全站所有排行榜（神作榜 most-awarded-videos + `/rankings/` 下 DMM / JAVDB / JAVLibrary / 年度榜等）
- 在榜单页选排名区间（如 1-20），自动抓取每个作品详情页 `.magnet-item` 中【字幕磁链里容量最小】的一条
- 无字幕则回退全局最小并标注
- 抓完自动下载 TXT：`javranking_{榜单}_{开始}-{结束}_字幕最小磁链.txt`

## 安装
1. 浏览器装 Tampermonkey
2. 新建脚本，把 `javranking-magnet-min.user.js` 内容粘贴进去保存
3. 打开任意榜单页，右侧面板输入区间，点“开始抓取”

## 备注
- 站点结构：`li[data-rank]` + `[data-video-card-code/title]` + `/videos/xx/` 详情，详情页 `.magnet-tag--size` 按 B/KB/MB/GB/TB 换算比大小
- 并发默认 3、间隔 400ms，大区间建议分段抓
## 更新 v1.1.1
- 失败（未找到磁链等）不再写入 TXT，表头只显示失败数；全部失败则不下载
- 输入框（排名/并发/间隔）按回车直接开始抓取

## 更新 v1.1.2
- 抓取进行中关闭/刷新/跳转页面时，浏览器会弹出确认提醒，防止进度丢失

## 更新 v1.1.3
- 并发/间隔无需手动调：网络失败自动重试3次，遇限流间隔自动 +500ms（上限5000ms）并回写输入框

## 更新 v1.1.4
- 面板移除并发/间隔输入框，只留排名区间；后台仍用自动值（并发3/间隔400ms起，限流自适应）
