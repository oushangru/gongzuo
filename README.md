# 求职进度管理系统（Job Tracker）

个人求职进度管理工具：记录每一次简历投递，跟踪 **投递 → 面试 → Offer** 全流程，并通过可视化看板直观看到目前的求职进展。

## 功能

- **投递记录**：新增 / 编辑 / 删除投递，必填项为 **公司名称、岗位名称、投递时间**，可附加备注
- **状态流转**（每次流转自动记录时间，也可手动指定）：
  - 已投递 → 进入面试（记录面试时间）
  - 面试中 → 拿到 Offer（记录 Offer 时间）
  - 已投递 / 面试中 → 未通过/已结束（记录结束时间与原因）
- **数据看板**：
  - 统计卡片：累计投递 / 进入面试 / 获得 Offer / 未通过
  - 投递漏斗图：投递 → 面试 → Offer 各环节数量
  - 月度趋势图：每月投递、面试、Offer 数量变化
  - 转化率：面试率、Offer 率、面试通过率
  - 最新投递列表
- **检索筛选**：按公司 / 岗位关键词搜索，按状态筛选
- **本地存储**：数据保存在本地 SQLite 数据库文件中，完全离线可用

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js + Express |
| 数据库 | SQLite（Node 内置 `node:sqlite`，无需额外安装） |
| 前端 | 原生 HTML / CSS / JavaScript + ECharts（本地引入，离线可用） |
| 测试 | Node 内置 `node:test`，零额外测试依赖 |

要求：**Node.js v22.5 或更高版本**（已在你的电脑上安装 v22.23.2）。

## 快速开始（一键启动）

**双击 `start.bat` 即可**。脚本会自动完成：

1. 检查 Node.js 环境
2. 首次运行自动安装依赖（`npm install`）
3. 启动服务并自动打开浏览器 `http://localhost:3000`
4. 停止服务：关闭命令行窗口或按 `Ctrl+C`

也可以手动启动：

```bash
npm start        # 启动
npm run dev      # 开发模式（文件变更自动重启）
npm test         # 运行全部自动化测试
```

## 项目结构

```
job-tracker/
├── server.js            # 服务入口（启动 + 自动打开浏览器）
├── package.json
├── start.bat            # 一键启动脚本
├── src/
│   ├── app.js           # Express 路由（REST API）
│   └── db.js            # SQLite 数据库层（建表 / 增删改查 / 统计）
├── public/              # 前端页面（静态资源）
│   ├── index.html       # 单页应用
│   ├── css/style.css
│   └── js/app.js        # 看板渲染 + 记录管理逻辑
├── test/
│   └── api.test.js      # 18 个 API 集成测试
└── data/                # 数据库文件（自动生成，已被 git 忽略）
```

## REST API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/stats` | 看板统计（总数 / 漏斗 / 转化率 / 月度趋势 / 最新记录） |
| GET | `/api/applications?status=&search=` | 投递记录列表（可按状态筛选、关键词搜索） |
| GET | `/api/applications/:id` | 单条记录详情 |
| POST | `/api/applications` | 新增投递（`company`、`position`、`apply_date` 必填） |
| PUT | `/api/applications/:id` | 修改记录（基本信息 + 阶段时间） |
| PATCH | `/api/applications/:id/status` | 状态流转（`status` + 可选 `date` / `reason`） |
| DELETE | `/api/applications/:id` | 删除记录 |

**状态取值**：`applied`（已投递）/ `interviewed`（面试中）/ `offered`（已拿到 Offer）/ `rejected`（未通过/已结束）

## 数据与隐私

- 所有数据保存在本地 `data/job-applications.db`（SQLite 文件），不会上传任何外部服务器
- 备份数据：直接复制该 `.db` 文件即可
- 代码仓库已配置 `.gitignore`，数据库文件与 `node_modules` 不会被推送到 GitHub

## 端口占用

默认端口 `3000`。如被占用，可换端口启动：

```powershell
# PowerShell
$env:PORT=3001; npm start

# cmd
set PORT=3001 && npm start
```
