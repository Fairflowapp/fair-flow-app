"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function abort(message) {
  throw new Error("QA SETUP: " + message);
}

function git(worktree, args) {
  return spawnSync("git", ["-C", worktree].concat(args), {
    encoding: "utf8",
  });
}

function inspectTargetWorktree(rawPath, label) {
  const worktree = path.resolve(String(rawPath || "").trim());
  if (!worktree || worktree === path.parse(worktree).root) {
    abort("Target --worktree must be an absolute existing path.");
  }
  if (!fs.existsSync(worktree) || !fs.statSync(worktree).isDirectory()) {
    abort("Target worktree does not exist: " + worktree);
  }
  const indexHtml = path.join(worktree, "public", "index.html");
  if (!fs.existsSync(indexHtml) || !fs.statSync(indexHtml).isFile()) {
    abort("Target is missing public/index.html: " + worktree);
  }

  const gitDir = git(worktree, ["rev-parse", "--is-inside-work-tree"]);
  if (gitDir.status !== 0 || String(gitDir.stdout || "").trim() !== "true") {
    abort("Target is not a Git worktree/repository: " + worktree);
  }

  const head = git(worktree, ["rev-parse", "HEAD"]);
  if (head.status !== 0) abort("Could not resolve target HEAD SHA: " + (head.stderr || head.stdout));
  const headSha = String(head.stdout || "").trim();

  const branchRes = git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchRes.status === 0 ? String(branchRes.stdout || "").trim() : "(unknown)";

  const statusRes = git(worktree, ["status", "--porcelain"]);
  if (statusRes.status !== 0) abort("Could not read target git status.");
  const porcelain = String(statusRes.stdout || "");
  const dirty = porcelain.trim() !== "";

  const shortSha = headSha.slice(0, 7);
  const autId = dirty ? headSha + "+DIRTY" : headSha;

  return {
    worktree,
    label: String(label || path.basename(worktree)).trim() || path.basename(worktree),
    branch,
    headSha,
    shortSha,
    dirty,
    statusPorcelain: porcelain,
    autId,
    publicRoot: path.join(worktree, "public"),
  };
}

module.exports = {
  inspectTargetWorktree,
};
