"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPRComment = getPRComment;
exports.getTitle = getTitle;
const coverageAbsent = '> There is no coverage information present for the Files changed';
function getPRComment(project, minCoverage, title, emoji) {
    const heading = getTitle(title);
    if (!project.overall) {
        return `${heading + coverageAbsent}`;
    }
    const overallTable = getOverallTable(project.overall, project.changed, minCoverage, emoji);
    const moduleTable = getModuleTable(project.modules, minCoverage, emoji);
    const filesTable = getFileTable(project, minCoverage, emoji);
    const tables = project.modules.length === 0
        ? coverageAbsent
        : project.isMultiModule
            ? `${moduleTable}\n\n${filesTable}`
            : filesTable;
    return `${heading + overallTable}\n\n${tables}`;
}
function getModuleTable(modules, minCoverage, emoji) {
    const tableHeader = '|Module|Coverage||';
    const tableStructure = '|:-|:-|:-:|';
    let table = `${tableHeader}\n${tableStructure}`;
    for (const module of modules) {
        const coverageDifference = getCoverageDifference(module.overall, module.changed);
        renderRow(module.name, module.overall.percentage, coverageDifference, module.changed?.percentage ?? null);
    }
    return table;
    function renderRow(name, overallCoverage, coverageDiff, changedCoverage) {
        const status = getStatus(changedCoverage, null, minCoverage.changed, emoji);
        let coveragePercentage = `${formatCoverage(overallCoverage)}`;
        if (shouldShow(coverageDiff)) {
            coveragePercentage += ` **\`${formatCoverage(coverageDiff)}\`**`;
        }
        const row = `|${name}|${coveragePercentage}|${status}|`;
        table = `${table}\n${row}`;
    }
}
// Update getFileTable function in render.ts
function getFileTable(project, minCoverage, emoji) {
    const tableHeader = project.isMultiModule
        ? '|Module|File|Coverage|Diff||'
        : '|File|Coverage|Diff||';
    const tableStructure = project.isMultiModule
        ? '|:-|:-|:-|:-:|:-:|'
        : '|:-|:-|:-:|:-:|';
    let table = `${tableHeader}\n${tableStructure}`;
    for (const module of project.modules) {
        for (let index = 0; index < module.files.length; index++) {
            const file = module.files[index];
            let moduleName = module.name;
            if (index !== 0) {
                moduleName = '';
            }
            // Get the base diff from the changed coverage if available
            const baseDiff = file.changed?.baseDiff !== undefined ?
                file.changed.baseDiff :
                (file.basePercentage !== undefined ?
                    toFloat(file.overall.percentage - file.basePercentage) :
                    null);
            renderRow(moduleName, `[${file.name}](${file.url})`, file.overall.percentage, baseDiff, file.changed?.percentage ?? null, project.isMultiModule);
        }
    }
    return project.isMultiModule
        ? `<details>\n<summary>Files</summary>\n\n${table}\n\n</details>`
        : table;
    function renderRow(moduleName, fileName, overallCoverage, baseDiff, changedCoverage, isMultiModule) {
        const status = getStatus(changedCoverage, baseDiff, minCoverage.changed, emoji);
        let coveragePercentage = `${formatCoverage(overallCoverage)}`;
        let diffText = 'N/A';
        if (baseDiff !== null) {
            const sign = baseDiff >= 0 ? '+' : '';
            diffText = `**\`${sign}${formatCoverage(baseDiff)}\`**`;
        }
        const row = isMultiModule
            ? `|${moduleName}|${fileName}|${coveragePercentage}|${diffText}|${status}|`
            : `|${fileName}|${coveragePercentage}|${diffText}|${status}|`;
        table = `${table}\n${row}`;
    }
}
function getCoverageDifference(overall, changed) {
    if (!changed)
        return null;
    const totalInstructions = overall.covered + overall.missed;
    const missed = changed.missed;
    const changedPercentage = (missed / totalInstructions) * 100;
    if (changedPercentage > 0 && changedPercentage < 100) {
        return -changedPercentage;
    }
    else
        return null;
}
function getOverallTable(overall, changed, minCoverage, emoji) {
    const overallStatus = getStatus(overall.percentage, null, // Add null for baseDiff
    minCoverage.overall, emoji);
    const coverageDifference = getCoverageDifference(overall, changed);
    let coveragePercentage = `${formatCoverage(overall.percentage)}`;
    if (shouldShow(coverageDifference)) {
        coveragePercentage += ` **\`${formatCoverage(coverageDifference)}\`**`;
    }
    const tableHeader = `|Overall Project|${coveragePercentage}|${overallStatus}|`;
    const tableStructure = '|:-|:-|:-:|';
    const missedLines = changed?.missed ?? 0;
    const coveredLines = changed?.covered ?? 0;
    const totalChangedLines = missedLines + coveredLines;
    let changedCoverageRow = '';
    if (totalChangedLines !== 0) {
        const changedLinesPercentage = (coveredLines / totalChangedLines) * 100;
        const filesChangedStatus = getStatus(changedLinesPercentage, null, minCoverage.changed, emoji);
        changedCoverageRow =
            '\n' +
                `|Files changed|${formatCoverage(changedLinesPercentage)}|${filesChangedStatus}|` +
                '\n<br>';
    }
    return `${tableHeader}\n${tableStructure}${changedCoverageRow}`;
}
function round(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}
function shouldShow(value) {
    if (value === null)
        return false;
    const rounded = Math.abs(round(value));
    return rounded !== 0 && rounded !== 100;
}
function getTitle(title) {
    if (title != null && title.trim().length > 0) {
        const trimmed = title.trim();
        return trimmed.startsWith('#') ? `${trimmed}\n` : `### ${trimmed}\n`;
    }
    else {
        return '';
    }
}
function getStatus(coverage, baseDiff, minCoverage, emoji) {
    // Default status is pass
    let status = emoji.pass;
    // If we have a base diff, check if it's negative
    if (baseDiff !== null) {
        // If coverage decreased, fail
        if (baseDiff < 0) {
            status = emoji.fail;
        }
    }
    // If no base diff or null, fall back to checking against threshold
    else if (coverage !== null && coverage < minCoverage) {
        status = emoji.fail;
    }
    return status;
}
function formatCoverage(coverage) {
    if (coverage == null)
        return 'NaN%';
    return `${toFloat(coverage)}%`;
}
function toFloat(value) {
    return parseFloat(value.toFixed(2));
}
