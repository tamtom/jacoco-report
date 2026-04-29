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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProjectCoverage = getProjectCoverage;
exports.calculatePercentage = calculatePercentage;
const util_1 = require("./util");
const github = __importStar(require("@actions/github"));
function getProjectCoverage(reports, changedFiles, baseCoverage, baseOverall, thresholds = {
    fileDrop: 1.0,
    overallDrop: 1.0,
    failOnUncoveredNewFile: true,
}) {
    const moduleCoverages = [];
    const modules = getModulesFromReports(reports);
    for (const module of modules) {
        const files = getFileCoverageFromPackages(module.packages, changedFiles, baseCoverage, thresholds);
        if (files.length !== 0) {
            const moduleCoverage = getModuleCoverage(module.root);
            const changedCoverage = getCoverage(files);
            moduleCoverages.push({
                name: module.name,
                files,
                overall: {
                    percentage: moduleCoverage.percentage,
                    covered: moduleCoverage.covered,
                    missed: moduleCoverage.missed,
                },
                changed: changedCoverage,
            });
        }
    }
    moduleCoverages.sort((a, b) => b.overall.percentage - a.overall.percentage);
    const totalFiles = moduleCoverages.flatMap(module => module.files);
    const changedCoverage = getCoverage(moduleCoverages);
    const projectCoverage = getOverallProjectCoverage(reports);
    const totalPercentage = getTotalPercentage(totalFiles);
    // Build structured regression list
    const regressions = [];
    for (const module of moduleCoverages) {
        for (const file of module.files) {
            if (file.regressionReason === 'new-uncovered') {
                regressions.push({
                    type: 'new-uncovered',
                    module: module.name,
                    file: file.name,
                    fileUrl: file.url,
                    currentPercentage: file.overall.percentage,
                });
            }
            else if (file.regressionReason === 'file-dropped') {
                regressions.push({
                    type: 'file-dropped',
                    module: module.name,
                    file: file.name,
                    fileUrl: file.url,
                    basePercentage: file.basePercentage,
                    currentPercentage: file.overall.percentage,
                    drop: file.basePercentage !== undefined
                        ? toFloat(file.basePercentage - file.overall.percentage)
                        : undefined,
                });
            }
        }
    }
    let overallDrop;
    let baseOverallPercentage;
    if (baseOverall && projectCoverage) {
        baseOverallPercentage = baseOverall.percentage;
        overallDrop = toFloat(baseOverall.percentage - projectCoverage.percentage);
        if (overallDrop > thresholds.overallDrop) {
            regressions.push({
                type: 'overall-drop',
                module: 'project',
                basePercentage: baseOverall.percentage,
                currentPercentage: projectCoverage.percentage,
                drop: overallDrop,
            });
        }
    }
    return {
        modules: moduleCoverages,
        isMultiModule: reports.length > 1 || modules.length > 1,
        overall: projectCoverage,
        changed: changedCoverage,
        'coverage-changed-files': totalPercentage ?? 100,
        baseOverallPercentage,
        overallDrop,
        regressions,
        hasCoverageRegression: regressions.length > 0,
    };
}
function toFloat(value) {
    return parseFloat(value.toFixed(2));
}
function generateGitHubFileUrl(fileName, packageName, changedFiles) {
    const { owner, repo } = github.context.repo;
    // Use head SHA from pull request context if available, otherwise fall back to context.sha
    const sha = github.context.payload.pull_request?.head?.sha || github.context.sha;
    // First, try to find a similar file path from the changed files to understand the project structure
    const similarFile = changedFiles.find(f => f.filePath.includes(fileName));
    if (similarFile) {
        // Extract the directory structure from the similar file and apply it
        const filePath = similarFile.filePath;
        return `https://github.com/${owner}/${repo}/blob/${sha}/${filePath}`;
    }
    // If no similar file found, try to find any file with the same extension to understand the project structure
    const sameExtensionFile = changedFiles.find(f => {
        const ext = fileName.split('.').pop();
        return f.filePath.endsWith(`.${ext}`);
    });
    if (sameExtensionFile) {
        // Use the directory structure from a file with the same extension
        const basePath = sameExtensionFile.filePath.split('/').slice(0, -1).join('/');
        const packagePath = packageName.replace(/\./g, '/');
        // Try to match the package structure
        if (sameExtensionFile.filePath.includes(packagePath)) {
            const pathBeforePackage = sameExtensionFile.filePath.split(packagePath)[0];
            return `https://github.com/${owner}/${repo}/blob/${sha}/${pathBeforePackage}${packagePath}/${fileName}`;
        }
    }
    // Fallback to basic structure guessing
    const packagePath = packageName.replace(/\./g, '/');
    let bestGuessPath;
    if (fileName.endsWith('.kt')) {
        bestGuessPath = `src/main/kotlin/${packagePath}/${fileName}`;
    }
    else if (fileName.endsWith('.java')) {
        bestGuessPath = `src/main/java/${packagePath}/${fileName}`;
    }
    else {
        bestGuessPath = `src/${packagePath}/${fileName}`;
    }
    return `https://github.com/${owner}/${repo}/blob/${sha}/${bestGuessPath}`;
}
function getModulesFromReports(reports) {
    const modules = [];
    for (const report of reports) {
        const groupTag = report.group;
        if (groupTag) {
            const groups = groupTag.filter(group => group !== undefined);
            for (const group of groups) {
                const module = getModuleFromParent(group);
                if (module) {
                    modules.push(module);
                }
            }
        }
        const module = getModuleFromParent(report);
        if (module) {
            modules.push(module);
        }
    }
    return modules;
}
function getModuleFromParent(parent) {
    const packages = parent.package;
    if (packages && packages.length !== 0) {
        return {
            name: parent.name,
            packages,
            root: parent, // TODO just pass array of 'counters'
        };
    }
    return null;
}
function getFileCoverageFromPackages(packages, files, baseCoverage, thresholds) {
    const resultFiles = [];
    const jacocoFiles = (0, util_1.getFilesWithCoverage)(packages);
    const fileDropThreshold = thresholds?.fileDrop ?? 1.0;
    const failOnUncoveredNewFile = thresholds?.failOnUncoveredNewFile ?? true;
    for (const jacocoFile of jacocoFiles) {
        const name = jacocoFile.name;
        const packageName = jacocoFile.packageName;
        // Match jacoco file against PR-changed files. Only matched files are reported.
        const githubFile = files.find(function (f) {
            if (f.filePath.endsWith(`${packageName}/${name}`))
                return true;
            if (f.filePath.endsWith(`/${name}`))
                return true;
            const packagePath = packageName.replace(/\./g, '/');
            if (f.filePath.includes(packagePath) && f.filePath.endsWith(name))
                return true;
            const className = packageName.split(/[./]/).pop();
            if (className && f.filePath.includes(className) && f.filePath.endsWith(name))
                return true;
            return false;
        });
        if (!githubFile)
            continue;
        // Look up this file's prior coverage on base branch (if any)
        let baseCoverageInfo = undefined;
        if (baseCoverage) {
            const fullKey = `${packageName}/${name}`;
            baseCoverageInfo = baseCoverage.get(fullKey) || baseCoverage.get(name);
        }
        const instruction = jacocoFile.counters.find(c => c.name === 'instruction');
        if (!instruction)
            continue;
        const missed = instruction.missed;
        const covered = instruction.covered;
        const currentPercentage = calculatePercentage(covered, missed);
        if (currentPercentage === null)
            continue;
        // Per-line coverage for the lines actually changed in this PR
        const lines = [];
        for (const lineNumber of githubFile.lines) {
            const jacocoLine = jacocoFile.lines.find(l => l.number === lineNumber);
            if (jacocoLine) {
                lines.push({
                    number: lineNumber,
                    instruction: {
                        missed: jacocoLine.instruction.missed,
                        covered: jacocoLine.instruction.covered,
                        percentage: calculatePercentage(jacocoLine.instruction.covered, jacocoLine.instruction.missed) ?? 0,
                    },
                    branch: {
                        missed: jacocoLine.branch.missed,
                        covered: jacocoLine.branch.covered,
                        percentage: calculatePercentage(jacocoLine.branch.covered, jacocoLine.branch.missed) ?? 0,
                    },
                });
            }
        }
        const changedMissed = lines
            .map(line => toFloat(line.instruction.missed))
            .reduce(sumReducer, 0.0);
        const changedCovered = lines
            .map(line => toFloat(line.instruction.covered))
            .reduce(sumReducer, 0.0);
        const changedPercentage = calculatePercentage(changedCovered, changedMissed);
        const baseDiff = baseCoverageInfo?.percentage !== undefined
            ? toFloat(currentPercentage - baseCoverageInfo.percentage)
            : null;
        const changedCoverage = changedPercentage !== null ? {
            missed: changedMissed,
            covered: changedCovered,
            percentage: changedPercentage,
            baseDiff,
        } : null;
        const overallCoverage = { missed, covered, percentage: currentPercentage };
        const isNew = baseCoverageInfo === undefined;
        let regressionReason;
        if (isNew && failOnUncoveredNewFile && covered === 0) {
            regressionReason = 'new-uncovered';
        }
        else if (!isNew && baseDiff !== null && baseDiff < -fileDropThreshold) {
            regressionReason = 'file-dropped';
        }
        resultFiles.push({
            name,
            url: githubFile?.url || generateGitHubFileUrl(name, packageName, files),
            overall: overallCoverage,
            changed: changedCoverage,
            lines,
            basePercentage: baseCoverageInfo?.percentage,
            isNew,
            isRegressed: regressionReason !== undefined,
            regressionReason,
        });
    }
    resultFiles.sort((a, b) => b.overall.percentage - a.overall.percentage);
    return resultFiles;
}
function calculatePercentage(covered, missed) {
    const total = covered + missed;
    if (total !== 0) {
        return parseFloat(((covered / total) * 100).toFixed(2));
    }
    else {
        return null;
    }
}
function getTotalPercentage(files) {
    let missed = 0;
    let covered = 0;
    if (files.length !== 0) {
        for (const file of files) {
            missed += file.overall.missed;
            covered += file.overall.covered;
        }
        return parseFloat(((covered / (covered + missed)) * 100).toFixed(2));
    }
    else {
        return null;
    }
}
function getModuleCoverage(report) {
    const counters = report.counter ?? [];
    return getDetailedCoverage(counters, 'INSTRUCTION');
}
function getOverallProjectCoverage(reports) {
    const coverages = reports.map(report => {
        const counters = report.counter ?? [];
        return getDetailedCoverage(counters, 'INSTRUCTION');
    });
    if (coverages.length === 0)
        return null;
    const covered = coverages.reduce((acc, coverage) => acc + coverage.covered, 0);
    const missed = coverages.reduce((acc, coverage) => acc + coverage.missed, 0);
    const percentage = parseFloat(((covered / (covered + missed)) * 100).toFixed(2));
    if (isNaN(percentage))
        return null;
    return {
        covered,
        missed,
        percentage,
    };
}
function getDetailedCoverage(counters, type) {
    const counter = counters.find(ctr => ctr.type === type);
    if (counter) {
        const missed = counter.missed;
        const covered = counter.covered;
        return {
            missed,
            covered,
            percentage: parseFloat(((covered / (covered + missed)) * 100).toFixed(2)),
        };
    }
    return { missed: 0, covered: 0, percentage: 100 };
}
function getCoverage(entity) {
    if (entity.length === 0)
        return null;
    const changedMissed = entity
        .map(item => toFloat(item.changed?.missed ?? 0))
        .reduce(sumReducer, 0.0);
    const changedCovered = entity
        .map(line => toFloat(line.changed?.covered ?? 0))
        .reduce(sumReducer, 0.0);
    const changedPercentage = calculatePercentage(changedCovered, changedMissed);
    if (changedPercentage === null || isNaN(changedPercentage)) {
        return null;
    }
    return {
        missed: changedMissed,
        covered: changedCovered,
        percentage: changedPercentage,
    };
}
function sumReducer(total, value) {
    return total + value;
}
