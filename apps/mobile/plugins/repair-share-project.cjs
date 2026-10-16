// Repairs the already generated share resource paths without regenerating Pods.
const fs = require('node:fs');
const {createRequire} = require('node:module');
const expoRequire = createRequire(require.resolve('expo/config-plugins'));
const pluginsRequire = createRequire(expoRequire.resolve('@expo/config-plugins'));
const xcode = pluginsRequire('xcode');
const helpers = require('./with-share.cjs')._test;
const projectPath = process.argv[2];
if (!projectPath || !projectPath.endsWith('/project.pbxproj')) throw new Error('Pass the generated project.pbxproj path explicitly');
const project = xcode.project(projectPath); project.parseSync();
if (!helpers.targetEntry(project)) throw new Error('This project has no SlaxShare target');
helpers.repairIosPaths(project);
const output = project.writeSync();
if (output !== fs.readFileSync(projectPath, 'utf8')) fs.writeFileSync(projectPath, output);
