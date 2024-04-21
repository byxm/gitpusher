import { execSync } from "child_process";
import { readInput } from "./util.mjs";
import chalk from "chalk";

class GitError extends Error {
  constructor(type, message) {
    super(message);
    this.type = type;
    this.name = "GitError";
  }

  // 通用错误处理逻辑
  async handleGitError(errorType, errorMessage, branch) {
    console.error(chalk.red(`${errorType}错误:`), errorMessage);
    
    const answer = await readInput(chalk.yellow("是否重试? (y/n)"));
    if (answer.toLowerCase() === "y") {
      return true; // 重试  
    } else {
      console.error(chalk.red("已终止操作,请手动处理错误"));
      process.exit(1); 
    }
  }

  async handle(branch) {
    switch (this.type) {
      case "MergeConflict":
        await this.handleMergeConflict(branch);
        break;
      case "PushFast":
        await this.handlePushFast(branch);
        break;
      case "PullDivergent":
        await this.handlePullDivergent(branch);
        break;
      case "CherryPickConflict":
        await this.handleCherryPickConflict(branch);
        break;
      default:
        throw new Error("未知的错误类型: " + this.type);
    }
  }

  async handleMergeConflict(branch) {
    console.error(chalk.red("合并冲突错误:"), this.message);
    console.log(
      chalk.yellow(
        "请手动解决合并冲突,然后输入 continue 继续;想要终止合并操作请输入 abort"
      )
    );

    let isContinue = false;
    while (!isContinue) {
      const input = await readInput(chalk.cyan("gitpush> "));
      if (input === "continue") {
        isContinue = true;
        await mergeBranch(branch);
        console.log(chalk.green(`合并${branch}成功`));
      } else if (input === "abort") {
        console.log(chalk.yellow("退出合并,请手动处理冲突"));
        process.exit(1);
      } else {
        console.log(chalk.red("无效的命令,请输入 gitpush continue 继续"));
      }
    }
  }

  async handlePushFast(branch) {
    console.error(chalk.red("非快进错误:"), this.message);
    console.log(chalk.yellow("尝试使用 git push --force 强制推送"));

    try {
      execSync(`git push --force origin ${branch}`);
      console.log(chalk.green("强制推送成功"));
    } catch (error) {
      console.error(chalk.red("强制推送失败:"), error.message);
      const retry = await readInput(chalk.cyan("是否重试? (y/n)"));
      if (retry.toLowerCase() === "y") {
        this.handlePushFast(branch); // 重试
      } else {
        throw error; // 不重试,抛出错误
      }
    }
  }

  async handlePullDivergent(branch) {
    console.error(chalk.red("拉取分支发生分歧错误:"), this.message);
    console.log(chalk.yellow("尝试使用 git pull --rebase 拉取并变基合并"));

    try {
      execSync(`git pull --rebase origin ${branch}`);
      console.log(chalk.green("拉取并变基合并成功"));
    } catch (error) {
      console.error(chalk.red("拉取并变基合并失败:"), error.message);
      throw error;
    }
  }

  async handleCherryPickConflict(branch) {
    console.error(chalk.red("Cherry-pick 发生代码冲突:"), this.message);
    console.log(
      chalk.yellow(
        "请手动解决代码冲突,然后输入 continue 继续。如需终止操作,请输入 abort"
      )
    );

    let isContinue = false;
    while (!isContinue) {
      const answer = await readInput(chalk.cyan("gitpush> "));
      if (answer.toLowerCase() === "continue") {
        console.log(chalk.green("冲突解决,继续执行 cherry-pick 操作"));
        isContinue = true;
        process.env.GIT_EDITOR = "true"; // rebase合并关闭编辑器
        execSync("git add .");
        execSync("git cherry-pick --continue");
        process.env.GIT_EDITOR = "false"; // 冲突解决后把环境变量修改回来，不能影响用户默认git使用
      } else if (answer.toLowerCase() === "abort") {
        execSync("git cherry-pick --abort");
        console.log(chalk.yellow("已终止 cherry-pick 操作,请手动解决代码冲突"));
        process.exit(1);
      } else {
        console.log(chalk.red("无效的输入,请重新输入!"));
      }
    }
  }
}

export default GitError;
