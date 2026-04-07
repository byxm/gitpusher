#!/usr/bin/env node
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { execSync, spawnSync } from "child_process";
import inquirer from "inquirer";
import ora from "ora";
import chalk from "chalk";
import clipboard from "clipboardy";
import {
  readInput,
  getCurrentBranch,
  openUrl,
  getAllBranches,
  getAutoBranchPlan,
} from "./util.mjs";
import GitError from "./error.mjs";

function generateCommit(message, argv) {
  execSync("git add .");
  execSync(`git commit -m "${message}" ${argv.noVerify ? "--no-verify" : ""}`);
}

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
                process.env.GIT_EDITOR = "true";
                execSync("git add .");
                execSync("git rebase --continue");
                console.log("冲突解决,变基继续");
                process.env.GIT_EDITOR = "false";
              } catch (continueError) {
                console.error(
                  "变基继续失败,请重新解决冲突:",
                  continueError.message
                );
                process.env.GIT_EDITOR = "false";
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

function runGitPush(args, fallbackMessage) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.status !== 0) {
    throw new Error(output || fallbackMessage);
  }

  return output;
}

function pushBranch(branch, extraArgs = []) {
  return runGitPush(["push", "origin", branch, ...extraArgs], `git push origin ${branch} 执行失败`);
}

function pushRemoteBranch(branch, extraArgs = []) {
  return runGitPush(
    ["push", "-u", "origin", branch, ...extraArgs],
    `git push -u origin ${branch} 执行失败`
  );
}

function remoteBranchExists(branch) {
  try {
    return (
      execSync(`git ls-remote --heads origin ${branch}`).toString().trim() !== ""
    );
  } catch {
    return false;
  }
}

function localBranchExists(branch) {
  try {
    execSync(`git show-ref --verify --quiet refs/heads/${branch}`);
    return true;
  } catch {
    return false;
  }
}

function checkoutExistingBranch(branch) {
  if (localBranchExists(branch)) {
    execSync(`git checkout ${branch}`);
    console.log(chalk.green(`已切换到分支 ${branch}`));
    return;
  }

  if (remoteBranchExists(branch)) {
    execSync(`git checkout -b ${branch} origin/${branch}`);
    console.log(chalk.green(`已切换到远程分支 ${branch}`));
    return;
  }

  throw new Error(`分支 ${branch} 不存在，无法切换`);
}

function createTempBranchFromTarget(targetBranch, tempBranch) {
  execSync(`git checkout ${targetBranch}`);
  execSync(`git checkout -b ${tempBranch}`);
  console.log(chalk.green(`已创建临时分支 ${tempBranch}`));
}

function deleteLocalBranch(branch) {
  execSync(`git branch -D ${branch}`);
}

function deleteRemoteBranch(branch) {
  execSync(`git push origin --delete ${branch}`);
}

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

function parseMergeRequestUrl(pushOutput) {
  const mrUrlPattern = /https?:\/\/[^\s]+\/merge_requests\/\d+/;
  return pushOutput.match(mrUrlPattern)?.[0] ?? null;
}

async function pushAndCreateMergeRequest(
  commitMessage,
  gitlabMergeRequestsUrl,
  { sourceBranch, targetBranch, setUpstream = false }
) {
  console.log(chalk.green("开始创建Merge Request"));
  const pushArgs = [
    "-o",
    "merge_request.create",
    "-o",
    `merge_request.target=${targetBranch}`,
    "-o",
    `merge_request.title=${commitMessage}`,
  ];
  const pushSpinner = ora(`推送代码到${sourceBranch}`).start();

  try {
    const pushOutput = setUpstream
      ? pushRemoteBranch(sourceBranch, pushArgs)
      : pushBranch(sourceBranch, pushArgs);
    pushSpinner.succeed("推送完成");

    const mergeRequestUrl = parseMergeRequestUrl(pushOutput);
    if (mergeRequestUrl) {
      console.log(
        chalk.green(`创建 Merge Request 成功,地址为: ${mergeRequestUrl}`)
      );
      gitlabMergeRequestsUrl.push(mergeRequestUrl);
    } else {
      console.log(chalk.yellow("未解析到 MR 地址，请手动确认 MR 是否创建成功"));
    }

    return mergeRequestUrl;
  } catch (error) {
    if (
      error.message.includes("rejected") &&
      error.message.includes("non-fast-forward")
    ) {
      const gitError = new GitError("PushFast", error.message);
      await gitError.handle(sourceBranch);
      pushSpinner.stop();
    } else {
      console.error(chalk.red(`推送或创建MR失败: ${error.message}`));
      pushSpinner.fail("推送失败");
      throw error;
    }
  }
}

function printBranchPlan(plan) {
  console.log(chalk.yellow("\n自动识别到以下分支计划:"));
  console.log(
    chalk.yellow(
      `首个 MR 目标分支: ${plan.firstMergeBranch || "未识别，请手动补录"}`
    )
  );
  console.log(chalk.yellow("后续 cherry-pick 目标分支:"));
  if (!plan.cherryPickBranches.length) {
    console.log("  无");
    return;
  }

  plan.cherryPickBranches.forEach((branch, index) => {
    console.log(`  ${index + 1}. ${branch}`);
  });
}

function ensureAutoBranchPlan(plan) {
  if (!plan.firstMergeBranch) {
    throw new Error("自动模式下未能识别首个 MR 目标分支，请关闭 --auto 后手动确认");
  }
}

async function selectValidBranch(prompt, availableBranches) {
  while (true) {
    const branch = (await readInput(prompt)).trim();
    if (availableBranches.includes(branch)) {
      return branch;
    }
    console.log(chalk.red(`分支 ${branch} 不存在，请输入完整且有效的分支名`));
  }
}

async function confirmAutoBranchPlan(autoBranchPlan) {
  const plan = {
    ...autoBranchPlan,
    cherryPickBranches: [...autoBranchPlan.cherryPickBranches],
  };

  if (!plan.firstMergeBranch) {
    console.log(chalk.red("未能自动识别首个 MR 目标分支，请手动补录"));
    plan.firstMergeBranch = await selectValidBranch(
      "请输入首个 MR 目标分支: ",
      plan.availableBranches
    );
  }

  while (true) {
    printBranchPlan(plan);
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "请确认是否需要调整目标分支",
        choices: [
          { name: "确认并继续", value: "confirm" },
          { name: "修改首个 MR 目标分支", value: "edit-first" },
          { name: "删除 cherry-pick 目标分支", value: "remove-cherry" },
          { name: "新增 cherry-pick 目标分支", value: "add-cherry" },
          { name: "重新展示分支计划", value: "show" },
        ],
      },
    ]);

    if (action === "confirm") {
      return plan;
    }

    if (action === "edit-first") {
      plan.firstMergeBranch = await selectValidBranch(
        "请输入新的首个 MR 目标分支: ",
        plan.availableBranches
      );
      plan.cherryPickBranches = plan.cherryPickBranches.filter(
        (branch) => branch !== plan.firstMergeBranch
      );
      continue;
    }

    if (action === "remove-cherry") {
      if (!plan.cherryPickBranches.length) {
        console.log(chalk.yellow("当前没有可删除的 cherry-pick 目标分支"));
        continue;
      }

      const selectedIndexes = await readInput(
        "请输入要删除的编号，多个编号用空格或逗号分隔: "
      );
      const indexes = [
        ...new Set(
          selectedIndexes
            .split(/[\s,]+/)
            .map((index) => parseInt(index, 10))
            .filter(
              (index) =>
                Number.isInteger(index) &&
                index >= 1 &&
                index <= plan.cherryPickBranches.length
            )
        ),
      ];

      if (!indexes.length) {
        console.log(chalk.red("未识别到有效编号"));
        continue;
      }

      plan.cherryPickBranches = plan.cherryPickBranches.filter(
        (_, index) => !indexes.includes(index + 1)
      );
      continue;
    }

    if (action === "add-cherry") {
      const branch = await selectValidBranch(
        "请输入要新增的 cherry-pick 目标分支全名: ",
        plan.availableBranches
      );
      if (branch === plan.firstMergeBranch) {
        console.log(chalk.yellow("该分支已经是首个 MR 目标分支，无需重复添加"));
        continue;
      }
      if (!plan.cherryPickBranches.includes(branch)) {
        plan.cherryPickBranches.push(branch);
      }
    }
  }
}

async function createAndPushFirstCommit({
  selectedBranch,
  currentBranch,
  commitMessage,
  gitlabMergeRequestsUrl,
}) {
  try {
    await mergeBranch(selectedBranch);
    console.log(chalk.green(`合并${selectedBranch}成功,推送代码到${currentBranch}`));
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

  const commitId = execSync("git rev-parse HEAD").toString().trim();
  if (selectedBranch === currentBranch) {
    const tempSourceBranch = `${currentBranch}-${commitId}`;
    createTempBranchFromTarget(currentBranch, tempSourceBranch);
    await pushAndCreateMergeRequest(commitMessage, gitlabMergeRequestsUrl, {
      sourceBranch: tempSourceBranch,
      targetBranch: selectedBranch,
      setUpstream: true,
    });
    checkoutExistingBranch(currentBranch);
    return { commitId, tempBranches: [tempSourceBranch] };
  }

  await pushAndCreateMergeRequest(commitMessage, gitlabMergeRequestsUrl, {
    sourceBranch: currentBranch,
    targetBranch: selectedBranch,
    setUpstream: false,
  });

  return { commitId, tempBranches: [] };
}

async function runCherryPickFlow({
  cherryPickBranches,
  commitId,
  commitMessage,
  gitlabMergeRequestsUrl,
}) {
  const tempBranches = [];

  try {
    for (const targetBranch of cherryPickBranches) {
      console.log(chalk.yellow(`开始向 ${targetBranch} 创建 cherry-pick MR`));
      checkoutExistingBranch(targetBranch);
      await pullCurrentBranch(targetBranch);

      const tempBranch = `${targetBranch}-${commitId}`;
      if (localBranchExists(tempBranch)) {
        deleteLocalBranch(tempBranch);
      }
      createTempBranchFromTarget(targetBranch, tempBranch);
      await cherryPickCommit(commitId, tempBranch);
      console.log(chalk.green(`已将 commit ${commitId} 同步到 ${tempBranch} 分支`));
      await pushAndCreateMergeRequest(commitMessage, gitlabMergeRequestsUrl, {
        sourceBranch: tempBranch,
        targetBranch,
        setUpstream: true,
      });
      tempBranches.push(tempBranch);
    }
  } catch (error) {
    console.error(chalk.red("自动 cherry-pick 过程中发生错误，已保留临时分支供排查"));
    throw error;
  }

  return tempBranches;
}

function logTempBranches(tempBranches) {
  console.log(chalk.yellow("待删除的临时分支如下:"));
  tempBranches.forEach((branch, index) => {
    console.log(`${index + 1}. ${branch}`);
  });
}

async function confirmAndCleanupTempBranches(originalBranch, tempBranches) {
  if (!tempBranches.length) {
    return;
  }

  logTempBranches(tempBranches);
  console.log(
    chalk.yellow(
      "请先完成 MR 合并。确认全部已合并后输入 continue 删除临时分支，输入 skip 保留临时分支"
    )
  );

  while (true) {
    const input = (await readInput("gitpush> ")).trim().toLowerCase();

    if (input === "skip") {
      console.log(
        chalk.yellow("这些分支仍在本地和远程，需要后续手动或再次进入工具清理")
      );
      return;
    }

    if (input === "continue") {
      break;
    }

    console.log(chalk.red("无效输入，请输入 continue 或 skip"));
  }

  checkoutExistingBranch(originalBranch);
  for (const tempBranch of tempBranches) {
    try {
      deleteRemoteBranch(tempBranch);
      console.log(chalk.green(`已删除远程分支 ${tempBranch}`));
    } catch (error) {
      console.error(chalk.red(`删除远程分支 ${tempBranch} 失败: ${error.message}`));
      throw error;
    }

    try {
      deleteLocalBranch(tempBranch);
      console.log(chalk.green(`已删除本地分支 ${tempBranch}`));
    } catch (error) {
      console.error(chalk.red(`删除本地分支 ${tempBranch} 失败: ${error.message}`));
      throw error;
    }
  }
}

yargs(hideBin(process.argv))
  .command(
    "start",
    "Start a gitpush process",
    (yargsCommand) => {
      return yargsCommand
        .option("noVerify", {
          alias: "n",
          type: "boolean",
          description: "禁用lint校验",
          default: false,
        })
        .option("auto", {
          alias: "a",
          type: "boolean",
          description: "自动接受分支推断结果并直接执行",
          default: false,
        });
    },
    async (argv) => {
      const currentBranch = getCurrentBranch();
      const gitlabMergeRequestsUrl = [];
      const commitSpinner = ora("开始生成commit").start();
      commitSpinner.stop();
      const commitMessage = await readInput("请输入commit message: ");
      commitSpinner.start();
      generateCommit(commitMessage, argv);
      commitSpinner.succeed("commit提交生成完成");

      const allBranches = getAllBranches();
      const autoBranchPlan = getAutoBranchPlan(currentBranch, allBranches);
      let confirmedPlan;
      if (argv.auto) {
        console.log(
          chalk.green("开始自动识别目标分支，已启用 --auto，将跳过人工确认")
        );
        ensureAutoBranchPlan(autoBranchPlan);
        printBranchPlan(autoBranchPlan);
        confirmedPlan = autoBranchPlan;
      } else {
        console.log(chalk.green("开始自动识别目标分支"));
        confirmedPlan = await confirmAutoBranchPlan(autoBranchPlan);
      }

      console.log(
        chalk.yellow(
          `开始合并${confirmedPlan.firstMergeBranch}代码到${currentBranch}`
        )
      );
      const firstCommitResult = await createAndPushFirstCommit({
        currentBranch,
        selectedBranch: confirmedPlan.firstMergeBranch,
        commitMessage,
        gitlabMergeRequestsUrl,
      });
      const tempBranches = [...firstCommitResult.tempBranches];

      if (confirmedPlan.cherryPickBranches.length) {
        const cherryPickTempBranches = await runCherryPickFlow({
          cherryPickBranches: confirmedPlan.cherryPickBranches,
          commitId: firstCommitResult.commitId,
          commitMessage,
          gitlabMergeRequestsUrl,
        });
        tempBranches.push(...cherryPickTempBranches);
      }

      if (gitlabMergeRequestsUrl.length) {
        const concatenatedUrls = gitlabMergeRequestsUrl.join("\n\n");
        try {
          clipboard.writeSync(concatenatedUrls);
          console.log(chalk.green("复制链接成功"));
        } catch (error) {
          console.log(chalk.red("复制链接失败", error));
        }
        openUrl(gitlabMergeRequestsUrl);
      }

      await confirmAndCleanupTempBranches(currentBranch, tempBranches);
    }
  )
  .demandCommand(1, "You need to specify a command")
  .strict()
  .parse();
