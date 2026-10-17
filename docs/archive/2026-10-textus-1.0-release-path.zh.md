# Textus 1.0.0 与 Levis 0.9.8 发布路径

本文写清 Textus 1.0.0 和 Levis 0.9.8（最后一个 Levis 版本）一起发布的完整步骤。每一步都标明由谁来做：

- **你**：需要你本人在网页、手机或 Windows 电脑上操作，或需要你拍板。
- **自动**：由 Claude Code 或 CI 完成，你只需说“发”。

做完一项勾一项。顺序不能乱：**先发 Levis 0.9.8，再改仓库名，最后发 Textus 1.0.0。** Textus 的发布流程会检查 v0.9.8 是否已经存在，不存在就拒绝发布。

## 为什么是这个顺序

- 老的 Levis 安装会去 `releases/latest/download/latest.json` 检查更新。Textus 1.0.0 成为最新版本之后，这个地址指向的是 Textus 的发布。
- Textus 的发布里放的 `latest.json` 是 **Levis 0.9.8 自己那份清单的原样复制**（版本 0.9.8，下载地址全是 v0.9.8 的 Levis 安装包）。所以：
  - 还在 0.9.7 及更早版本的用户，会照常升级到 0.9.8，并看到“Levis 已升级为 Textus”的提示；
  - 0.9.8 的用户看到的版本就是自己，不会再更新；
  - 任何 Levis 都不可能把 Textus 装到自己身上。
- Textus 自己的更新清单叫 `textus-latest.json`，签名沿用 Levis 的密钥，不需要新的 Secrets。
- 发布流程在公开之前会再检查一遍：发布里的 `latest.json` 只要不是 v0.9.8 的 Levis 清单，就失败（`scripts/updater-manifest.mjs`）。

## 一、发布前（可以提前做）

### 你

- [ ] 在 App Store Connect 新建 App：平台 iOS，名称 `Textus - Markdown Editor`，主要语言英语，套装 ID `com.catvinci.textus`，SKU 例如 `textus-ios`。如果套装 ID 在下拉框里找不到，告诉我，我用 API 注册。
- [ ] 在网页上填写新 App 的“App 隐私”（照抄 Levis 那份）。
- [x] 在 Windows 上试装 Textus 测试版和 Levis 0.9.8：重点看从 Levis 导入数据、自动更新、Levis 0.9.8 的提示。
- [ ] 定发布日期。
- [x] App 审核用的演示 API 密钥：由你在提交审核时自己填写。

### 自动

- [ ] `v1.0.0-ready`、`feat/levis-0.9.8-bridge`、`dev` 三个分支的全部检查通过（CI 和本地：`npm run check`、Rust 的 fmt/clippy/test、Playwright）。
- [ ] Linux、macOS（Mac mini）、iOS 模拟器实机测试通过，截图存档。
- [ ] 官网 `v1.0.0` 分支的预览确认无误；把官网里的 canonical、OG 和站点地址从 `levis.catvinci.com` 改成 `textus.catvinci.com`。
- [ ] Homebrew 仓库和 Arch 仓库里准备好的分支已推送，但尚未合并。

## 二、发布当天

### 1. 发布 Levis 0.9.8（自动）

- [ ] 把 `feat/levis-0.9.8-bridge` 合进 `dev`，版本号改为 0.9.8（`scripts/check-versions.mjs` 会核对所有位置），更新说明是 `docs/releases/0.9.8.md`。
- [ ] 开 `dev → main` 的 PR，CI 通过后合并。
- [ ] 推送标签 `v0.9.8`，盯完发布流程。
- [ ] 核对：Release 里有各平台安装包、签名和 `latest.json`（版本 0.9.8）；Homebrew 的 `levis` 已到 0.9.8；Arch 的 `levis-bin` 已到 0.9.8-1。
- [ ] iOS 不发 0.9.8（Levis 在 iOS 上只有 TestFlight，没有用户）。
- [ ] **存档 Levis**：从此时的 `main`（即 `v0.9.8`）建分支 `archive/levis` 并推送。之后 `main` 和 `dev` 都是 Textus，Levis 的最后代码只在这个分支和 `v0.9.8` 标签里。

### 2. 仓库改名（自动，需要你说“改”）

- [ ] 把 GitHub 仓库 `CatVinci-Studio/Levis` 改名为 `CatVinci-Studio/Textus`。GitHub 会把旧地址自动重定向到新地址，所以老 Levis 的更新检查、Homebrew 和 Arch 里旧的下载链接都继续有效。
- [ ] 本地和 Mac mini 上的 git remote 改成新地址。

### 3. 发布 Textus 1.0.0（自动）

- [ ] 把 `main`（含 0.9.8）合进 `v1.0.0-ready`，然后**删掉 0.9.8 的升级提示**（`src/settings/textus-notice.ts` 及其调用和文案）：Textus 不需要告诉自己“已升级为 Textus”。
- [ ] 写好 `docs/releases/1.0.0.md`，跑全套检查。
- [ ] 开 `v1.0.0-ready → main` 的 PR，CI 通过后合并。
- [ ] 推送标签 `v1.0.0`，盯完发布流程。发布流程会：
  - 构建 macOS、Windows、Linux 安装包，生成 `textus-latest.json`；
  - 从 v0.9.8 复制 `latest.json` 放进这个发布，并检查它确实是 Levis 0.9.8 的清单；
  - 把 Homebrew 的 `levis` cask 改名为 `textus`（`cask_renames.json`，`brew upgrade` 会把 levis 用户迁移过来）；
  - 发布 Arch 的 `textus-bin`（`replaces=levis-bin`，`pacman -Syu` 会自动替换）。
- [ ] 核对：Release 里同时有 `textus-latest.json`（1.0.0）和 `latest.json`（0.9.8）；`brew install --cask catvinci-studio/tap/textus` 能装；Arch 能从 levis-bin 升级到 textus-bin。
- [ ] **dev 跟上 main**：把 `main` 合进 `dev`（快进），之后的开发都从 Textus 继续。删掉 `v1.0.0-ready` 和 `feat/levis-0.9.8-bridge`。仓库只剩 `main`、`dev` 和存档 `archive/levis`。

### 4. iOS（自动 + 你，晚于桌面版几天单独发）

- [ ] 推送标签 `ios-v1.0.0`，构建上传到新 App 的 TestFlight（自动）。
- [ ] 用 API 填写商店信息：中英文描述、副标题、关键词、截图、分级、免费、不在中国大陆上架、欧盟非商家身份、审核说明和演示密钥（自动）。
- [ ] 在你的 iPhone 上用 TestFlight 试用（你）。
- [ ] 录一段真机使用视频，用于审核（你）。
- [ ] 提交审核（自动，等你确认后）。

### 5. 官网和域名（自动）

- [ ] 官网 `v1.0.0` 分支合进 `main`，Cloudflare Pages 自动部署正式站。
- [ ] 用 API 给 Pages 项目 `levis-homepage` 加上自定义域名 `textus.catvinci.com`（`catvinci.com` 在同一个 Cloudflare 账号下，wrangler 已登录）。
- [ ] 在官网项目里加一段 Pages 中间件，把 `levis.catvinci.com` 的所有页面 301 跳转到 `textus.catvinci.com` 的对应页面（当前登录权限不能改 DNS 和重定向规则，用中间件实现，效果相同）。
- [ ] 公司主页 catvinci.com（`CatVinci-Studio/catvinci-homepage`，Cloudflare Pages 随 main 自动部署）和组织主页（`CatVinci-Studio/.github` 的 profile/README.md）：两个仓库本地都已备好分支 `fresh`，各是一个以你的身份（ChengAo Shen <chengao_shen@ieee.org>）提交的全新提交，用它强制推送覆盖 `main`，替换原来署名 0xNullAI 的历史（本地在 `~/Documents/Enjoyment/catvinci/`）。新官网是羽毛笔同一套风格的单页：新的猫与月桂徽标、标语 Per aspera ad astra、产品卡片换成 Textus、底部写 Supported by the Anthropic Startup Program。须在仓库改名为 Textus 之后做（链接指向 Textus 仓库）。
- [ ] GitHub 组织头像换成新徽标（你在网页上传：`~/Documents/Enjoyment/catvinci/studio/brand/icons/catvinci-avatar-512.png`（134KB，GitHub 上限 1MB））。
- [ ] 核对：两个域名都能打开，旧域名跳到新域名，下载按钮指向 Textus 1.0.0 的安装包。 catvinci.com 的“产品”里显示 Textus。

### 6. 发布后检查（自动）

- [ ] 用一台装着 Levis 0.9.7 的机器（临时目录里的测试环境）检查更新：应该升级到 0.9.8，看到提示，不会装上 Textus。
- [ ] 用 Levis 0.9.8 检查更新：显示已是最新。
- [ ] 全新安装 Textus：首次启动提示从 Levis 导入（如果有 Levis 的数据），导入后 Levis 的数据原样不动。
- [ ] Textus 检查更新：读取的是 `textus-latest.json`。
- [ ] 在 issue #52 下回复：修复已随 0.9.8 和 Textus 1.0.0 发布。

## 三、出问题时

- **Textus 的发布流程在“latest.json is the last Levis release's”这一步失败**：说明发布里的 `latest.json` 不对。草稿不会公开，删掉错误的资源后重跑即可。不要手动上传任何 `latest.json`。
- **Textus 1.0.0 有严重问题**：先把 v0.9.8 重新设为 Latest（`gh release edit v0.9.8 --latest`），这样官网和老用户看到的仍然是 Levis 0.9.8，然后修复后发 1.0.1。
- **改名后有地址失效**：GitHub 的重定向只在旧名字没有被重新占用时有效，所以**不要再新建名为 Levis 的仓库**。
- **Homebrew 或 Arch 更新失败**：两个仓库的默认分支在合并前都不会动，回退只需要把那次合并撤回。
