# git-sync-commit

**git-sync-commit** 是一个基于 Node.js 开发的命令行工具，旨在简化日常的 Git 提交、合并和推送操作。

## 安装

```bash
npm install -g git-sync-commit

```

## 使用

启动 git-sync-commit:

```bash
gs start

```

该命令会引导你完成以下操作:

- 生成提交 (commit): 输入提交信息以生成新的 Git 提交。
- 选择合并分支: 从本地分支列表中选择一个分支，将其合并到当前分支。如果合并过程中发生冲突，工具会提示你手动解决冲突。
- 推送当前分支: 在合并完成后，工具会自动将当前分支推送到远程仓库。
- 同步提交到其他分支 (可选): 你可以选择将当前提交同步到其他本地分支。在同步过程中，工具会自动切换到目标分支、拉取最新代码，并提供选项来合并其他分支的代码。然后，工具会使用 git cherry-pick 命令将当前提交应用到目标分支，并自动推送到远程仓库。