import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";

const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openpost-restore-drill-"));
  temporaryDirectories.push(directory);
  const backup = path.join(directory, "backup.sql.gz");
  const evidence = path.join(directory, "evidence", "result.json");
  const transport = path.join(directory, "podman");
  // Execute the shell's SQL against a real database with the current table
  // names. Only the container transport and PostgreSQL catalog are adapted.
  await writeFile(
    transport,
    `#!${process.execPath}
import { Database } from "bun:sqlite";
import { appendFileSync, unlinkSync } from "node:fs";
const args = process.argv.slice(2);
const command = args.find(value => ["createdb", "dropdb", "psql"].includes(value));
const file = ${JSON.stringify(path.join(directory, "restored.db"))};
appendFileSync(${JSON.stringify(path.join(directory, "commands"))}, command + "\\n");
if (command === "createdb") { new Database(file).close(); }
else if (command === "dropdb") { unlinkSync(file); }
else {
  const db = new Database(file);
  const query = args[args.indexOf("-Atqc") + 1];
  if (!args.includes("-Atqc")) db.exec(await Bun.stdin.text());
  else if (query.includes("pg_database")) {}
  else {
    const sql = query.includes("information_schema.tables")
      ? "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'"
      : query;
    console.log(Object.values(db.query(sql).get())[0]);
  }
  db.close();
}
`,
    { mode: 0o755 },
  );
  const schema = [
    "users",
    "workspaces",
    "publications",
    "media_attachments",
    "renditions",
    "jobs",
    "accounts",
    "tokens",
    "settings",
    "events",
  ]
    .map((table) => `CREATE TABLE ${table} (id TEXT PRIMARY KEY);`)
    .join("\n");
  await writeFile(
    backup,
    gzipSync(
      `${schema}\nINSERT INTO publications VALUES ('p1'), ('p2');\nINSERT INTO users VALUES ('u1');`,
    ),
  );
  return {
    directory,
    evidence,
    run(extra = {}) {
      return spawnSync("bash", [new URL("./restore-drill.sh", import.meta.url).pathname], {
        encoding: "utf8",
        env: {
          ...process.env,
          OPENPOST_RESTORE_BACKUP: backup,
          OPENPOST_RESTORE_DATABASE: "openpost_restore_drill_20261014_120000",
          OPENPOST_RESTORE_EVIDENCE: evidence,
          PODMAN_BIN: transport,
          ...extra,
        },
      });
    },
  };
}

test("restores a Publication database, reports its inventory, and drops the temporary database", async () => {
  const f = await fixture();
  const result = f.run();

  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("publications=2");
  expect(JSON.parse(await readFile(f.evidence, "utf8"))).toMatchObject({
    status: "passed",
    users: 1,
    publications: 2,
    database_media: 0,
    media_snapshot: "not_checked",
  });
  expect(await Bun.file(path.join(f.directory, "restored.db")).exists()).toBe(false);
  expect(await readFile(path.join(f.directory, "commands"), "utf8")).toEndWith("dropdb\n");
});

test("cleans up a failed restore without writing successful evidence", async () => {
  const f = await fixture();
  await writeFile(path.join(f.directory, "backup.sql.gz"), gzipSync("invalid SQL;"));
  const result = f.run();
  expect(result.status).not.toBe(0);
  expect(await Bun.file(f.evidence).exists()).toBe(false);
  expect(await Bun.file(path.join(f.directory, "restored.db")).exists()).toBe(false);
});
