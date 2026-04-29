"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMENT_MARKER = void 0;
exports.getPRComment = getPRComment;
exports.getTitle = getTitle;
exports.getRegressionReviewBody = getRegressionReviewBody;
exports.COMMENT_MARKER = '<!-- jacoco-coverage-comment -->';
const noChangedCoverage = '> No coverage information present for the files changed in this PR.';
function getPRComment(project, minCoverage, title, emoji) {
    const heading = getTitle(title);
    const body = renderBody(project, minCoverage, emoji);
    return `${exports.COMMENT_MARKER}\n${heading}${body}`;
}
function renderBody(project, minCoverage, emoji) {
    if (!project.overall) {
        return noChangedCoverage;
    }
    const summary = renderSummary(project, emoji);
    const regressionsBlock = renderRegressions(project);
    const overallTable = getOverallTable(project.overall, project.changed, minCoverage, emoji, project.baseOverallPercentage, project.overallDrop);
    const moduleTable = getModuleTable(project.modules, minCoverage, emoji);
    const filesTable = getFileTable(project, minCoverage, emoji);
    if (project.modules.length === 0) {
        return `${summary}\n\n${overallTable}\n\n${noChangedCoverage}`;
    }
    const tables = project.isMultiModule
        ? `${moduleTable}\n\n${filesTable}`
        : filesTable;
    return `${summary}${regressionsBlock}\n\n${overallTable}\n\n${tables}`;
}
function renderSummary(project, emoji) {
    if ((project.regressions ?? []).length === 0) {
        return `${emoji.pass} **No coverage regression detected for changed files.**\n`;
    }
    const newUncovered = (project.regressions ?? []).filter(r => r.type === 'new-uncovered').length;
    const fileDropped = (project.regressions ?? []).filter(r => r.type === 'file-dropped').length;
    const overallDrop = (project.regressions ?? []).filter(r => r.type === 'overall-drop').length;
    const parts = [];
    if (newUncovered)
        parts.push(`${newUncovered} new uncovered file${newUncovered === 1 ? '' : 's'}`);
    if (fileDropped)
        parts.push(`${fileDropped} file${fileDropped === 1 ? '' : 's'} with coverage drop`);
    if (overallDrop)
        parts.push(`overall coverage drop`);
    return `${emoji.fail} **Coverage regression detected:** ${parts.join(', ')}.\n`;
}
function renderRegressions(project) {
    if ((project.regressions ?? []).length === 0)
        return '';
    const rows = (project.regressions ?? [])
        .filter(r => r.type !== 'overall-drop')
        .map(formatRegressionRow)
        .join('\n');
    if (!rows)
        return '';
    return [
        '',
        '#### Files needing attention',
        '',
        '| Module | File | Reason | Base | PR | Drop |',
        '|:-|:-|:-|:-:|:-:|:-:|',
        rows,
    ].join('\n');
}
function formatRegressionRow(r) {
    const reason = r.type === 'new-uncovered' ? '🆕 New, no coverage' : '📉 Coverage dropped';
    const file = r.fileUrl ? `[${r.file}](${r.fileUrl})` : r.file ?? '';
    const basePct = r.basePercentage !== undefined ? `${formatCoverage(r.basePercentage)}` : 'N/A';
    const currentPct = formatCoverage(r.currentPercentage);
    const drop = r.drop !== undefined ? `**\`-${formatCoverage(r.drop)}\`**` : 'N/A';
    return `| ${r.module} | ${file} | ${reason} | ${basePct} | ${currentPct} | ${drop} |`;
}
function getModuleTable(modules, minCoverage, emoji) {
    // Skip modules with no regressed/new files — keeps the comment focused.
    const regressedModules = modules.filter(m => m.files.some(f => f.isRegressed || f.isNew));
    if (regressedModules.length === 0)
        return '';
    const tableHeader = '|Module|Coverage||';
    const tableStructure = '|:-|:-|:-:|';
    let table = `${tableHeader}\n${tableStructure}`;
    for (const module of regressedModules) {
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
function getFileTable(project, minCoverage, emoji) {
    const tableHeader = project.isMultiModule
        ? '|Module|File|Coverage|Diff||'
        : '|File|Coverage|Diff||';
    const tableStructure = project.isMultiModule
        ? '|:-|:-|:-|:-:|:-:|'
        : '|:-|:-|:-:|:-:|';
    let table = `${tableHeader}\n${tableStructure}`;
    let rowCount = 0;
    for (const module of project.modules) {
        // Only render files that are new or regressed — skip green files to reduce noise.
        const visibleFiles = module.files.filter(f => f.isRegressed || f.isNew);
        if (visibleFiles.length === 0)
            continue;
        for (let index = 0; index < visibleFiles.length; index++) {
            const file = visibleFiles[index];
            let moduleName = module.name;
            if (index !== 0)
                moduleName = '';
            const baseDiff = file.changed?.baseDiff !== undefined
                ? file.changed.baseDiff
                : (file.basePercentage !== undefined
                    ? toFloat(file.overall.percentage - file.basePercentage)
                    : null);
            const displayName = file.isNew ? `🆕 ${file.name}` : file.name;
            renderRow(moduleName, `[${displayName}](${file.url})`, file.overall.percentage, baseDiff, file.changed?.percentage ?? null, project.isMultiModule, file.isNew === true);
            rowCount++;
        }
    }
    if (rowCount === 0)
        return '';
    return project.isMultiModule
        ? `<details open>\n<summary><b>Files needing attention</b></summary>\n\n${table}\n\n</details>`
        : table;
    function renderRow(moduleName, fileName, overallCoverage, baseDiff, changedCoverage, isMultiModule, isNew) {
        const status = getStatus(changedCoverage, baseDiff, minCoverage.changed, emoji);
        let coveragePercentage = `${formatCoverage(overallCoverage)}`;
        let diffText;
        if (isNew) {
            diffText = '**`NEW`**';
        }
        else if (baseDiff !== null) {
            const sign = baseDiff >= 0 ? '+' : '';
            diffText = `**\`${sign}${formatCoverage(baseDiff)}\`**`;
        }
        else {
            diffText = 'N/A';
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
function getOverallTable(overall, changed, minCoverage, emoji, baseOverallPercentage, overallDrop) {
    const overallStatus = getStatus(overall.percentage, null, minCoverage.overall, emoji);
    let coveragePercentage = `${formatCoverage(overall.percentage)}`;
    if (baseOverallPercentage !== undefined && overallDrop !== undefined && overallDrop !== 0) {
        const sign = overallDrop > 0 ? '-' : '+';
        coveragePercentage += ` **\`${sign}${formatCoverage(Math.abs(overallDrop))}\`** (base ${formatCoverage(baseOverallPercentage)})`;
    }
    else {
        const coverageDifference = getCoverageDifference(overall, changed);
        if (shouldShow(coverageDifference)) {
            coveragePercentage += ` **\`${formatCoverage(coverageDifference)}\`**`;
        }
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
                `|Files changed (diff coverage)|${formatCoverage(changedLinesPercentage)}|${filesChangedStatus}|` +
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
    let status = emoji.pass;
    if (baseDiff !== null) {
        if (baseDiff < 0)
            status = emoji.fail;
    }
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
function getRegressionReviewBody(project) {
    const lines = [];
    lines.push('### ❌ Coverage gate failed');
    lines.push('');
    const newUncovered = (project.regressions ?? []).filter(r => r.type === 'new-uncovered');
    const fileDropped = (project.regressions ?? []).filter(r => r.type === 'file-dropped');
    const overall = (project.regressions ?? []).find(r => r.type === 'overall-drop');
    if (newUncovered.length) {
        lines.push(`**${newUncovered.length} new file${newUncovered.length === 1 ? '' : 's'} added without test coverage:**`);
        for (const r of newUncovered) {
            lines.push(`- \`${r.module}\` / \`${r.file}\``);
        }
        lines.push('');
    }
    if (fileDropped.length) {
        lines.push(`**${fileDropped.length} file${fileDropped.length === 1 ? '' : 's'} regressed:**`);
        for (const r of fileDropped) {
            const drop = r.drop !== undefined ? ` (-${formatCoverage(r.drop)})` : '';
            lines.push(`- \`${r.module}\` / \`${r.file}\`${drop}`);
        }
        lines.push('');
    }
    if (overall) {
        lines.push(`**Overall coverage dropped by ${formatCoverage(overall.drop)}** (base ${formatCoverage(overall.basePercentage)} → PR ${formatCoverage(overall.currentPercentage)})`);
        lines.push('');
    }
    lines.push('Please add tests for the affected files and push again.');
    return lines.join('\n');
}
