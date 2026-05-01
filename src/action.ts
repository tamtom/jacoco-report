/* eslint-disable @typescript-eslint/no-explicit-any */
import * as core from '@actions/core'
import * as github from '@actions/github'
import * as fs from 'fs'
import {parseBooleans} from 'xml2js/lib/processors'
import * as glob from '@actions/glob'
import {getProjectCoverage} from './process'
import {getPRComment, getTitle, COMMENT_MARKER, getRegressionReviewBody} from './render'
import {debug, getChangedLines, parseToReport} from './util'
import {Project, RegressionThresholds} from './models/project'
import {ChangedFile} from './models/github'
import {Report} from './models/jacoco-types'
import {GitHub} from '@actions/github/lib/utils'
import {parseBaseReport} from './util'

export async function action(): Promise<void> {
  let continueOnError = false
  try {
    const token = core.getInput('token')
    if (!token) {
      core.setFailed("'token' is missing")
      return
    }
    const pathsString = core.getInput('paths')
    if (!pathsString) {
      core.setFailed("'paths' is missing")
      return
    }
    const basePath = core.getInput('base-path')
    if (!basePath) {
      core.setFailed("'base-path' is missing")
      return
    }

    const reportPaths = pathsString.split(',')
    const minCoverageOverall = parseFloat(core.getInput('min-coverage-overall'))
    const minCoverageChangedFiles = parseFloat(
      core.getInput('min-coverage-changed-files')
    )
    const title = core.getInput('title')
    const skipIfNoChanges = parseBooleans(core.getInput('skip-if-no-changes'))
    const passEmoji = core.getInput('pass-emoji')
    const failEmoji = core.getInput('fail-emoji')

    continueOnError = parseBooleans(core.getInput('continue-on-error'))
    const debugMode = parseBooleans(core.getInput('debug-mode'))

    // Regression gating thresholds
    const maxOverallDrop = parseFloat(core.getInput('max-overall-drop') || '1.0')
    const maxFileDrop = parseFloat(core.getInput('max-file-drop') || '1.0')
    const failOnUncoveredNewFile = parseBooleans(
      core.getInput('fail-on-uncovered-new-file') || 'true'
    )
    const failOnOverallDrop = parseBooleans(
      core.getInput('fail-on-overall-drop') || 'false'
    )
    const requestChangesOnRegression = parseBooleans(
      core.getInput('request-changes-on-regression') || 'true'
    )
    const thresholds: RegressionThresholds = {
      fileDrop: maxFileDrop,
      overallDrop: maxOverallDrop,
      failOnUncoveredNewFile,
      failOnOverallDrop,
    }

    const event = github.context.eventName
    core.info(`Event is ${event}`)

    const commentType: string = core.getInput('comment-type')
    if (!isValidCommentType(commentType)) {
      core.setFailed(`'comment-type' ${commentType} is invalid`)
    }

    let prNumber: number | undefined =
      Number(core.getInput('pr-number')) || undefined

    const client = github.getOctokit(token)

    const sha = github.context.sha
    let base: string = sha
    let head: string = sha
    switch (event) {
      case 'pull_request':
      case 'pull_request_target':
        base = github.context.payload.pull_request?.base.sha
        head = github.context.payload.pull_request?.head.sha
        prNumber = prNumber ?? github.context.payload.pull_request?.number
        break
      case 'push':
        base = github.context.payload.before
        head = github.context.payload.after
        prNumber =
          prNumber ?? (await getPrNumberAssociatedWithCommit(client, sha))
        break
      case 'workflow_dispatch':
      case 'schedule':
        prNumber =
          prNumber ?? (await getPrNumberAssociatedWithCommit(client, sha))
        break
      case 'workflow_run':
        const pullRequests =
          github.context.payload?.workflow_run?.pull_requests ?? []
        if (pullRequests.length !== 0) {
          base = pullRequests[0]?.base?.sha
          head = pullRequests[0]?.head?.sha
          prNumber = prNumber ?? pullRequests[0]?.number
        } else {
          prNumber =
            prNumber ?? (await getPrNumberAssociatedWithCommit(client, sha))
        }
        break
      default:
        core.setFailed(
          `The event ${github.context.eventName} is not supported.`
        )
        return
    }

    core.info(`base sha: ${base}`)
    core.info(`head sha: ${head}`)
    if (debugMode) core.info(`reportPaths: ${reportPaths}`)

    const baseReport = basePath
      ? await parseBaseReport(basePath, debugMode)
      : { files: undefined, overall: null }

    if (debugMode && baseReport.files) {
      core.info(`Base coverage map contains ${baseReport.files.size} entries`)
    }

    const changedFiles = await getChangedFiles(client, debugMode)
    if (debugMode) core.info(`changedFiles: ${debug(changedFiles)}`)

    const reports = await getJsonReports(reportPaths, debugMode)

    const project = getProjectCoverage(
      reports,
      changedFiles,
      baseReport.files,
      baseReport.overall,
      thresholds
    )

    if (debugMode) core.info(`project: ${debug(project)}`)
    core.setOutput(
      'coverage-overall',
      project.overall ? parseFloat(project.overall.percentage.toFixed(2)) : 100
    )
    core.setOutput(
      'coverage-changed-files',
      parseFloat(project['coverage-changed-files'].toFixed(2))
    )
    core.setOutput('coverage-regressed', String((project.regressions ?? []).length > 0))
    core.setOutput(
      'regression-summary',
      (project.regressions ?? []).length === 0
        ? ''
        : (project.regressions ?? [])
            .map(r => `${r.type} | ${r.module} | ${r.file ?? ''} | drop=${r.drop ?? 'n/a'}`)
            .join('\n')
    )

    const skip = skipIfNoChanges && project.modules.length === 0
    if (debugMode) core.info(`skip: ${skip}`)
    if (debugMode) core.info(`prNumber: ${prNumber}`)
    if (!skip) {
      const emoji = {pass: passEmoji, fail: failEmoji}
      const titleFormatted = getTitle(title)
      const bodyFormatted = getPRComment(
        project,
        {overall: minCoverageOverall, changed: minCoverageChangedFiles},
        title,
        emoji
      )
      switch (commentType) {
        case 'pr_comment':
          await upsertComment(prNumber, titleFormatted, bodyFormatted, client, debugMode)
          break
        case 'summary':
          await addWorkflowSummary(bodyFormatted)
          break
        case 'both':
          await upsertComment(prNumber, titleFormatted, bodyFormatted, client, debugMode)
          await addWorkflowSummary(bodyFormatted)
          break
      }
    }

    // Submit / dismiss REQUEST_CHANGES review based on regression state
    if (requestChangesOnRegression && prNumber !== undefined) {
      try {
        if ((project.regressions ?? []).length > 0) {
          await submitRequestChangesReview(client, prNumber, project, debugMode)
        } else {
          await dismissPriorRegressionReviews(client, prNumber, debugMode)
        }
      } catch (e) {
        core.warning(`Could not submit/dismiss review: ${e}`)
      }
    }

    if ((project.regressions ?? []).length > 0) {
      const reasons = (project.regressions ?? [])
        .map(r => `${r.type}: ${r.module}${r.file ? `/${r.file}` : ''}`)
        .join('; ')
      core.warning(`Coverage regression detected. ${reasons}`)
      core.setFailed(`Coverage regression detected. ${reasons}`)
    }
  } catch (error) {
    if (error instanceof Error) {
      if (continueOnError) {
        core.error(error)
      } else {
        core.setFailed(error)
      }
    }
  }
}

async function getJsonReports(
  xmlPaths: string[],
  debugMode: boolean
): Promise<Report[]> {
  const globber = await glob.create(xmlPaths.join('\n'))
  const files = await globber.glob()
  if (debugMode) core.info(`Resolved files: ${files}`)

  return Promise.all(
    files.map(async path => {
      const reportXml = await fs.promises.readFile(path.trim(), 'utf-8')
      return await parseToReport(reportXml)
    })
  )
}

async function getChangedFiles(
  client: InstanceType<typeof GitHub>,
  debugMode: boolean
): Promise<ChangedFile[]> {
  const prNumber = github.context.payload.pull_request?.number
  if (!prNumber) {
    core.warning('Pull request number not found. Cannot fetch changed files.')
    return []
  }

  // Paginate so PRs with > 30 files don't lose entries.
  const files = await client.paginate(client.rest.pulls.listFiles, {
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: prNumber,
    per_page: 100,
  })

  const changedFiles: ChangedFile[] = []
  for (const file of files) {
    if (debugMode) core.info(`file: ${debug(file)}`)
    changedFiles.push({
      filePath: file.filename,
      url: file.blob_url,
      lines: getChangedLines(file.patch),
      status: file.status as ChangedFile['status'],
      previousFilePath: (file as any).previous_filename,
    })
  }
  return changedFiles
}

async function upsertComment(
  prNumber: number | undefined,
  title: string,
  body: string,
  client: InstanceType<typeof GitHub>,
  debugMode: boolean
): Promise<void> {
  if (prNumber === undefined) {
    if (debugMode) core.info('prNumber not present, skipping comment')
    return
  }

  // Paginate ALL issue comments (not just first page) and find ours via the
  // hidden HTML marker. Title-prefix matching is brittle on long PRs and was
  // the cause of "comment doesn't update on later commits".
  const comments = await client.paginate(client.rest.issues.listComments, {
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: prNumber,
    per_page: 100,
  })

  const existing = comments.find(
    (c: any) => typeof c.body === 'string' && c.body.includes(COMMENT_MARKER)
  )

  if (existing) {
    if (debugMode) core.info(`Updating existing coverage comment id=${existing.id}`)
    await client.rest.issues.updateComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      comment_id: existing.id,
      body,
    })
    return
  }

  if (debugMode) core.info('Creating new coverage comment')
  await client.rest.issues.createComment({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: prNumber,
    body,
  })
}

async function addWorkflowSummary(body: string): Promise<void> {
  await core.summary.addRaw(body, true).write()
}

const REVIEW_MARKER = '<!-- jacoco-coverage-review -->'

async function submitRequestChangesReview(
  client: InstanceType<typeof GitHub>,
  prNumber: number,
  project: Project,
  debugMode: boolean
): Promise<void> {
  // Don't stack reviews — if our last bot review already requests changes, refresh its body via comment instead.
  const reviews = await client.paginate(client.rest.pulls.listReviews, {
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: prNumber,
    per_page: 100,
  })

  const ourReviews = reviews.filter(
    (r: any) => typeof r.body === 'string' && r.body.includes(REVIEW_MARKER)
  )
  const lastOpenChangeRequest = [...ourReviews]
    .reverse()
    .find((r: any) => r.state === 'CHANGES_REQUESTED')

  const body = `${REVIEW_MARKER}\n${getRegressionReviewBody(project)}`

  if (lastOpenChangeRequest) {
    if (debugMode) core.info('Existing CHANGES_REQUESTED review present; not stacking another')
    return
  }

  if (debugMode) core.info('Submitting REQUEST_CHANGES review')
  await client.rest.pulls.createReview({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: prNumber,
    event: 'REQUEST_CHANGES',
    body,
  })
}

async function dismissPriorRegressionReviews(
  client: InstanceType<typeof GitHub>,
  prNumber: number,
  debugMode: boolean
): Promise<void> {
  const reviews = await client.paginate(client.rest.pulls.listReviews, {
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: prNumber,
    per_page: 100,
  })

  const ours = reviews.filter(
    (r: any) =>
      typeof r.body === 'string' &&
      r.body.includes(REVIEW_MARKER) &&
      r.state === 'CHANGES_REQUESTED'
  )

  for (const r of ours) {
    if (debugMode) core.info(`Dismissing prior bot review id=${r.id}`)
    try {
      await client.rest.pulls.dismissReview({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        pull_number: prNumber,
        review_id: r.id,
        message: 'Coverage regression resolved.',
      })
    } catch (e) {
      core.warning(`Failed to dismiss review ${r.id}: ${e}`)
    }
  }
}

type Options = (typeof validCommentTypes)[number]

const validCommentTypes = ['pr_comment', 'summary', 'both'] as const

const isValidCommentType = (value: any): value is Options => {
  return validCommentTypes.includes(value)
}

async function getPrNumberAssociatedWithCommit(
  client: InstanceType<typeof GitHub>,
  commitSha: string
): Promise<number | undefined> {
  const response = await client.rest.repos.listPullRequestsAssociatedWithCommit(
    {
      commit_sha: commitSha,
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
    }
  )

  return response.data.length > 0 ? response.data[0].number : undefined
}
