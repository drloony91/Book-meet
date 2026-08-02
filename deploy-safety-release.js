import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    shell: false,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with code ${result.status}`);
  }
}

run("unzip", ["-o", "book-meet-safety-release-20260729.zip"]);
run(process.execPath, ["scripts/migrate.js"]);

console.log("Safety release deployed successfully.");
