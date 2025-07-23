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
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
function getProjectCoverage(reports, changedFiles, baseCoverage) {
    const moduleCoverages = [];
    const modules = getModulesFromReports(reports);
    for (const module of modules) {
        // Pass baseCoverage to getFileCoverageFromPackages
        const files = getFileCoverageFromPackages(module.packages, changedFiles, baseCoverage);
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
    // Rest of the function remains the same
    moduleCoverages.sort((a, b) => b.overall.percentage - a.overall.percentage);
    const totalFiles = moduleCoverages.flatMap(module => module.files);
    const changedCoverage = getCoverage(moduleCoverages);
    const projectCoverage = getOverallProjectCoverage(reports);
    const totalPercentage = getTotalPercentage(totalFiles);
    let hasCoverageRegression = false;
    for (const module of moduleCoverages) {
        for (const file of module.files) {
            const baseDiff = file.changed?.baseDiff;
            if (baseDiff !== undefined && baseDiff !== null && baseDiff < -0.5) {
                hasCoverageRegression = true;
                break;
            }
        }
        if (hasCoverageRegression)
            break;
    }
    return {
        modules: moduleCoverages,
        isMultiModule: reports.length > 1 || modules.length > 1,
        overall: projectCoverage,
        changed: changedCoverage,
        'coverage-changed-files': totalPercentage ?? 100,
        hasCoverageRegression
    };
}
function toFloat(value) {
    return parseFloat(value.toFixed(2));
}
function generateGitHubFileUrl(fileName, packageName) {
    const { owner, repo } = github.context.repo;
    const sha = github.context.sha;
    // Convert package name to path (replace dots with slashes)
    const packagePath = packageName.replace(/\./g, '/');
    // Determine file extension and likely source directory
    let sourceDir = 'src/main/java';
    if (fileName.endsWith('.kt')) {
        sourceDir = 'src/main/kotlin';
    }
    else if (fileName.endsWith('.js') || fileName.endsWith('.ts')) {
        sourceDir = 'src';
    }
    // Build the most likely path
    const filePath = `${sourceDir}/${packagePath}/${fileName}`;
    return `https://github.com/${owner}/${repo}/blob/${sha}/${filePath}`;
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
function getFileCoverageFromPackages(packages, files, baseCoverage) {
    const resultFiles = [];
    const jacocoFiles = (0, util_1.getFilesWithCoverage)(packages);
    for (const jacocoFile of jacocoFiles) {
        const name = jacocoFile.name;
        const packageName = jacocoFile.packageName;
        // Flexible matching logic
        const githubFile = files.find(function (f) {
            // Original matching logic
            if (f.filePath.endsWith(`${packageName}/${name}`)) {
                return true;
            }
            // Additional matching filename
            // Match files regardless package structure
            if (f.filePath.endsWith(`/${name}`)) {
                return true;
            }
            // Handle package path conversion kotlin files
            // Convert package dots slashes comparison
            const packagePath = packageName.replace(/\./g, '/');
            if (f.filePath.includes(packagePath) && f.filePath.endsWith(name)) {
                return true;
            }
            // Kotlin multiplatform, check class name part matches
            // Extract class name package name (last part dot/slash)
            const className = packageName.split(/[./]/).pop();
            if (className && f.filePath.includes(className) && f.filePath.endsWith(name)) {
                return true;
            }
            return false;
        });
        // Get base coverage available
        let baseCoverageInfo = undefined;
        if (baseCoverage) {
            // Try different formats to find match
            const fullKey = `${packageName}/${name}`;
            baseCoverageInfo = baseCoverage.get(fullKey) || baseCoverage.get(name);
        }
        const instruction = jacocoFile.counters.find(counter => counter.name === 'instruction');
        if (instruction) {
            const missed = instruction.missed;
            const covered = instruction.covered;
            const currentPercentage = calculatePercentage(covered, missed);
            // Process changed lines coverage use file-level comparison
            let changedCoverage = null;
            let lines = [];
            if (githubFile) {
                core.info(`Found matching file: ${name}`);
                // Standard line-by-line processing
                for (const lineNumber of githubFile.lines) {
                    const jacocoLine = jacocoFile.lines.find(line => line.number === lineNumber);
                    if (jacocoLine) {
                        const line = {
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
                        };
                        lines.push(line);
                    }
                }
                const changedMissed = lines
                    .map(line => toFloat(line.instruction.missed))
                    .reduce(sumReducer, 0.0);
                const changedCovered = lines
                    .map(line => toFloat(line.instruction.covered))
                    .reduce(sumReducer, 0.0);
                const changedPercentage = calculatePercentage(changedCovered, changedMissed);
                changedCoverage = changedPercentage !== null ? {
                    missed: changedMissed,
                    covered: changedCovered,
                    percentage: changedPercentage,
                    // Add base diff base coverage
                    baseDiff: baseCoverageInfo?.percentage !== undefined && currentPercentage !== null ?
                        toFloat(currentPercentage - baseCoverageInfo.percentage) : null
                } : null;
                const overallCoverage = currentPercentage !== null ? {
                    missed,
                    covered,
                    percentage: currentPercentage
                } : null;
                if (overallCoverage) {
                    resultFiles.push({
                        name,
                        url: githubFile?.url || generateGitHubFileUrl(name, packageName),
                        overall: overallCoverage,
                        changed: changedCoverage,
                        lines,
                        basePercentage: baseCoverageInfo?.percentage
                    });
                }
            }
            // Also process files with coverage differences
            else if (baseCoverageInfo && baseCoverageInfo.percentage !== undefined && currentPercentage !== null) {
                const coverageDiff = toFloat(currentPercentage - baseCoverageInfo.percentage);
                // Only include file if there's a coverage difference
                if (coverageDiff !== 0) {
                    core.info(`Found coverage difference for ${name}: ${coverageDiff}`);
                    const overallCoverage = {
                        missed,
                        covered,
                        percentage: currentPercentage
                    };
                    // Generate proper GitHub URL for the file
                    const url = generateGitHubFileUrl(name, packageName);
                    // Set up changedCoverage with baseDiff
                    const changedCoverage = {
                        missed: 0,
                        covered: 0,
                        percentage: currentPercentage,
                        baseDiff: coverageDiff
                    };
                    resultFiles.push({
                        name,
                        url,
                        overall: overallCoverage,
                        changed: changedCoverage,
                        lines: [],
                        basePercentage: baseCoverageInfo.percentage
                    });
                }
            }
        }
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
