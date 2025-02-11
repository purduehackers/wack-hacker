import { Octokit } from "@octokit/rest";

import { env } from "../env";

const octokit = new Octokit({ auth: env.GITHUB_TOKEN });

export async function getAssociationsFile() {
  const response = await octokit.rest.repos.getContent({
    owner: "purduehackers",
    repo: "dark-forest",
    path: "people/associations.json",
    ref: "main",
  });

  if (response.status !== 200) {
    throw new Error("Failed to fetch associations file");
  }

  if (response.data.type !== "file") {
    throw new Error("Associations file is not a file");
  }

  const content = Buffer.from(response.data.content, "base64").toString(
    "utf-8",
  );

  return JSON.parse(content);
}

export async function createGithubIssue(
  title: string,
  body: string,
  assignees: string[],
) {
  const response = await octokit.rest.issues.create({
    owner: "purduehackers",
    repo: "evergreen",
    title,
    body,
    assignees,
  });

  if (response.status !== 201) {
    throw new Error("Failed to create GitHub issue");
  }

  return response.data;
}
