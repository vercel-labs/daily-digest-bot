import { getToken } from "@vercel/connect";
import { FatalError, RetryableError } from "workflow";
import type { GatherActivity } from "./types";

const MAX_REPOSITORIES_TO_DIGEST = 25;
const MAX_REPOSITORIES_TO_FETCH = 1_000;
const MAX_RECENT_ISSUES_PER_REPOSITORY = 10;
const MAX_REPOSITORY_ISSUE_BATCH_SIZE = 25;
const GITHUB_API_VERSION = "2022-11-28";

type GitHubRepository = {
  archived?: boolean;
  disabled?: boolean;
  full_name: string;
  private: boolean;
};

type RepositorySummary = {
  name: string;
  visibility: "public" | "private";
};

type GitHubGraphQLIssue = {
  url: string;
  number: number;
  title: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  author?: {
    login?: string;
  } | null;
  labels?: {
    nodes?: Array<{
      name?: string;
    } | null>;
  } | null;
};

type GraphQLRepositoryIssues = {
  issues?: {
    totalCount?: number;
  } | null;
  recentIssues?: {
    nodes?: GitHubGraphQLIssue[];
  } | null;
};

type GraphQLError = {
  message?: string;
  type?: string;
};

type RepositoryIssueBatchItem = RepositorySummary & {
  includeRecent: boolean;
};

type GitHubRepositoryParts = RepositoryIssueBatchItem & {
  owner: string;
  repo: string;
};

type GitHubGraphQLResponse<TData> = {
  data?: TData;
  errors?: GraphQLError[];
};

type GitHubRepositoryIssuesData = Record<
  `repository${number}`,
  GraphQLRepositoryIssues | null
>;

type RepositoryIssueReport = {
  repository: RepositorySummary;
  openIssueCount: number;
  recentlyOpenedIssues: Array<{
    repository: string;
    visibility: RepositorySummary["visibility"];
    number: number;
    title: string;
    author: string;
    labels: string[];
    state: string;
    createdAt: string;
    updatedAt: string;
    url: string;
  }>;
};

export const gatherProjectActivity: GatherActivity = async (input) => {
  const since = new Date(Date.now() - input.lookbackHours * 60 * 60 * 1000);
  const token = await getGitHubToken();
  const repositories = await getRepositories(token);
  const repositoriesToDigest = repositories.slice(0, MAX_REPOSITORIES_TO_DIGEST);
  const issueReports = await getRepositoryIssueReports(
    repositories,
    since,
    token,
  );

  const publicRepositories = repositories.filter(
    (repository) => repository.visibility === "public",
  );
  const privateRepositories = repositories.filter(
    (repository) => repository.visibility === "private",
  );
  const digestIssueReports = issueReports.slice(0, MAX_REPOSITORIES_TO_DIGEST);
  const openPublicIssues = sumOpenIssues(issueReports, "public");
  const openPrivateIssues = sumOpenIssues(issueReports, "private");
  const recentlyOpenedIssues = digestIssueReports
    .flatMap((report) => report.recentlyOpenedIssues)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return {
    window: {
      channelId: input.channelId,
      lookbackHours: input.lookbackHours,
      since: since.toISOString(),
    },
    repositories: {
      total: repositories.length,
      processed: repositoriesToDigest.length,
      maxProcessed: MAX_REPOSITORIES_TO_DIGEST,
      fetchLimit: MAX_REPOSITORIES_TO_FETCH,
      totalsMayBeLimited: repositories.length === MAX_REPOSITORIES_TO_FETCH,
      public: publicRepositories.length,
      private: privateRepositories.length,
      items: repositoriesToDigest,
    },
    issues: {
      totalOpen: openPublicIssues + openPrivateIssues,
      openInPublicRepositories: openPublicIssues,
      openInPrivateRepositories: openPrivateIssues,
      repositoriesCounted: issueReports.length,
      recentlyOpenedInLookback: recentlyOpenedIssues.length,
      recentlyOpened: recentlyOpenedIssues,
      byRepository: digestIssueReports.map((report) => ({
        repository: report.repository.name,
        visibility: report.repository.visibility,
        openIssueCount: report.openIssueCount,
        recentlyOpenedInLookback: report.recentlyOpenedIssues.length,
      })),
    },
  };
};

async function getRepositoryIssueReports(
  repositories: RepositorySummary[],
  since: Date,
  token: string,
) {
  const reports: RepositoryIssueReport[] = [];
  const batchItems = repositories.map((repository, index) => ({
    ...repository,
    includeRecent: index < MAX_REPOSITORIES_TO_DIGEST,
  }));

  for (const batch of chunk(batchItems, MAX_REPOSITORY_ISSUE_BATCH_SIZE)) {
    reports.push(...(await getRepositoryIssueReportBatch(batch, since, token)));
  }

  return reports;
}

async function getRepositoryIssueReportBatch(
  batch: RepositoryIssueBatchItem[],
  since: Date,
  token: string,
) {
  const repositories = batch.map(parseRepositoryParts);
  const variables = buildRepositoryIssuesVariables(repositories, since);
  const data = await fetchGitHubGraphQL<GitHubRepositoryIssuesData>(
    buildRepositoryIssuesQuery(repositories),
    variables,
    token,
    "fetch GitHub issue counts",
  );

  return repositories.map((repository, index) => {
    const result = data[`repository${index}`];
    const recentIssues = repository.includeRecent
      ? result?.recentIssues?.nodes ?? []
      : [];

    return {
      repository: {
        name: repository.name,
        visibility: repository.visibility,
      },
      openIssueCount: result?.issues?.totalCount ?? 0,
      recentlyOpenedIssues: recentIssues
        .filter((issue) => new Date(issue.createdAt) >= since)
        .map((issue) => ({
          repository: repository.name,
          visibility: repository.visibility,
          number: issue.number,
          title: issue.title,
          author: issue.author?.login ?? "unknown",
          labels:
            issue.labels?.nodes
              ?.map((label) => label?.name)
              .filter((name): name is string => Boolean(name)) ?? [],
          state: issue.state.toLowerCase(),
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
          url: issue.url,
        })),
    };
  });
}

function parseRepositoryParts(
  repository: RepositoryIssueBatchItem,
): GitHubRepositoryParts {
  const [owner, repo] = repository.name.split("/");

  if (!owner || !repo) {
    throw new FatalError(
      `Invalid GitHub repository "${repository.name}". Use "owner/repo".`,
    );
  }

  return {
    ...repository,
    owner,
    repo,
  };
}

function buildRepositoryIssuesQuery(repositories: GitHubRepositoryParts[]) {
  const variables = [
    "$since: DateTime!",
    ...repositories.flatMap((_, index) => [
      `$owner${index}: String!`,
      `$repo${index}: String!`,
      `$includeRecent${index}: Boolean!`,
    ]),
  ].join(", ");

  const selections = repositories
    .map(
      (_, index) => `
        repository${index}: repository(owner: $owner${index}, name: $repo${index}) {
          issues(states: OPEN) {
            totalCount
          }
          recentIssues: issues(
            first: ${MAX_RECENT_ISSUES_PER_REPOSITORY}
            states: OPEN
            orderBy: { field: CREATED_AT, direction: DESC }
            filterBy: { since: $since }
          ) @include(if: $includeRecent${index}) {
            nodes {
              number
              title
              state
              createdAt
              updatedAt
              url
              author {
                login
              }
              labels(first: 10) {
                nodes {
                  name
                }
              }
            }
          }
        }
      `,
    )
    .join("\n");

  return `query RepositoryIssueDigest(${variables}) {${selections}}`;
}

function buildRepositoryIssuesVariables(
  repositories: GitHubRepositoryParts[],
  since: Date,
) {
  return repositories.reduce<Record<string, string | boolean>>(
    (variables, repository, index) => {
      variables[`owner${index}`] = repository.owner;
      variables[`repo${index}`] = repository.repo;
      variables[`includeRecent${index}`] = repository.includeRecent;

      return variables;
    },
    {
      since: since.toISOString(),
    },
  );
}

function sumOpenIssues(
  issueReports: RepositoryIssueReport[],
  visibility: RepositorySummary["visibility"],
) {
  return issueReports
    .filter((report) => report.repository.visibility === visibility)
    .reduce((sum, report) => sum + report.openIssueCount, 0);
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function getGitHubToken() {
  const connector = process.env.CONNECTOR_GITHUB;

  if (!connector) {
    throw new FatalError(
      "CONNECTOR_GITHUB is required. Use a Vercel Connect GitHub connector id, such as github/acme-github.",
    );
  }

  return getToken(connector, { subject: { type: "app" } });
}

async function getRepositories(token: string) {
  const repositories = await getInstallationRepositories(token);

  if (repositories.length > 0) {
    return repositories;
  }

  return getUserRepositories(token);
}

async function getInstallationRepositories(token: string) {
  const repositories: GitHubRepository[] = [];
  const maxPages = Math.ceil(MAX_REPOSITORIES_TO_FETCH / 100);

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL("https://api.github.com/installation/repositories");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const response = await fetchGitHub(url, token);

    if (
      response.status === 404 ||
      (response.status === 403 &&
        response.headers.get("x-ratelimit-remaining") !== "0")
    ) {
      return [];
    }

    await assertGitHubResponse(response, "list installation repositories");

    const data = (await response.json()) as {
      repositories?: GitHubRepository[];
    };
    const pageRepositories = data.repositories ?? [];

    repositories.push(...pageRepositories);

    if (pageRepositories.length < 100) {
      break;
    }
  }

  return selectRepositories(repositories);
}

async function getUserRepositories(token: string) {
  const repositories: GitHubRepository[] = [];
  const maxPages = Math.ceil(MAX_REPOSITORIES_TO_FETCH / 100);

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL("https://api.github.com/user/repos");
    url.searchParams.set("affiliation", "owner,collaborator,organization_member");
    url.searchParams.set("sort", "pushed");
    url.searchParams.set("direction", "desc");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const response = await fetchGitHub(url, token);

    await assertGitHubResponse(response, "list user repositories");

    const pageRepositories = (await response.json()) as GitHubRepository[];

    repositories.push(...pageRepositories);

    if (pageRepositories.length < 100) {
      break;
    }
  }

  return selectRepositories(repositories);
}

function selectRepositories(repositories: GitHubRepository[]) {
  return repositories
    .filter((repository) => !repository.archived && !repository.disabled)
    .map((repository) => ({
      name: repository.full_name,
      visibility: repository.private ? "private" : "public",
    }))
    .filter((repository): repository is RepositorySummary =>
      Boolean(repository.name),
    );
}

function fetchGitHub(url: URL, token: string) {
  return fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  });
}

async function fetchGitHubGraphQL<TData>(
  query: string,
  variables: Record<string, unknown>,
  token: string,
  action: string,
) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });

  await assertGitHubResponse(response, action);

  const payload = (await response.json()) as GitHubGraphQLResponse<TData>;

  if (payload.errors?.length) {
    const message = payload.errors
      .map((error) => error.message)
      .filter((errorMessage): errorMessage is string => Boolean(errorMessage))
      .join("; ");
    const errorTypes = payload.errors
      .map((error) => error.type)
      .filter((type): type is string => Boolean(type));

    if (
      errorTypes.includes("RATE_LIMITED") ||
      message.toLowerCase().includes("rate limit")
    ) {
      throw new RetryableError("GitHub GraphQL rate limit reached.", {
        retryAfter: "1m",
      });
    }

    throw new FatalError(
      `GitHub GraphQL could not ${action}: ${message || "unknown error"}.`,
    );
  }

  if (!payload.data) {
    throw new FatalError(`GitHub GraphQL returned no data while trying to ${action}.`);
  }

  return payload.data;
}

async function assertGitHubResponse(response: Response, action: string) {
  if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
    throw new RetryableError("GitHub API rate limit reached.", {
      retryAfter: "1m",
    });
  }

  if (response.status === 401 || response.status === 403) {
    throw new FatalError(
      `GitHub connector cannot ${action}. Check connector installation and repository access.`,
    );
  }

  if (response.status === 429 || response.status >= 500) {
    throw new RetryableError(`GitHub API failed to ${action}.`, {
      retryAfter: "30s",
    });
  }

  if (!response.ok) {
    throw new FatalError(
      `GitHub API returned ${response.status} while trying to ${action}.`,
    );
  }
}
