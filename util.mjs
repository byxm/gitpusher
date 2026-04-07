import readline from "readline";
import chalk from "chalk";
import { execSync } from "child_process";

const HOTFIX_MAIN_BRANCH_REGEXP =
  /^hotfix\/(\d+(?:\.\d+)*)-hotfix_(\d{8})(?:$|[-_].+)?$/;
const HOTFIX_PRINCIPAL_BRANCH_REGEXP =
  /^hotfix\/(\d+(?:\.\d+)*)-hotfix_(\d{8})$/;
const RELEASE_MAIN_BRANCH_REGEXP =
  /^release\/(\d+(?:\.\d+)*)-release_(\d{8})(?:$|[-_].+)?$/;
const RELEASE_PRINCIPAL_BRANCH_REGEXP =
  /^release\/(\d+(?:\.\d+)*)-release_(\d{8})$/;

// 读取用户输入
function readInput(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(chalk.cyan(question), (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// 获取当前分支名称
function getCurrentBranch() {
  return execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
}

// 获取本地所有分支
function getLocalBranches() {
  return execSync("git branch")
    .toString()
    .split("\n")
    .map((branch) => branch.trim())
    .filter((branch) => branch !== "")
    .map((branch) => branch.replace("* ", ""));
}

function getAllBranches() {
  return execSync("git branch --all --format='%(refname:short)'")
    .toString()
    .split("\n")
    .map((branch) => branch.trim())
    .filter((branch) => branch !== "" && !branch.includes("HEAD ->"))
    .map(normalizeBranchName)
    .filter((branch) => branch !== "");
}

function normalizeBranchName(branch) {
  if (branch.startsWith("origin/")) {
    return branch.replace(/^origin\//, "");
  }

  if (branch.startsWith("remotes/origin/")) {
    return branch.replace(/^remotes\/origin\//, "");
  }

  return branch;
}

function getUniqueBranches(branches) {
  return [...new Set(branches.map(normalizeBranchName))];
}

function compareVersions(versionA, versionB) {
  const segmentsA = versionA.split(".").map((segment) => parseInt(segment, 10));
  const segmentsB = versionB.split(".").map((segment) => parseInt(segment, 10));
  const maxLength = Math.max(segmentsA.length, segmentsB.length);

  for (let index = 0; index < maxLength; index += 1) {
    const currentA = segmentsA[index] ?? 0;
    const currentB = segmentsB[index] ?? 0;
    if (currentA !== currentB) {
      return currentA - currentB;
    }
  }

  return 0;
}

function parseBranchContext(branch) {
  if (branch === "test" || branch.startsWith("test_bugfix/")) {
    return { type: "test", principalBranch: "test" };
  }

  if (branch === "dev" || branch.startsWith("dev_bugfix/")) {
    return { type: "dev", principalBranch: "dev" };
  }

  const hotfixMatch = branch.match(HOTFIX_MAIN_BRANCH_REGEXP);
  if (hotfixMatch) {
    const [, version, date] = hotfixMatch;
    return {
      type: "hotfix",
      principalBranch: `hotfix/${version}-hotfix_${date}`,
      version,
      date,
    };
  }

  const releaseMatch = branch.match(RELEASE_MAIN_BRANCH_REGEXP);
  if (releaseMatch) {
    const [, version, date] = releaseMatch;
    return {
      type: "release",
      principalBranch: `release/${version}-release_${date}`,
      version,
      date,
    };
  }

  return { type: "unknown", principalBranch: null };
}

function getBranchMetadata(branch) {
  if (branch === "test") {
    return { type: "test", branch, principalBranch: "test" };
  }

  if (branch === "dev") {
    return { type: "dev", branch, principalBranch: "dev" };
  }

  const hotfixMatch = branch.match(HOTFIX_PRINCIPAL_BRANCH_REGEXP);
  if (hotfixMatch) {
    const [, version, date] = hotfixMatch;
    return {
      type: "hotfix",
      branch,
      principalBranch: branch,
      version,
      date,
    };
  }

  const releaseMatch = branch.match(RELEASE_PRINCIPAL_BRANCH_REGEXP);
  if (releaseMatch) {
    const [, version, date] = releaseMatch;
    return {
      type: "release",
      branch,
      principalBranch: branch,
      version,
      date,
    };
  }

  return null;
}

function getPrincipalBranches(branches) {
  return getUniqueBranches(branches)
    .map(getBranchMetadata)
    .filter(Boolean);
}

function getAutoBranchPlan(currentBranch, branches) {
  const currentContext = parseBranchContext(currentBranch);
  const principalBranches = getPrincipalBranches(branches);
  let firstMergeBranch = currentContext.principalBranch;
  let cherryPickBranches = [];

  switch (currentContext.type) {
    case "test": {
      const latestRelease = principalBranches
        .filter((branch) => branch.type === "release")
        .sort((branchA, branchB) => {
          const versionCompare = compareVersions(
            branchB.version,
            branchA.version
          );
          if (versionCompare !== 0) {
            return versionCompare;
          }

          return branchB.date.localeCompare(branchA.date);
        })[0];
      cherryPickBranches = latestRelease ? [latestRelease.branch] : [];
      break;
    }
    case "dev":
      cherryPickBranches = [];
      break;
    case "hotfix":
      cherryPickBranches = principalBranches
        .filter(
          (branch) =>
            branch.type === "hotfix" &&
            compareVersions(branch.version, currentContext.version) > 0
        )
        .sort((branchA, branchB) =>
          compareVersions(branchA.version, branchB.version)
        )
        .map((branch) => branch.branch);
      if (principalBranches.some((branch) => branch.branch === "test")) {
        cherryPickBranches.push("test");
      }
      break;
    case "release":
      if (principalBranches.some((branch) => branch.branch === "test")) {
        cherryPickBranches = ["test"];
      }
      break;
    default:
      firstMergeBranch = null;
      cherryPickBranches = [];
  }

  return {
    currentContext,
    availableBranches: getUniqueBranches(branches),
    firstMergeBranch,
    cherryPickBranches: getUniqueBranches(
      cherryPickBranches.filter((branch) => branch !== firstMergeBranch)
    ),
  };
}

// 继续修改文件并合并到当次提交
async function needContinueModify() {
  console.log(
    chalk.yellow(
      "测试请继续修改你需要修改的文件，修改完毕后输入 continue 继续，若要终止修改请输入 abort 取消修改"
    )
  );
  while (true) {
    const input = await readInput("gitpush> ");
    if (input === "continue") {
      try {
        process.env.GIT_EDITOR = "true"; // amend合并关闭编辑器
        execSync("git add .");
        execSync("git commit --amend");
        console.log(chalk.green("合并提交成功"));
        process.env.GIT_EDITOR = "false"; // amend合并关闭编辑器
        break;
      } catch (error) {
        console.error(chalk.red("合并代码提交出错：", error.message));
        throw error;
      }
    }
    if (input === "abort") {
      console.log(chalk.yellow("取消本次代码修改"));
      execSync("git checkout -- .");
      break;
    }
  }
}

function openUrl(url) {
  const openMethod = (url) => {
    let command;

    // 根据平台选择对应的命令
    switch (process.platform) {
      case "darwin": // MacOS
        command = `open "${url}/diffs"`;
        break;
      case "win32": // Windows
        command = `start "${url}/diffs"`;
        break;
      case "linux": // Linux
        command = `xdg-open "${url}/diffs"`;
        break;
      default:
        console.log(`Unsupported platform: ${process.platform}`);
        return;
    }

    try {
      // 执行命令，使用系统默认浏览器打开 URL
      execSync(command);
    } catch (err) {
      console.error(`Error opening URL: ${err}`);
    }
  };
  if (Array.isArray(url) && url.length) {
    url.forEach((el) => openMethod(el));
  } else {
    openMethod(url);
  }
}

export {
  compareVersions,
  getAllBranches,
  getAutoBranchPlan,
  getBranchMetadata,
  readInput,
  getCurrentBranch,
  getLocalBranches,
  getPrincipalBranches,
  getUniqueBranches,
  normalizeBranchName,
  needContinueModify,
  parseBranchContext,
  openUrl,
};
