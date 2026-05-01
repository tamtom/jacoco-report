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
exports.action = action;
/* eslint-disable @typescript-eslint/no-explicit-any */
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const fs = __importStar(require("fs"));
const processors_1 = require("xml2js/lib/processors");
const glob = __importStar(require("@actions/glob"));
const process_1 = require("./process");
const render_1 = require("./render");
const util_1 = require("./util");
const util_2 = require("./util");
async function action() {
    let continueOnError = false;
    try {
        const token = core.getInput('token');
        if (!token) {
            core.setFailed("'token' is missing");
            return;
        }
        const pathsString = core.getInput('paths');
        if (!pathsString) {
            core.setFailed("'paths' is missing");
            return;
        }
        const basePath = core.getInput('base-path');
        if (!basePath) {
            core.setFailed("'base-path' is missing");
            return;
        }
        const reportPaths = pathsString.split(',');
        const minCoverageOverall = parseFloat(core.getInput('min-coverage-overall'));
        const minCoverageChangedFiles = parseFloat(core.getInput('min-coverage-changed-files'));
        const title = core.getInput('title');
        const skipIfNoChanges = (0, processors_1.parseBooleans)(core.getInput('skip-if-no-changes'));
        const passEmoji = core.getInput('pass-emoji');
        const failEmoji = core.getInput('fail-emoji');
        continueOnError = (0, processors_1.parseBooleans)(core.getInput('continue-on-error'));
        const debugMode = (0, processors_1.parseBooleans)(core.getInput('debug-mode'));
        // Regression gating thresholds
        const maxOverallDrop = parseFloat(core.getInput('max-overall-drop') || '1.0');
        const maxFileDrop = parseFloat(core.getInput('max-file-drop') || '1.0');
        const failOnUncoveredNewFile = (0, processors_1.parseBooleans)(core.getInput('fail-on-uncovered-new-file') || 'true');
        const failOnOverallDrop = (0, processors_1.parseBooleans)(core.getInput('fail-on-overall-drop') || 'false');
        const requestChangesOnRegression = (0, processors_1.parseBooleans)(core.getInput('request-changes-on-regression') || 'true');
        const thresholds = {
            fileDrop: maxFileDrop,
            overallDrop: maxOverallDrop,
            failOnUncoveredNewFile,
            failOnOverallDrop,
        };
        const event = github.context.eventName;
        core.info(`Event is ${event}`);
        const commentType = core.getInput('comment-type');
        if (!isValidCommentType(commentType)) {
            core.setFailed(`'comment-type' ${commentType} is invalid`);
        }
        let prNumber = Number(core.getInput('pr-number')) || undefined;
        const client = github.getOctokit(token);
        const sha = github.context.sha;
        let base = sha;
        let head = sha;
        switch (event) {
            case 'pull_request':
            case 'pull_request_target':
                base = github.context.payload.pull_request?.base.sha;
                head = github.context.payload.pull_request?.head.sha;
                prNumber = prNumber ?? github.context.payload.pull_request?.number;
                break;
            case 'push':
                base = github.context.payload.before;
                head = github.context.payload.after;
                prNumber =
                    prNumber ?? (await getPrNumberAssociatedWithCommit(client, sha));
                break;
            case 'workflow_dispatch':
            case 'schedule':
                prNumber =
                    prNumber ?? (await getPrNumberAssociatedWithCommit(client, sha));
                break;
            case 'workflow_run':
                const pullRequests = github.context.payload?.workflow_run?.pull_requests ?? [];
                if (pullRequests.length !== 0) {
                    base = pullRequests[0]?.base?.sha;
                    head = pullRequests[0]?.head?.sha;
                    prNumber = prNumber ?? pullRequests[0]?.number;
                }
                else {
                    prNumber =
                        prNumber ?? (await getPrNumberAssociatedWithCommit(client, sha));
                }
                break;
            default:
                core.setFailed(`The event ${github.context.eventName} is not supported.`);
                return;
        }
        core.info(`base sha: ${base}`);
        core.info(`head sha: ${head}`);
        if (debugMode)
            core.info(`reportPaths: ${reportPaths}`);
        const baseReport = basePath
            ? await (0, util_2.parseBaseReport)(basePath, debugMode)
            : { files: undefined, overall: null };
        if (debugMode && baseReport.files) {
            core.info(`Base coverage map contains ${baseReport.files.size} entries`);
        }
        const changedFiles = await getChangedFiles(client, debugMode);
        if (debugMode)
            core.info(`changedFiles: ${(0, util_1.debug)(changedFiles)}`);
        const reports = await getJsonReports(reportPaths, debugMode);
        const project = (0, process_1.getProjectCoverage)(reports, changedFiles, baseReport.files, baseReport.overall, thresholds);
        if (debugMode)
            core.info(`project: ${(0, util_1.debug)(project)}`);
        core.setOutput('coverage-overall', project.overall ? parseFloat(project.overall.percentage.toFixed(2)) : 100);
        core.setOutput('coverage-changed-files', parseFloat(project['coverage-changed-files'].toFixed(2)));
        core.setOutput('coverage-regressed', String((project.regressions ?? []).length > 0));
        core.setOutput('regression-summary', (project.regressions ?? []).length === 0
            ? ''
            : (project.regressions ?? [])
                .map(r => `${r.type} | ${r.module} | ${r.file ?? ''} | drop=${r.drop ?? 'n/a'}`)
                .join('\n'));
        const skip = skipIfNoChanges && project.modules.length === 0;
        if (debugMode)
            core.info(`skip: ${skip}`);
        if (debugMode)
            core.info(`prNumber: ${prNumber}`);
        if (!skip) {
            const emoji = { pass: passEmoji, fail: failEmoji };
            const titleFormatted = (0, render_1.getTitle)(title);
            const bodyFormatted = (0, render_1.getPRComment)(project, { overall: minCoverageOverall, changed: minCoverageChangedFiles }, title, emoji);
            switch (commentType) {
                case 'pr_comment':
                    await upsertComment(prNumber, titleFormatted, bodyFormatted, client, debugMode);
                    break;
                case 'summary':
                    await addWorkflowSummary(bodyFormatted);
                    break;
                case 'both':
                    await upsertComment(prNumber, titleFormatted, bodyFormatted, client, debugMode);
                    await addWorkflowSummary(bodyFormatted);
                    break;
            }
        }
        // Submit / dismiss REQUEST_CHANGES review based on regression state
        if (requestChangesOnRegression && prNumber !== undefined) {
            try {
                if ((project.regressions ?? []).length > 0) {
                    await submitRequestChangesReview(client, prNumber, project, debugMode);
                }
                else {
                    await dismissPriorRegressionReviews(client, prNumber, debugMode);
                }
            }
            catch (e) {
                core.warning(`Could not submit/dismiss review: ${e}`);
            }
        }
        if ((project.regressions ?? []).length > 0) {
            const reasons = (project.regressions ?? [])
                .map(r => `${r.type}: ${r.module}${r.file ? `/${r.file}` : ''}`)
                .join('; ');
            core.warning(`Coverage regression detected. ${reasons}`);
            core.setFailed(`Coverage regression detected. ${reasons}`);
        }
    }
    catch (error) {
        if (error instanceof Error) {
            if (continueOnError) {
                core.error(error);
            }
            else {
                core.setFailed(error);
            }
        }
    }
}
async function getJsonReports(xmlPaths, debugMode) {
    const globber = await glob.create(xmlPaths.join('\n'));
    const files = await globber.glob();
    if (debugMode)
        core.info(`Resolved files: ${files}`);
    return Promise.all(files.map(async (path) => {
        const reportXml = await fs.promises.readFile(path.trim(), 'utf-8');
        return await (0, util_1.parseToReport)(reportXml);
    }));
}
async function getChangedFiles(client, debugMode) {
    const prNumber = github.context.payload.pull_request?.number;
    if (!prNumber) {
        core.warning('Pull request number not found. Cannot fetch changed files.');
        return [];
    }
    // Paginate so PRs with > 30 files don't lose entries.
    const files = await client.paginate(client.rest.pulls.listFiles, {
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        pull_number: prNumber,
        per_page: 100,
    });
    const changedFiles = [];
    for (const file of files) {
        if (debugMode)
            core.info(`file: ${(0, util_1.debug)(file)}`);
        changedFiles.push({
            filePath: file.filename,
            url: file.blob_url,
            lines: (0, util_1.getChangedLines)(file.patch),
            status: file.status,
            previousFilePath: file.previous_filename,
        });
    }
    return changedFiles;
}
async function upsertComment(prNumber, title, body, client, debugMode) {
    if (prNumber === undefined) {
        if (debugMode)
            core.info('prNumber not present, skipping comment');
        return;
    }
    // Paginate ALL issue comments (not just first page) and find ours via the
    // hidden HTML marker. Title-prefix matching is brittle on long PRs and was
    // the cause of "comment doesn't update on later commits".
    const comments = await client.paginate(client.rest.issues.listComments, {
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: prNumber,
        per_page: 100,
    });
    const existing = comments.find((c) => typeof c.body === 'string' && c.body.includes(render_1.COMMENT_MARKER));
    if (existing) {
        if (debugMode)
            core.info(`Updating existing coverage comment id=${existing.id}`);
        await client.rest.issues.updateComment({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            comment_id: existing.id,
            body,
        });
        return;
    }
    if (debugMode)
        core.info('Creating new coverage comment');
    await client.rest.issues.createComment({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: prNumber,
        body,
    });
}
async function addWorkflowSummary(body) {
    await core.summary.addRaw(body, true).write();
}
const REVIEW_MARKER = '<!-- jacoco-coverage-review -->';
async function submitRequestChangesReview(client, prNumber, project, debugMode) {
    // Don't stack reviews — if our last bot review already requests changes, refresh its body via comment instead.
    const reviews = await client.paginate(client.rest.pulls.listReviews, {
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        pull_number: prNumber,
        per_page: 100,
    });
    const ourReviews = reviews.filter((r) => typeof r.body === 'string' && r.body.includes(REVIEW_MARKER));
    const lastOpenChangeRequest = [...ourReviews]
        .reverse()
        .find((r) => r.state === 'CHANGES_REQUESTED');
    const body = `${REVIEW_MARKER}\n${(0, render_1.getRegressionReviewBody)(project)}`;
    if (lastOpenChangeRequest) {
        if (debugMode)
            core.info('Existing CHANGES_REQUESTED review present; not stacking another');
        return;
    }
    if (debugMode)
        core.info('Submitting REQUEST_CHANGES review');
    await client.rest.pulls.createReview({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        pull_number: prNumber,
        event: 'REQUEST_CHANGES',
        body,
    });
}
async function dismissPriorRegressionReviews(client, prNumber, debugMode) {
    const reviews = await client.paginate(client.rest.pulls.listReviews, {
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        pull_number: prNumber,
        per_page: 100,
    });
    const ours = reviews.filter((r) => typeof r.body === 'string' &&
        r.body.includes(REVIEW_MARKER) &&
        r.state === 'CHANGES_REQUESTED');
    for (const r of ours) {
        if (debugMode)
            core.info(`Dismissing prior bot review id=${r.id}`);
        try {
            await client.rest.pulls.dismissReview({
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                pull_number: prNumber,
                review_id: r.id,
                message: 'Coverage regression resolved.',
            });
        }
        catch (e) {
            core.warning(`Failed to dismiss review ${r.id}: ${e}`);
        }
    }
}
const validCommentTypes = ['pr_comment', 'summary', 'both'];
const isValidCommentType = (value) => {
    return validCommentTypes.includes(value);
};
async function getPrNumberAssociatedWithCommit(client, commitSha) {
    const response = await client.rest.repos.listPullRequestsAssociatedWithCommit({
        commit_sha: commitSha,
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
    });
    return response.data.length > 0 ? response.data[0].number : undefined;
}
