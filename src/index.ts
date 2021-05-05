import { BuildSummary, GitType, CircleCI } from "circleci-api";
import fs, { ensureDirSync } from "fs-extra";
import pQueue from "p-queue";

import path from "path";
import { config } from "dotenv";
import followRedirect from "follow-redirects";
import { URL } from "url";
import delay from "delay";

const getCircleCIToken = (): string => {
  if (!process.env.CIRCLE_CI_TOKEN) {
    throw new Error("Please set CIRCLE_CI_TOKEN env var");
  }
  return process.env.CIRCLE_CI_TOKEN;
};
const getConfiguredCircleCIClient = () => {
  const owner = process.env.REPO_OWNER;
  const repo = process.env.REPO_NAME;
  if(!repo) {
    throw new Error("Please set REPO_NAME env var");
  }
  if(!owner) {
    throw new Error("Please set REPO_OWNER env var");
  }
  return new CircleCI({
    token: getCircleCIToken(),
    vcs: {
      type: GitType.GITHUB,
      owner,
      repo,
    },
  });
};
const main = async () => {
  config();
  const headers = {
    "Circle-Token": getCircleCIToken(),
  };
  const allBuilds: BuildSummary[] = await getAllBuilds();
  const downloadDir = path.join(process.cwd(), "downloads");
  const queue = new pQueue({ concurrency: 5, autoStart: true });

  for (const build of allBuilds) {
    downloadArtifactForBuild(build.build_num!, queue, downloadDir, headers);
  }
  await queue.onEmpty();
};

const getAllBuilds = async (): Promise<BuildSummary[]> => {
  const client = getConfiguredCircleCIClient();
  const builds: BuildSummary[] = [];

  let offset = 0;
  do {
    const buildInfo = await client.buildsFor("master", { offset, limit: 100 });
    builds.push(...buildInfo);
    offset += buildInfo.length;
    if (buildInfo.length < 100) break;
  } while (true);

  return builds;
};

const downloadArtifactForBuild = async (
  buildNum: number,
  queue: pQueue,
  dir?: string,
  headers: Record<string, string> = {}
) => {
  dir = dir || path.join(process.cwd(), `${buildNum}`);
  const client = getConfiguredCircleCIClient();
  const artifacts = await client.artifacts(buildNum);
  console.log(
    `Downloading ${artifacts.length} Artifacts from build ${buildNum}`
  );
  if (artifacts.length) {
    ensureDirSync(dir);
    for (const artifact of artifacts) {
      const downloadPath = path.join(
        dir,
        `${buildNum}`,
        path.basename(artifact.path)
      );
      if (!fs.existsSync(downloadPath)) {
        downloadArtifact(artifact.url, downloadPath, queue, headers);
      }
    }
  }
};

const downloadArtifact = (
  url: string,
  filePath: string,
  queue: pQueue,
  headers: Record<string, string> = {}
): void => {
  fs.ensureDirSync(path.dirname(filePath));
  const stream = fs.createWriteStream(filePath);
  const uri = new URL(url);
  queue.add(
    () =>
      new Promise<void>((resolve) => {
        const request = followRedirect.https.get(
          {
            headers,
            hostname: uri.hostname,
            path: uri.pathname,
            protocol: uri.protocol,
          },
          (response) => {
            if (response.statusCode !== 200) {
              console.log(`Failed to get '${url}' (${response.statusCode})`);
              resolve();
              return;
            }
            response.pipe(stream);
          }
        );
        stream.on("finish", async () => {
          await delay(500);
          resolve();
        });

        request.on("error", (err) => {
          fs.unlink(filePath, () => {
            console.log(`failed to download the artifact ${url}`);
          });
          resolve();
        });

        stream.on("error", (err) => {
          console.log(
            `Failed to write the content to disk for file ${filePath} ${err.message}`
          );
          fs.unlink(filePath, () => resolve());
        });
        request.end();
      })
  );
};

main();
