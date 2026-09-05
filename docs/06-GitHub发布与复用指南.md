# 06 · GitHub 仓库搭建与发布复用指南

> 本篇从「英语小超人」项目实践中沉淀，**既可作本项目维护手册，也可作为其他项目上线 GitHub 的通用模板**。
> 核心原则：仓库只存源码 + 文档 + 数据；构建产物与机器相关文件一律走 Release 附件或本地目录，绝不入 git。

---

## 一、本文档定位

| 维度 | 说明 |
| --- | --- |
| 适用范围 | 任何「想把自己写的程序/网页/脚本开源或备份到 GitHub」的个人项目 |
| 前置条件 | 本机已装 `git`；有一个 GitHub 账号 |
| 不依赖 | 不要求装 `gh` CLI（本文用 GitHub REST API + `curl`/`python` 完成，无 `gh` 也能做） |
| 本文示例 | 仓库根 = `EnglishKidsApp/`；目标仓库 = `simpleplanfx/EnglishKids`（公开）|

阅读建议：第一节看「项目长什么样」，第二节起是**通用流程**，可直接套到别的项目。

---

## 二、项目核心内容总结（以英语小超人为例）

> 这一节是「示例项目」的快照，套用到其他项目时替换为自己的内容即可。

### 2.1 它是什么

给孩子做的**离线英语单词学习 App**（安卓），覆盖「听 → 跟读 → 默写」三个环节。词库 13 册 / 1337 词，对应上海沪教版三年级上册及牛津上海版 1–6 年级。

### 2.2 技术架构（混合结构）

```
Android 原生层 (Java)               网页层 (HTML/CSS/JS，离线打包进 APK)
MainActivity.java                   index.html
 ├─ WebView 容器                      ├─ js/app.js      界面与学习流程
 ├─ TextToSpeech  → AndroidTTS 桥    ├─ js/speech.js   发音/录音/评分
 └─ SpeechRecognizer → AndroidASR 桥  ├─ js/store.js    进度存储
                                   └─ data/words.json  词库
```

**取舍**：UI 用网页迭代快（改网页不用重编 APK）；发音/语音识别等必须走原生能力，用 JS 桥接暴露给网页。第三方依赖为 **0**（纯系统 WebView）。

### 2.3 工程化资产（本项目的「软件之外」交付物）

| 资产 | 作用 |
| --- | --- |
| `scripts/build_apk.ps1` + `run_build.bat` | 一键本机构建（自动下载 JDK17 + Android SDK，幂等可重跑）|
| `docs/01~05` 五篇文档 | 背景 / 功能 / 开发过程 / 构建打包 / 维护升级 |
| `.gitignore` / `.gitattributes` | 排除机密与二进制、统一换行符 |
| `source-data/` 原始词表 docx | 词库来源可追溯 |

### 2.4 当前版本状态

- 版本：**v1.0.0**（`versionCode 1` / `versionName 1.0`）
- 产物：`app-debug.apk` 约 282 KB，已作为 GitHub Release 附件发布
- 提交作者：`simpleplanfx <fangxuvip@163.com>`

---

## 三、上传 GitHub 的方案选型

### 3.1 三种方案对比

| 方案 | 优点 | 缺点 | 何时用 |
| --- | --- | --- | --- |
| **A. GitHub API（curl/python）+ PAT** | 无需装 `gh`；可脚本化；适合本机没 `gh` 的环境 | 需自己拼 JSON、处理鉴权 | ✅ 本项目采用 |
| B. `gh` CLI | 命令最简；自动处理鉴权 | 需先安装并 `gh auth login`（交互式）| 环境允许时首选 |
| C. 网页手动 | 零命令；最直观 | 无法批量、易漏文件、不可复用 | 一次性小项目 |

### 3.2 本项目的决策

- **仓库根目录 = `EnglishKidsApp/`**（标准 Android 工程根），**不是**外层工作目录。
  - 原因：外层目录含 `jdk17/`、`android-sdk/`（数 GB）、`app-debug.apk`，这些必须在仓库外。
  - `.gitignore` 已据此编写（`local.properties`、`*.apk`、`jdk17/`、`android-sdk/` 全部排除）。
- **公开仓库**：教育类、无密钥、纯前端+WebView，公开便于分享。
- **APK 走 Release 附件**，不进 git 历史（`.gitignore` 已忽略 `*.apk`）。

---

## 四、完整流程（Step by Step）

> 以下命令以 Git Bash / PowerShell 均可；涉及令牌时**一律用变量传递，不写死、不 echo、不存文件**。

### 步骤 0：本地仓库初始化（无需联网）

```bash
cd <你的工程根>            # 例如 EnglishKidsApp/
git init -b main
git config user.name  "你的GitHub用户名"
git config user.email "你的GitHub邮箱"   # 建议用登录邮箱，便于贡献归到自己账号
```

### 步骤 1：检查 .gitignore（**最易踩坑，先做**）

```bash
# 模拟 add，确认没有把机密/大文件 staged 进去
git add -A --dry-run | grep -iE "jdk|sdk|\.apk|\.zip|local\.properties|\.gradle/|build/|\.keystore|\.jks"
# 若上面有输出 → 说明 .gitignore 没拦住，先修 .gitignore 再继续
```

⚠️ **致命坑：Git 的 `.gitignore` 不支持行内注释**。只有整行以 `#` 开头的才是注释。
像下面这样写会**整条规则失效**（被当成字面量 `".gradle/ # 说明"`）：

```gitignore
.gradle/   # ❌ 错误：行内注释，规则失效，会误提交数 GB 缓存
```

正确写法（注释独占一行）：

```gitignore
# Gradle 本地缓存（可再生，体积大）
.gradle/
local.properties
*.apk
jdk17/
android-sdk/
```

### 步骤 2：统一换行符（可选但强烈建议，跨平台协作必备）

```gitattributes
* text=auto
*.bat text eol=crlf
*.ps1 text eol=lf
*.png binary
*.docx binary
```

加完执行一次重归一化再提交：

```bash
git add .gitattributes && git add --renormalize . && git commit --amend --no-edit
```

### 步骤 3：提交 + 打版本 tag

```bash
git add -A
git commit -m "chore: 初始化仓库与首个可用版本 v1.0.0（项目名）"
git tag -a v1.0.0 -m "v1.0.0 — 首个可用版本说明"
```

> tag 命名建议语义化：`v主.次.修订`。**版本回退**靠它：`git checkout v1.0.0`。

### 步骤 4：获取 GitHub 凭证（PAT）

新版 GitHub 设置页把 **Developer settings 从左侧栏移除了**，直接用 URL 跳过去最稳：

| 用途 | 直链 |
| --- | --- |
| 生成经典 PAT | `https://github.com/settings/tokens/new` |
| 列出 token | `https://github.com/settings/tokens` |
| 细粒度 token | `https://github.com/settings/personal-access-tokens/new` |

生成时：
1. **Note** 填用途（如 `EnglishKids-push-2026-09`）
2. **Expiration** 选 30 天（或 7 天，最安全）
3. **Scope** 只勾 **`repo`**（Full control of private repositories）
4. 生成后**立刻复制** `ghp_xxx...`（只显示一次）

> 若跳进去提示要开启 2FA，按提示开启即可——这是 GitHub 强制策略，不是权限问题。

### 步骤 5：用 API 建仓库

```bash
TOKEN="ghp_你的令牌"
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  -d '{"name":"EnglishKids","description":"一句话简介","private":false,"auto_init":false,"has_issues":true,"has_wiki":false}' \
  https://api.github.com/user/repos
```

> `auto_init:false` 很关键——避免 GitHub 自动建 README 与你本地已存在的冲突。

### 步骤 6：修正提交作者（如之前用了临时身份）

```bash
git commit --amend --author="你的用户名 <你的邮箱>" --no-edit
git tag -d v1.0.0 && git tag -a v1.0.0 -m "v1.0.0 — 说明"   # ⚠️ amend 改了 commit hash，tag 必须重建
```

### 步骤 7：推送分支 + tag

```bash
git remote add origin "https://${TOKEN}@github.com/你的用户名/EnglishKids.git"
git push -u origin main
git push origin v1.0.0
```

### 步骤 8：建 Release + 上传二进制（APK/zip 等）

用 Python（自带 urllib，无需装库）最稳：

```python
import os, json, urllib.request
TOKEN = os.environ["TOKEN"]; OWNER, REPO = "你的用户名", "EnglishKids"
API = "https://api.github.com"
hdr = {"Authorization":"Bearer "+TOKEN,"Accept":"application/vnd.github+json",
       "Content-Type":"application/json","X-GitHub-Api-Version":"2022-11-28"}
rel = json.loads(urllib.request.urlopen(urllib.request.Request(
    f"{API}/repos/{OWNER}/{REPO}/releases",
    data=json.dumps({"tag_name":"v1.0.0","name":"v1.0.0","body":"发布说明","draft":False,"prerelease":False}).encode(),
    headers=hdr, method="POST")).read())
up = rel["upload_url"].split("{")[0] + "?name=app-debug.apk"
uh = {"Authorization":"Bearer "+TOKEN,"Content-Type":"application/vnd.android.package-archive","Accept":"application/vnd.github+json"}
data = open(r"本地路径\app-debug.apk","rb").read()
print(json.loads(urllib.request.urlopen(urllib.request.Request(up, data=data, headers=uh, method="POST")).read()).get("browser_download_url"))
```

### 步骤 9：安全收尾（**必做**）

```bash
git remote set-url origin "https://github.com/你的用户名/EnglishKids.git"   # 剥离令牌
git remote -v        # 确认输出里没有 ghp_...
```

---

## 五、注意事项与坑清单

| # | 坑 | 现象 | 解法 |
| --- | --- | --- | --- |
| 1 | **.gitignore 行内注释** | 规则全部失效，误提交缓存/密钥 | 注释独占一行（见步骤 1）|
| 2 | 含绝对路径文件入库 | `local.properties` 含 `D:\...`，换机器编译失败 | 必须忽略 `local.properties` |
| 3 | 大文件/二进制入 git | 仓库膨胀、clone 慢、冲突多 | `*.apk`/`*.zip`/`jdk17/` 忽略；产物走 Release |
| 4 | **PAT 安全** | 令牌泄露 = 账号失守 | 用完即 Revoke；不写文件/记忆；remote 用完即剥离 |
| 5 | amend 后 tag 悬空 | 旧 tag 指向已不存在的旧 commit | amend 后 `git tag -d` + 重建（步骤 6）|
| 6 | 换行符 CRLF 噪声 | Windows/macOS 互相把文件整篇改写 | 加 `.gitattributes`（步骤 2）|
| 7 | 仓库根选错 | 把工作目录（含 JDK/SDK）当仓库 | 仓库根 = 纯工程目录，工具链放外层（步骤 3.2）|
| 8 | `auto_init:true` | GitHub 自动 README 与本地冲突 | 建仓时 `auto_init:false`（步骤 5）|

---

## 六、可复用技巧要点（速查）

### 6.1 一条命令验证 .gitignore 是否漏网

```bash
git add -A --dry-run | grep -iE "jdk|sdk|\.apk|\.zip|local\.properties|\.gradle/|build/|\.keystore|\.jks" \
  && echo ">>> 有泄漏，先修 .gitignore" || echo "[OK] 无敏感/二进制泄漏"
```

### 6.2 验证某路径是否被正确忽略

```bash
git check-ignore -v local.properties        # 有输出=被忽略；无输出=会泄露
```

### 6.3 建仓 / 发版 API 模板（替换占位符即可）

- 建仓：`POST /user/repos`  （body 见步骤 5）
- 发版：`POST /repos/{owner}/{repo}/releases`
- 上传附件：`POST {release.upload_url}?name=文件名`

### 6.4 版本回退（任何时候）

```bash
git checkout v1.0.0          # 切到某版本
git checkout main            # 回到最新
```

### 6.5 PAT 生成最短路径

网址直输 `https://github.com/settings/tokens/new` → 勾 `repo` → Generate → 复制。

---

## 七、其他项目直接套用清单

把本文档套到新项目时，按顺序核对：

- [ ] **定仓库根**：纯工程目录，不含 JDK/SDK/编译缓存/产物
- [ ] **写 .gitignore**：注释独占一行；排除 `local.properties`、`*.apk`、`*.zip`、构建缓存、密钥
- [ ] **加 .gitattributes**：`* text=auto` 统一换行符
- [ ] **初始提交 + tag**：`git init -b main` → commit → `git tag -a v1.0.0`
- [ ] **生成 PAT**：直链 `settings/tokens/new`，只勾 `repo`
- [ ] **API 建仓**：`auto_init:false`
- [ ] **修正作者 + 重建 tag**（若需）
- [ ] **推送**：`main` + `v1.0.0`
- [ ] **发 Release + 传二进制**（APK/zip 等）
- [ ] **剥离 remote 令牌** + 去 GitHub **Revoke** PAT

---

## 八、本项目实际落地的产物（供核对）

| 项 | 值 |
| --- | --- |
| 仓库地址 | https://github.com/simpleplanfx/EnglishKids |
| Release | https://github.com/simpleplanfx/EnglishKids/releases/tag/v1.0.0 |
| APK 下载 | https://github.com/simpleplanfx/EnglishKids/releases/download/v1.0.0/app-debug.apk |
| 提交作者 | `simpleplanfx <fangxuvip@163.com>` |
| 版本 | `v1.0.0`（main 分支 + tag 均已推远端）|

> 经验沉淀：本次踩过的最隐蔽两个坑——「.gitignore 行内注释导致规则全失效」与「PowerShell `$LASTEXITCODE` 在 try/finally 后被覆盖」——前者已在本文步骤 1 固化规避，后者详见 `docs/03-开发过程记录.md`。
