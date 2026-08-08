import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runServiceTokenCli } from "../src/cli/service-token.js";
import { createSecretsDatabase, type SecretsDatabaseInstance } from "../src/db/client.js";
import { migrateSecretsDatabase } from "../src/db/migrate.js";
import { findServiceTokenByPlaintext, isServiceTokenShape } from "../src/service-tokens/index.js";

interface CliRun {
  db: SecretsDatabaseInstance["db"];
  run: (...argv: string[]) => string[];
  output: string[];
}

function withCli(exercise: (cli: CliRun) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "unimatrix-secrets-cli-"));

  try {
    const instance = createSecretsDatabase({ filePath: join(directory, "secrets.sqlite") });

    try {
      migrateSecretsDatabase(instance);

      const output: string[] = [];
      const deps = {
        db: instance.db,
        write: (line: string) => {
          output.push(line);
        },
      };

      exercise({
        db: instance.db,
        output,
        run: (...argv: string[]) => {
          const start = output.length;

          runServiceTokenCli(argv, deps);

          return output.slice(start);
        },
      });
    } finally {
      instance.client.close();
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

void test("issue prints a usable token exactly once", () => {
  withCli(({ db, run }) => {
    const lines = run("issue", "--name", "api", "--scope", "github", "--capability", "read");
    const tokens = lines.flatMap((line) => line.split(/\s+/u).filter(isServiceTokenShape));

    assert.equal(tokens.length, 1, `expected one printed token, got ${String(tokens.length)}`);
    assert.equal(findServiceTokenByPlaintext(db, tokens[0] ?? "").outcome, "active");
    assert.ok(lines.some((line) => line.includes("capability: read")));
  });
});

void test("issue refuses a missing or unknown capability rather than choosing one", () => {
  withCli(({ run }) => {
    assert.throws(() => run("issue", "--name", "api", "--scope", "github"), /--capability/u);
    assert.throws(
      () => run("issue", "--name", "api", "--scope", "github", "--capability", "admin"),
      /--capability must be read or manage/u,
    );
    assert.throws(
      () => run("issue", "--name", "api", "--capability", "read"),
      /--scope is required/u,
    );
  });
});

void test("list shows capability and scope but neither a digest nor a plaintext", () => {
  withCli(({ run }) => {
    assert.deepEqual(run("list"), ["No service tokens."]);

    const issued = run("issue", "--name", "api", "--scope", "github", "--capability", "manage");
    const token = issued.flatMap((line) => line.split(/\s+/u).filter(isServiceTokenShape))[0];
    const listed = run("list").join("\n");

    assert.match(listed, /^name\tcapability\tscope\tcreated\tlast used\trevoked$/mu);
    assert.match(listed, /^api\tmanage\tgithub\t/mu);
    assert.ok(!listed.includes(token ?? "unreachable"), "the listing printed the plaintext token");
    assert.doesNotMatch(listed, /[0-9a-f]{64}/u, "the listing printed a digest");
  });
});

void test("revoke marks the named token and then refuses to repeat itself", () => {
  withCli(({ run }) => {
    run("issue", "--name", "api", "--scope", "github", "--capability", "read");

    assert.deepEqual(run("revoke", "--name", "api"), ['Revoked service token "api".']);
    assert.throws(() => run("revoke", "--name", "api"), /No active service token/u);
    assert.match(run("list").join("\n"), /^api\tread\tgithub\t/mu);
  });
});

void test("an unknown or missing subcommand fails with the usage text", () => {
  withCli(({ run }) => {
    assert.throws(() => run("rotate"), /Unknown subcommand "rotate"[\s\S]*Usage:/u);
    assert.throws(() => run(), /Unknown subcommand ""/u);
  });
});
