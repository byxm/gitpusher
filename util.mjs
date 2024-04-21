import readline from "readline";
import chalk from "chalk";
import { execSync } from "child_process";
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

export { readInput, getCurrentBranch, getLocalBranches };
