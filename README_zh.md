# EvalForge

**面向视频生成模型的结构化人工评测平台。**

EvalForge 提供完整的视频评测工作流：多维度评分（D1–D6）、多角色权限控制、实时反作弊检测和数据分析看板，为研究团队组织结构化评测活动而设计。

## 核心功能

- **评测工作台** — 视频播放器 + 快捷键（1–5 评分、空格播放/暂停）、维度标签页、失败标签选择、自动跳转下一题
- **多维度评分** — 6 个评测维度（视觉质量、运动合理性、时间一致性、主体一致性、文本对齐、美学质量），支持锚点和测试点配置
- **反作弊系统** — 观看比例追踪、停留时间校验、固定分值检测、高频提交检测，按严重程度记录事件日志
- **角色权限控制** — 6 种角色（管理员、研究员、评测员、外包评测员、审核员、观察者），基于 CASL 的属性级权限控制（ABAC）
- **数据分析看板** — 模型排名柱状图、维度雷达图、各维度得分对比图（Recharts）
- **样本管理** — 视频资产清单，支持按评测项查看评测进度

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router) |
| 语言 | TypeScript, React 19 |
| UI | Tailwind CSS 4, shadcn/ui (base-nova) |
| 数据库 | PostgreSQL (Neon) |
| ORM | Prisma 7 + `@prisma/adapter-pg` |
| 认证 | JWT (jose) + bcryptjs, HTTP-only Cookie |
| 权限 | CASL (ABAC) |
| 图表 | Recharts |

## 快速开始

### 前置条件

- Node.js 20+
- PostgreSQL 数据库（推荐 [Neon](https://neon.tech) 免费版）

### 安装

```bash
git clone https://github.com/zzzhhn/evalforge-dashboard.git
cd evalforge-dashboard

npm install

cp .env.example .env
# 编辑 .env，填入 DATABASE_URL 和 JWT_SECRET

npx prisma generate
npx prisma migrate dev --name init
npm run db:seed

npm run dev
```

### 演示账号

| 角色 | 邮箱 | 密码 |
|------|------|------|
| 管理员 | admin@evalforge.dev | admin123 |
| 评测员 | alice@evalforge.dev | eval123 |

## 部署

使用 [Vercel](https://vercel.com) + Neon PostgreSQL 部署。

```bash
npm run build
vercel --prod
```

## 许可证

MIT
