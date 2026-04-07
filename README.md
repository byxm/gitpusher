# git-sync-commit

`git-sync-commit` 是一个面向 GitLab 工作流的命令行工具，用来简化日常的提交、合并、批量 cherry-pick 和 Merge Request 创建流程。

它适合有明确分支命名规范的团队使用，尤其是需要在 `hotfix`、`release`、`test`、`dev` 之间做固定方向同步的场景。

## 安装

```bash
npm install -g git-sync-commit
```

本地调试可以直接在项目目录执行：

```bash
npm link
```

安装完成后使用：

```bash
gs start
```

自动模式：

```bash
gs start --auto
gs start -a
```

## 使用前提

- 业务仓库使用 GitLab，并支持 `git push -o merge_request.create`
- 本地仓库已经配置好 `origin`
- 本地已经具备推送权限
- 当前工作区已经在目标业务仓库内，而不是在本工具仓库内执行

## 分支命名规范

工具当前依赖以下命名规范自动推导首个 MR 目标分支和后续 cherry-pick 目标分支。

### `test` 系列

- 主分支：`test`
- bugfix 分支：`test_bugfix/<name>`

示例：

```bash
test_bugfix/cpy-test
```

识别规则：

- 如果当前分支是 `test`
- 或者当前分支以 `test_bugfix/` 开头

则工具会认为首个 MR 目标分支是 `test`。

### `dev` 系列

- 主分支：`dev`
- bugfix 分支：`dev_bugfix/<name>`
- feature 分支：`dev_feature/<name>`

示例：

```bash
dev_bugfix/cpy-dev
dev_feature/login-page
```

识别规则：

- 如果当前分支是 `dev`
- 或者当前分支以 `dev_bugfix/` 开头
- 或者当前分支以 `dev_feature/` 开头

则工具会认为首个 MR 目标分支是 `dev`。

### 其它普通分支

除了以下分支会被优先识别：

- `hotfix/*`
- `release/*`
- `dev`
- `dev_bugfix/*`
- `dev_feature/*`

其余所有分支都会默认按 `test` 处理。

例如：

```bash
feature/login
bugfix/header-style
cpy-test-0421
```

以上这类分支，首个 MR 目标分支都会默认推断为：

```bash
test
```

### `hotfix` 系列

- 主分支格式：`hotfix/<version>-hotfix_<yyyymmdd>`
- 个人工作分支格式：以主分支前缀开头，后面可以追加任意信息

示例：

```bash
hotfix/5.3-hotfix_20250730
hotfix/5.3-hotfix_20250730-chenpy
hotfix/5.3-hotfix_20250730_xxx
hotfix/5.3-hotfix_20250730-anything
```

识别规则：

- 工具只认 `hotfix/<version>-hotfix_<yyyymmdd>` 这一段为主分支前缀
- 当前分支只要命中这个前缀，不要求结尾一定是 `-用户名`
- 也就是说，`-xxx`、`_xxx`、混合后缀都能识别回同一个主分支

例如：

```bash
hotfix/5.3-hotfix_20250730-chenpy
```

会被识别为主分支：

```bash
hotfix/5.3-hotfix_20250730
```

### `release` 系列

- 主分支格式：`release/<version>-release_<yyyymmdd>`
- 个人工作分支格式：以主分支前缀开头，后面可以追加任意信息

示例：

```bash
release/5.30-release_20260330
release/5.30-release_20260330-chenpy
release/5.30-release_20260330_xxx
```

识别规则与 `hotfix` 相同：

- 只认 `release/<version>-release_<yyyymmdd>` 这一段
- 后缀可以为空，也可以是任意额外标识

## 自动分支推导规则

### 从 `test` 系列分支发起

如果当前分支是：

- `test`
- `test_bugfix/*`
- 其它所有非 `hotfix/release/dev` 系列的普通分支

则：

- 首个 MR 目标分支：`test`
- 后续 cherry-pick 目标分支：仓库内版本最新的 `release/*` 主分支

### 从 `dev` 系列分支发起

如果当前分支是：

- `dev`
- `dev_bugfix/*`
- `dev_feature/*`

则：

- 首个 MR 目标分支：`dev`
- 不自动追加 cherry-pick 目标分支

### 从 `hotfix` 系列分支发起

如果当前分支命中：

```bash
hotfix/<version>-hotfix_<yyyymmdd>
```

则：

- 首个 MR 目标分支：对应的 `hotfix` 主分支
- 后续 cherry-pick 目标分支：所有版本号更高的 `hotfix` 主分支，再额外加上 `test`

例如当前分支是：

```bash
hotfix/5.3-hotfix_20250730-chenpy
```

且仓库里存在：

```bash
hotfix/5.5-hotfix_20250815
hotfix/5.6-hotfix_20250830
test
```

则会自动推导出：

- 首个 MR 目标：`hotfix/5.3-hotfix_20250730`
- 后续 cherry-pick 目标：
  - `hotfix/5.5-hotfix_20250815`
  - `hotfix/5.6-hotfix_20250830`
  - `test`

### 从 `release` 系列分支发起

如果当前分支命中：

```bash
release/<version>-release_<yyyymmdd>
```

则：

- 首个 MR 目标分支：对应的 `release` 主分支
- 后续 cherry-pick 目标分支：`test`

## 版本比较规则

版本号按数字段比较，不按字符串比较。

例如：

- `5.30 > 5.8`
- `5.10 > 5.9`
- `5.5 > 5.3`

## 执行流程

执行 `gs start` 后，工具会依次完成：

1. 输入 commit message
2. 自动识别首个 MR 目标分支和后续 cherry-pick 目标分支
3. 默认展示自动结果，并允许你手动增删分支
4. 将目标主分支代码合并到当前工作分支
5. 生成 commit 并推送
6. 通过 `git push` 的 GitLab push options 创建 MR
7. 按规则为后续目标分支执行 cherry-pick，并创建对应 MR
8. 打印并复制 MR 链接
9. 打开所有已解析到的 MR 页面
10. 等待你确认这些 MR 已合并，再删除临时分支

如果传了 `--auto` 或 `-a`：

- 会跳过第 3 步的人工确认
- 直接采用自动推断结果继续执行
- 但最后“MR 已合并后删除临时分支”的确认仍然保留

## 最终确认与手动调整

自动识别出目标分支后，工具会展示：

- 首个 MR 目标分支
- 后续 cherry-pick 目标分支列表

你可以：

- 修改首个 MR 目标分支
- 删除某些自动识别出来的 cherry-pick 分支
- 手动追加新的 cherry-pick 分支

这一步确认完成后，工具才会真正开始合并、推送和创建 MR。

## Merge Request 创建方式

当前版本不再调用 GitLab API，而是直接在推送时使用 GitLab push options 创建 MR。

等价行为类似于：

```bash
git push -u origin <source-branch> \
  -o merge_request.create \
  -o merge_request.target=<target-branch> \
  -o merge_request.title="<commit-message>"
```

这样不再需要：

- 手动维护 `projectId`
- 手动输入 `accessToken`
- 本地缓存 GitLab token

如果 GitLab 返回的 push 输出中没有带出 MR URL，工具会提示你手动确认 MR 是否已经成功创建。

## 临时分支策略

后续 cherry-pick 不会直接在目标主分支上操作，而是先从目标主分支检出临时分支。

命名规则：

```bash
<target-branch>-<commitId>
```

例如：

```bash
hotfix/5.5-hotfix_20250815-abc1234
```

这类临时分支会被用于：

- 承载 cherry-pick 结果
- 作为 Merge Request 的 source branch

如果首个 MR 出现 `source branch` 与 `target branch` 相同的问题，工具也会自动创建一个临时源分支来发起 MR。

## 临时分支删除规则

工具不会在 MR 创建完成后立刻删除临时分支。

原因是：

- GitLab 中 MR 还没合并时，如果远程 source branch 被删掉，MR 可能会被自动关闭

当前行为改为：

1. 所有 MR 创建完成后，先展示待删除的临时分支列表
2. 等你先到 GitLab 上完成合并
3. 回到终端输入：

```bash
continue
```

工具才会开始删除：

- 远程临时分支
- 本地临时分支

如果你暂时不想删，可以输入：

```bash
skip
```

这时工具会保留所有临时分支，并提示你后续手动清理。

## 常见场景

### 场景 1：从 `test_bugfix` 提交

当前分支：

```bash
test_bugfix/login-fix
```

自动结果：

- 首个 MR：`test`
- 后续 cherry-pick：最新的 `release/*`

### 场景 2：从 `hotfix` 个人分支提交

当前分支：

```bash
hotfix/5.3-hotfix_20250730-chenpy
```

自动结果：

- 首个 MR：`hotfix/5.3-hotfix_20250730`
- 后续 cherry-pick：更高版本 `hotfix/*` + `test`

### 场景 3：从 `release` 个人分支提交

当前分支：

```bash
release/5.30-release_20260330_xxx
```

自动结果：

- 首个 MR：`release/5.30-release_20260330`
- 后续 cherry-pick：`test`

### 场景 4：从 `dev_bugfix` 提交

当前分支：

```bash
dev_bugfix/cpy-dev
```

自动结果：

- 首个 MR：`dev`
- 不自动追加其他目标分支

## 注意事项

- 当前工具假设业务仓库运行在 GitLab 上
- 工具只会自动识别符合规范的主分支
- 分支池会同时扫描本地分支和 `origin/*` 远程分支
- 如果自动识别结果不符合预期，请在确认环节手动调整
- 如果某个 MR URL 没有被成功解析，不代表 MR 一定失败，需要去 GitLab 页面确认

## 开发

安装依赖：

```bash
npm install
```

本地 link：

```bash
npm link
```

基础检查：

```bash
node --check index.mjs
node --check util.mjs
node --check error.mjs
```
