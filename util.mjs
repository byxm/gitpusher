import readline from "readline";
import chalk from "chalk";
import { execSync } from "child_process";
import inquirer from "inquirer";
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

function getProjectIdFromGitRemote() {
  const remoteUrl = execSync("git remote get-url origin").toString().trim();
  const match = remoteUrl.match(/(?<=:)[^\/]+(?:\/[^\/]+)*(?=\.git)/);

  if (match && match[0]) {
    return encodeURIComponent(match[0]);
  } else {
    throw new Error(
      "无法从远程仓库 URL 提取 projectId，请手动创建merge request"
    );
  }
}

function getGitUrl() {
  const remoteUrl = execSync("git remote get-url origin").toString().trim();
  const match = remoteUrl.match(/(?:github\.com|gitlab\.[\w-]+(?:\.[\w-]+)*)/);

  if (match && match[0]) {
    return match[0];
  } else {
    throw new Error("无法从远程仓库 URL 提取 git url，请手动创建merge request");
  }
}

async function getGitlabToken(storage) {
  const oldToken = await storage.getItem("gitlabToken");

  if (oldToken) {
    const useOldToken = await inquirer.prompt([
      {
        type: "confirm",
        name: "useOld",
        message: "是否使用上一次的 GitLab Access Token?",
        default: true,
      },
    ]);

    if (useOldToken.useOld) {
      return oldToken;
    }
  }

  const newToken = await inquirer.prompt([
    {
      type: "password",
      name: "token",
      message: "请输入 GitLab Access Token:",
    },
  ]);

  await storage.setItem("gitlabToken", newToken.token);
  return newToken.token;
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
  let command;

  // 根据平台选择对应的命令
  switch (process.platform) {
    case "darwin": // MacOS
      command = `open "${url}"`;
      break;
    case "win32": // Windows
      command = `start "${url}"`;
      break;
    case "linux": // Linux
      command = `xdg-open "${url}"`;
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
}

export {
  readInput,
  getCurrentBranch,
  getLocalBranches,
  getProjectIdFromGitRemote,
  getGitlabToken,
  needContinueModify,
  getGitUrl,
  openUrl,
};
