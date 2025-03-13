"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.debug = debug;
exports.getChangedLines = getChangedLines;
exports.getFilesWithCoverage = getFilesWithCoverage;
exports.parseToReport = parseToReport;
exports.parseBaseReport = parseBaseReport;
const xml2js_1 = __importDefault(require("xml2js"));
const core = __importStar(require("@actions/core"));
const fs = __importStar(require("fs"));
const process_1 = require("./process");
function debug(obj) {
    return JSON.stringify(obj, null, 4);
}
const pattern = /^@@ -([0-9]*),?\S* \+([0-9]*),?/;
function getChangedLines(patch) {
    const lineNumbers = new Set();
    if (patch) {
        const lines = patch.split('\n');
        const groups = getDiffGroups(lines);
        for (const group of groups) {
            const firstLine = group.shift();
            if (firstLine) {
                const diffGroup = firstLine.match(pattern);
                if (diffGroup) {
                    let bX = parseInt(diffGroup[2]);
                    for (const line of group) {
                        bX++;
                        if (line.startsWith('+')) {
                            lineNumbers.add(bX - 1);
                        }
                        else if (line.startsWith('-')) {
                            bX--;
                        }
                    }
                }
            }
        }
    }
    return [...lineNumbers];
}
function getDiffGroups(lines) {
    const groups = [];
    let group = [];
    for (const line of lines) {
        if (line.startsWith('@@')) {
            group = [];
            groups.push(group);
        }
        group.push(line);
    }
    return groups;
}
function getFilesWithCoverage(packages) {
    const files = [];
    for (const item of packages) {
        const packageName = item.name;
        const sourceFiles = item.sourcefile ?? [];
        for (const sourceFile of sourceFiles) {
            const sourceFileName = sourceFile.name;
            const file = {
                name: sourceFileName,
                packageName,
                lines: [],
                counters: [],
            };
            const counters = sourceFile.counter ?? [];
            for (const counter of counters) {
                const type = counter.type;
                file.counters.push({
                    name: type.toLowerCase(),
                    missed: counter.missed,
                    covered: counter.covered,
                });
            }
            const lines = sourceFile.line ?? [];
            for (const line of lines) {
                file.lines.push({
                    number: line.nr,
                    instruction: {
                        missed: line.mi ?? 0,
                        covered: line.ci ?? 0,
                    },
                    branch: {
                        missed: line.mb ?? 0,
                        covered: line.cb ?? 0,
                    },
                });
            }
            files.push(file);
        }
    }
    return files;
}
async function parseToReport(reportXml) {
    const json = await xml2js_1.default.parseStringPromise(reportXml);
    if (json && typeof json === 'object' && 'report' in json) {
        const reportObj = json['report'];
        if (reportObj) {
            return convertObjToReport(reportObj);
        }
    }
    throw new Error('Invalid report');
}
/* eslint-disable @typescript-eslint/no-explicit-any */
function getPackage(obj) {
    return obj.package?.map((pkg) => ({
        name: pkg['$'].name,
        class: pkg.class?.map((cls) => ({
            name: cls['$'].name,
            sourcefilename: cls['$'].sourcefilename,
            method: cls.method?.map((m) => ({
                name: m['$'].name,
                desc: m['$'].desc,
                line: m['$'].line ? Number(m['$'].line) : undefined,
                counter: getCounter(m),
            })),
            counter: getCounter(cls),
        })),
        sourcefile: pkg.sourcefile?.map((sf) => ({
            name: sf['$'].name,
            line: sf.line?.map((ln) => ({
                nr: Number(ln['$'].nr),
                mi: ln['$'].mi ? Number(ln['$'].mi) : undefined,
                ci: ln['$'].ci ? Number(ln['$'].ci) : undefined,
                mb: ln['$'].mb ? Number(ln['$'].mb) : undefined,
                cb: ln['$'].cb ? Number(ln['$'].cb) : undefined,
            })),
            counter: getCounter(sf),
        })),
        counter: getCounter(pkg),
    }));
}
function getCounter(obj) {
    return obj.counter?.map((c) => ({
        type: c['$'].type,
        missed: Number(c['$'].missed),
        covered: Number(c['$'].covered),
    }));
}
function convertObjToReport(obj) {
    return {
        name: obj['$'].name,
        sessioninfo: obj.sessioninfo?.map((si) => ({
            id: si['$'].id,
            start: Number(si['$'].start),
            dump: Number(si['$'].dump),
        })),
        group: obj.group?.map((grp) => ({
            name: grp['$'].name,
            group: grp.group?.map((g) => ({
                name: g['$'].name,
                counter: getCounter(g),
            })),
            package: getPackage(grp),
            counter: getCounter(grp),
        })),
        package: getPackage(obj),
        counter: getCounter(obj),
    };
}
// Add this function to util.ts
async function parseBaseReport(basePath, debugMode) {
    const baseCoverageMap = new Map();
    if (!basePath) {
        core.info('No base coverage path provided, skipping base comparison');
        return baseCoverageMap;
    }
    try {
        const reportXml = await fs.promises.readFile(basePath.trim(), 'utf-8');
        const report = await parseToReport(reportXml);
        if (debugMode)
            core.info(`Successfully parsed base report`);
        // Get all packages from the report
        const packages = report.package || [];
        // Also check packages in groups
        if (report.group) {
            for (const group of report.group) {
                if (group.package) {
                    packages.push(...group.package);
                }
            }
        }
        // Extract all files with coverage
        const jacocoFiles = getFilesWithCoverage(packages);
        // Add each file's coverage to the map
        for (const file of jacocoFiles) {
            const instructionCounter = file.counters.find(counter => counter.name === 'instruction');
            if (instructionCounter) {
                const key = `${file.packageName}/${file.name}`;
                const altKey = file.name; // Also store just by filename for flexible matching
                const coverage = {
                    missed: instructionCounter.missed,
                    covered: instructionCounter.covered,
                    percentage: (0, process_1.calculatePercentage)(instructionCounter.covered, instructionCounter.missed) ?? 0
                };
                baseCoverageMap.set(key, coverage);
                baseCoverageMap.set(altKey, coverage); // Add alternative lookup by filename only
                if (debugMode)
                    core.info(`Base coverage for ${key}: ${coverage.percentage}%`);
            }
        }
        if (debugMode)
            core.info(`Total files in base coverage map: ${baseCoverageMap.size}`);
        return baseCoverageMap;
    }
    catch (error) {
        core.warning(`Error processing base coverage: ${error}`);
        return baseCoverageMap;
    }
}
