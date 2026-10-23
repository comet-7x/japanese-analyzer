import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageJson, run } from '../desktop/common.mjs';
import { assertDesktopBuildNode } from '../desktop/check-node.mjs';
import { help, parseOptions, prepareCore } from './prepare.mjs';

export async function buildWithCore(mode, args = [], { env = process.env, prepare = prepareCore, execute = run, nodeVersion = process.versions.node, readPackage = packageJson } = {}) {
  if (!['web', 'desktop'].includes(mode)) throw new Error('Choose web or desktop for the Live2D build.');
  const options = parseOptions(args, env);
  if (options.help) {
    console.log(`Usage: npm run ${mode === 'desktop' ? 'desktop:build:live2d' : 'build:live2d'} -- [--accept-license] [--source <file>]\n\n${help}`);
    return;
  }
  if (!env.npm_execpath) throw new Error('Run this build through npm run so the same npm CLI is used on macOS and Windows.');
  if (mode === 'desktop') assertDesktopBuildNode(nodeVersion, (await readPackage()).desktop.nodeVersion);
  await prepare(options);
  // Node + npm's JS entrypoint avoids Windows npm.cmd shell quoting problems.
  // Use the existing build unchanged, including its pre/post lifecycle hooks.
  await execute(process.execPath, [env.npm_execpath, 'run', mode === 'desktop' ? 'desktop:build' : 'build']);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await buildWithCore(process.argv[2], process.argv.slice(3));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
