#!/usr/bin/env node
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { execSync } from "child_process";
import ora from "ora";
import chalk from "chalk";
import { readInput, getCurrentBranch, getLocalBranches } from "./util.mjs";
import GitError from "./error.mjs";



// 生成提交commit
function generateCommit(message) {
  execSync("git add .");
  execSync(`git commit -m "${message}"`);
}

// 合并指定分支到当前分支
async function mergeBranch(branch) {
  try {
    execSync(`git pull origin ${branch}`);
  } catch (error) {
    if (error.message.includes("divergent branches")) {
      console.error(chalk.red("拉取分支发生分歧错误:"), error.message);
      console.log("尝试使用 git pull --rebase 拉取并变基合并");

      try {
        execSync(`git pull --rebase origin ${branch}`);
        console.log(chalk.green("拉取并变基合并成功"));
      } catch (rebaseError) {
        if (
          rebaseError.message.includes("CONFLICT") ||
          rebaseError.message.includes("conflicts")
        ) {
          console.error("变基过程中发生冲突,请手动解决冲突后输入continue继续");
          console.log("如果需要终止变基,请输入abort");

          let isContinue = false;
          while (!isContinue) {
            const input = await readInput("gitpush> ");
            if (input === "continue") {
              isContinue = true;
              try {
                process.env.GIT_EDITOR = "true"; // rebase合并关闭编辑器
                execSync("git add .");
                execSync("git rebase --continue");
                console.log(`冲突解决,变基继续`);
                process.env.GIT_EDITOR = "false"; // 冲突解决后把环境变量修改回来，不能影响用户默认git使用
              } catch (continueError) {
                console.error(
                  "变基继续失败,请重新解决冲突:",
                  continueError.message
                );
                isContinue = false;
              }
            } else if (input === "abort") {
              execSync("git rebase --abort");
              console.log("变基已终止,请重新执行 gitpush");
              process.exit(1);
            } else {
              console.log(chalk.red("无效的命令,请输入 continue 或 abort"));
            }
          }
        } else {
          console.error(chalk.red("拉取并变基合并失败:"), rebaseError.message);
          throw rebaseError;
        }
      }
    } else {
      throw error;
    }
  }
}

async function selectBranch(branches, excludeBranch, info = '合并的') {
  const selectableBranches = branches.filter(
    (branch) => branch !== excludeBranch
  );
  while (true) {
    console.log(chalk.yellow(`请选择要${info}分支:`));
    selectableBranches.forEach((branch, index) => {
      console.log(`${index + 1}. ${branch}`);
    });

    const selectedIndex = parseInt(await readInput("请输入分支编号:"));
    if (selectedIndex >= 1 && selectedIndex <= selectableBranches.length) {
      return selectableBranches[selectedIndex - 1];
    } else {
      console.log(chalk.red("无效的分支编号,请重新输入!"));
    }
  }
}

// 推送当前分支到远程仓库
function pushBranch(branch) {
  execSync(`git push origin ${branch}`);
}

async function syncCommit(currentBranch, commitId) {
  const shouldSync = await readInput("是否将此次提交同步到其他分支? (yes/no)");
  if (shouldSync.toLowerCase() === "yes") {
    const targetBranch = await selectBranch(getLocalBranches(), currentBranch, '切换的');
    await checkoutBranch(targetBranch);
    await pullCurrentBranch(targetBranch);

    const shouldMerge = await readInput("是否需要合并其他分支代码? (yes/no)");
    if (shouldMerge.toLowerCase() === "yes") {
      const mergeBranch = await selectBranch(getLocalBranches(), targetBranch, '合并的');
      await mergeOtherBranch(mergeBranch, targetBranch);
    }

    await cherryPickCommit(commitId, targetBranch);
    await pushBranch(targetBranch);
    console.log(
      chalk.green(`已将 commit ${commitId} 同步到 ${targetBranch} 分支`)
    );
  }
}

// 切换到指定分支
function checkoutBranch(branch) {
  execSync(`git checkout ${branch}`);
  console.log(chalk.green(`已切换到分支 ${branch}`));
}

// 拉取指定分支最新代码
async function pullCurrentBranch(branch) {
  try {
    execSync(`git pull origin ${branch}`);
    console.log(chalk.green(`已拉取 ${branch} 分支最新代码`));
  } catch (error) {
    if (
      error.message.includes("CONFLICT") ||
      error.message.includes("conflicts")
    ) {
      console.error(chalk.red("拉取代码发生冲突:"), error.message);
      const gitError = new GitError("PullConflict", error.message);
      await gitError.handle(branch);
    } else {
      throw error;
    }
  }
}

async function mergeOtherBranch(mergeBranch, targetBranch) {
  try {
    execSync(`git merge ${mergeBranch}`);
    console.log(chalk.green(`已合并 ${mergeBranch} 到 ${targetBranch}`));
  } catch (error) {
    if (
      error.message.includes("CONFLICT") ||
      error.message.includes("conflicts")
    ) {
      console.error(chalk.red("合并冲突:"), error.message);
      const gitError = new GitError("MergeConflict", error.message);
      await gitError.handle(targetBranch);
    } else {
      throw error;
    }
  }
}

async function cherryPickCommit(commitId, targetBranch) {
  try {
    execSync(`git cherry-pick ${commitId}`);
  } catch (error) {
    if (
      error.message.includes("CONFLICT") ||
      error.message.includes("conflicts")
    ) {
      console.error(chalk.red("Cherry-pick 冲突:"), error.message);
      const gitError = new GitError("CherryPickConflict", error.message);
      await gitError.handle(targetBranch);
    } else {
      throw error;
    }
  }
}

yargs(hideBin(process.argv))
  .command(
    "start",
    "Start a gitpush process",
    () => {},
    async () => {
      const currentBranch = getCurrentBranch();

      const commitSpinner = ora("开始生成commit").start();
      // 暂停 spinner
      commitSpinner.stop();
      const commitMessage = await readInput("请输入commit message: ");
      // 恢复 spinner
      commitSpinner.start();
      generateCommit(commitMessage);
      commitSpinner.succeed("commit提交生成完成");

      const localBranches = getLocalBranches();
      const selectedBranch = await selectBranch(localBranches);
      console.log(
        chalk.yellow(`开始合并${selectedBranch}代码到${currentBranch}`)
      );

      try {
        await mergeBranch(selectedBranch);
        console.log(
          chalk.green(`合并${selectedBranch}成功,推送代码到${currentBranch}`)
        );
      } catch (error) {
        if (
          error.message.includes("CONFLICT") ||
          error.message.includes("conflicts")
        ) {
          const gitError = new GitError("MergeConflict", error.message);
          await gitError.handle(selectedBranch);
        } else {
          throw error;
        }
      }

      const pushSpinner = ora(`推送代码到${currentBranch}`).start();
      try {
        pushBranch(currentBranch);
        pushSpinner.succeed("推送完成");
        pushSpinner.stop();
      } catch (error) {
        if (
          error.message.includes("rejected") &&
          error.message.includes("non-fast-forward")
        ) {
          const gitError = new GitError("PushFast", error.message);
          await gitError.handle(currentBranch);
          pushSpinner.stop();
        } else {
          console.error(chalk.red(`推送代码失败到${currentBranch}失败`));
          pushSpinner.fail("推送失败");
          throw error;
        }
      }
      // 同步提交到其他分支
      const commitId = execSync("git rev-parse HEAD").toString().trim();
      await syncCommit(currentBranch, commitId);
      const currentCheckoutBranch = getCurrentBranch();
      // commit同步完成后提交代码
      const syncPushpushSpinner = ora(`推送代码到${currentCheckoutBranch}`).start();
      try {
        pushBranch(currentCheckoutBranch);
        syncPushpushSpinner.succeed("推送完成");
        syncPushpushSpinner.stop();
      } catch (error) {
        if (
          error.message.includes("rejected") &&
          error.message.includes("non-fast-forward")
        ) {
          const gitError = new GitError("PushFast", error.message);
          await gitError.handle(currentCheckoutBranch);
          syncPushpushSpinner.stop();
        } else {
          console.error(chalk.red(`推送代码失败到${currentCheckoutBranch}失败`));
          syncPushpushSpinner.fail("推送失败");
          throw error;
        }
      }
    }
  )
  .demandCommand(1, "You need to specify a command")
  .strict()
  .parse();
