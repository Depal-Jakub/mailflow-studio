import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const ignoredDirectories = new Set([
  ".git",
  ".netlify",
  "coverage",
  "dist",
  "node_modules",
]);
const ignoredPathPrefixes = [
  path.join("docs", "assets"),
  path.join("supabase", ".temp"),
];
const textExtensions = new Set([
  ".css",
  ".env",
  ".example",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const secretPatterns = [
  {
    name: "Google OAuth client secret",
    pattern: /GOCSPX-[A-Za-z0-9_-]{20,}/g,
  },
  {
    name: "Google access token",
    pattern: /ya29\.[A-Za-z0-9._-]{20,}/g,
  },
  {
    name: "Google refresh token",
    pattern: /1\/\/[A-Za-z0-9_-]{30,}/g,
  },
  {
    name: "Supabase JWT",
    pattern:
      /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
  },
  {
    name: "GitHub token",
    pattern: /(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g,
  },
  {
    name: "AWS access key",
    pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/g,
  },
  {
    name: "MailFlow API key",
    pattern: /mfs_(?:live|test)_[A-Za-z0-9_-]{32,}/g,
  },
  {
    name: "Private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
];

async function collectFiles(directory, relativeDirectory = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (
        ignoredDirectories.has(entry.name) ||
        ignoredPathPrefixes.some(
          (prefix) =>
            relativePath === prefix ||
            relativePath.startsWith(`${prefix}${path.sep}`),
        )
      ) {
        continue;
      }
      files.push(
        ...(await collectFiles(path.join(directory, entry.name), relativePath)),
      );
      continue;
    }

    if (
      entry.isFile() &&
      (textExtensions.has(path.extname(entry.name)) ||
        entry.name === "Dockerfile")
    ) {
      files.push({ absolutePath: path.join(directory, entry.name), relativePath });
    }
  }

  return files;
}

const findings = [];
for (const file of await collectFiles(projectRoot)) {
  const content = await readFile(file.absolutePath, "utf8");
  for (const { name, pattern } of secretPatterns) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const line = content.slice(0, match.index).split("\n").length;
      findings.push(`${file.relativePath}:${line} (${name})`);
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(
    `Wykryto wartości przypominające sekrety:\n${findings
      .map((finding) => `  - ${finding}`)
      .join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Skan sekretów: brak podejrzanych wartości.\n");
}
