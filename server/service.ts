/**
 * Run Jira Linear in the background on macOS: a per-user LaunchAgent that starts at login and
 * restarts the server if it stops (the same approach as the other local tools).
 *
 *   deno task service:install     write the agent, build the web app if needed, start it
 *   deno task service:uninstall   stop it and remove the agent
 *   deno task service:status      is it loaded, and does it answer?
 *
 * Jira credentials are not stored in the agent; the server reads them from jira-reporter's .env.
 */
import { projectRoot } from "./config.ts";
import { readSettingsSync } from "./settings.ts";

export const LABEL = "com.jira-linear";

/** The launchd label: JIRA_LINEAR_SERVICE_LABEL, else `serviceLabel` in the settings, else the default. */
export function serviceLabel(root: string, env: Record<string, string | undefined>): string {
  return env.JIRA_LINEAR_SERVICE_LABEL ?? readSettingsSync(root, env).serviceLabel ?? LABEL;
}

const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function renderPlist({ deno, root, label = LABEL }: { deno: string; root: string; label?: string }): string {
  const dir = root.replace(/\/+$/, "");
  const arg = (a: string) => `\t\t<string>${esc(a)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${esc(label)}</string>
	<key>ProgramArguments</key>
	<array>
${["run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "server/main.ts"].reduce((acc, a) => `${acc}${arg(a)}\n`, `${arg(deno)}\n`).trimEnd()}
	</array>
	<key>WorkingDirectory</key>
	<string>${esc(dir)}</string>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>${esc(dir)}/data/service.log</string>
	<key>StandardErrorPath</key>
	<string>${esc(dir)}/data/service.log</string>
</dict>
</plist>
`;
}

// ---------------------------------------------------------------- CLI

async function run(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  // On a macOS-protected folder, getcwd can be interrupted by a signal ("Interrupted system call") when a
  // child process exits; that is transient, so try again.
  let r: Deno.CommandOutput | undefined;
  for (let attempt = 0; !r; attempt++) {
    try {
      r = await new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" }).output();
    } catch (e) {
      if (attempt >= 4 || !String(e).includes("Interrupted system call")) throw e;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  const dec = new TextDecoder();
  return { ok: r.success, out: (dec.decode(r.stdout) + dec.decode(r.stderr)).trim() };
}

async function answers(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(2000) });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

async function main(cmd: string | undefined) {
  if (Deno.build.os !== "darwin") throw new Error("The background service uses macOS launchd.");
  const root = projectRoot(import.meta.url);
  const LABEL = serviceLabel(root, Deno.env.toObject());
  const home = Deno.env.get("HOME")!;
  const plist = `${home}/Library/LaunchAgents/${LABEL}.plist`;
  const uid = (await run("id", ["-u"])).out;
  const domain = `gui/${uid}`;
  const port = Number(Deno.env.get("PORT") ?? 8766);

  if (cmd === "install") {
    const deno = Deno.execPath();
    if (!(await Deno.stat(`${root}web/dist/index.html`).then(() => true, () => false))) {
      console.log("Building the web app…");
      const b = await new Deno.Command("npm", { args: ["run", "build"], cwd: `${root}web`, stdout: "inherit", stderr: "inherit" }).output();
      if (!b.success) throw new Error("Web build failed");
    }
    await Deno.mkdir(`${root}data`, { recursive: true });
    await Deno.writeTextFile(plist, renderPlist({ deno, root, label: LABEL }));
    await run("launchctl", ["bootout", `${domain}/${LABEL}`]); // fine if it was not loaded
    const r = await run("launchctl", ["bootstrap", domain, plist]);
    if (!r.ok) throw new Error(`launchctl bootstrap failed: ${r.out}`);
    await run("launchctl", ["kickstart", "-k", `${domain}/${LABEL}`]);
    for (let i = 0; i < 20 && !(await answers(port)); i++) await new Promise((r) => setTimeout(r, 500));
    console.log((await answers(port)) ? `Running: http://localhost:${port}  (starts at login, restarts if it stops)` : `Installed, but not answering yet. See ${root}data/service.log`);
  } else if (cmd === "uninstall") {
    await run("launchctl", ["bootout", `${domain}/${LABEL}`]);
    await Deno.remove(plist).catch(() => {});
    console.log("Stopped and removed. Nothing else was changed.");
  } else if (cmd === "status") {
    const loaded = (await run("launchctl", ["print", `${domain}/${LABEL}`])).ok;
    console.log(`launch agent: ${loaded ? "loaded" : "not loaded"}`);
    console.log(`http://localhost:${port}: ${(await answers(port)) ? "answering" : "not answering"}`);
    console.log(`log: ${root}data/service.log`);
  } else {
    console.error("Usage: deno task service:install | service:uninstall | service:status");
    Deno.exit(2);
  }
}

if (import.meta.main) await main(Deno.args[0]);
