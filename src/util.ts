import {JacocoFile} from './models/jacoco'
import parser from 'xml2js'
import {Counter, Package, Report} from './models/jacoco-types'
import { Coverage } from './models/project'
import * as core from '@actions/core'
import * as fs from 'fs'
import { calculatePercentage } from './process'

export function debug(obj: object): string {
  return JSON.stringify(obj, null, 4)
}

const pattern = /^@@ -([0-9]*),?\S* \+([0-9]*),?/

export function getChangedLines(patch: string | undefined): number[] {
  const lineNumbers = new Set<number>()
  if (patch) {
    const lines = patch.split('\n')
    const groups = getDiffGroups(lines)
    for (const group of groups) {
      const firstLine = group.shift()
      if (firstLine) {
        const diffGroup = firstLine.match(pattern)
        if (diffGroup) {
          let bX = parseInt(diffGroup[2])

          for (const line of group) {
            bX++

            if (line.startsWith('+')) {
              lineNumbers.add(bX - 1)
            } else if (line.startsWith('-')) {
              bX--
            }
          }
        }
      }
    }
  }
  return [...lineNumbers]
}

function getDiffGroups(lines: string[]): string[][] {
  const groups: string[][] = []

  let group: string[] = []
  for (const line of lines) {
    if (line.startsWith('@@')) {
      group = []
      groups.push(group)
    }
    group.push(line)
  }

  return groups
}

export function getFilesWithCoverage(packages: Package[]): JacocoFile[] {
  const files: JacocoFile[] = []
  for (const item of packages) {
    const packageName: string = item.name
    const sourceFiles = item.sourcefile ?? []
    for (const sourceFile of sourceFiles) {
      const sourceFileName = sourceFile.name
      const file: JacocoFile = {
        name: sourceFileName,
        packageName,
        lines: [],
        counters: [],
      }
      const counters = sourceFile.counter ?? []
      for (const counter of counters) {
        const type = counter.type
        file.counters.push({
          name: type.toLowerCase(),
          missed: counter.missed,
          covered: counter.covered,
        })
      }

      const lines = sourceFile.line ?? []
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
        })
      }
      files.push(file)
    }
  }
  return files
}

export async function parseToReport(
  reportXml: string
): Promise<Report> | never {
  const json = await parser.parseStringPromise(reportXml)
  if (json && typeof json === 'object' && 'report' in json) {
    const reportObj = json['report']
    if (reportObj) {
      return convertObjToReport(reportObj)
    }
  }
  throw new Error('Invalid report')
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function getPackage(obj: any): Package[] {
  return obj.package?.map((pkg: any) => ({
    name: pkg['$'].name,
    class: pkg.class?.map((cls: any) => ({
      name: cls['$'].name,
      sourcefilename: cls['$'].sourcefilename,
      method: cls.method?.map((m: any) => ({
        name: m['$'].name,
        desc: m['$'].desc,
        line: m['$'].line ? Number(m['$'].line) : undefined,
        counter: getCounter(m),
      })),
      counter: getCounter(cls),
    })),
    sourcefile: pkg.sourcefile?.map((sf: any) => ({
      name: sf['$'].name,
      line: sf.line?.map((ln: any) => ({
        nr: Number(ln['$'].nr),
        mi: ln['$'].mi ? Number(ln['$'].mi) : undefined,
        ci: ln['$'].ci ? Number(ln['$'].ci) : undefined,
        mb: ln['$'].mb ? Number(ln['$'].mb) : undefined,
        cb: ln['$'].cb ? Number(ln['$'].cb) : undefined,
      })),
      counter: getCounter(sf),
    })),
    counter: getCounter(pkg),
  }))
}

function getCounter(obj: any): Counter[] {
  return obj.counter?.map((c: any) => ({
    type: c['$'].type,
    missed: Number(c['$'].missed),
    covered: Number(c['$'].covered),
  }))
}

function convertObjToReport(obj: any): Report {
  return {
    name: obj['$'].name,
    sessioninfo: obj.sessioninfo?.map((si: any) => ({
      id: si['$'].id,
      start: Number(si['$'].start),
      dump: Number(si['$'].dump),
    })),
    group: obj.group?.map((grp: any) => ({
      name: grp['$'].name,
      group: grp.group?.map((g: any) => ({
        name: g['$'].name,
        counter: getCounter(g),
      })),
      package: getPackage(grp),
      counter: getCounter(grp),
    })),
    package: getPackage(obj),
    counter: getCounter(obj),
  }
}
// Add this function to util.ts
export async function parseBaseReport(
  basePath: string,
  debugMode: boolean
): Promise<Map<string, Coverage>> {
  const baseCoverageMap = new Map<string, Coverage>();
  
  if (!basePath) {
    core.info('No base coverage path provided, skipping base comparison');
    return baseCoverageMap;
  }

  try {
    const reportXml = await fs.promises.readFile(basePath.trim(), 'utf-8');
    const report = await parseToReport(reportXml);
    
    if (debugMode) core.info(`Successfully parsed base report`);
    
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
          percentage: calculatePercentage(instructionCounter.covered, instructionCounter.missed) ?? 0
        };
        
        baseCoverageMap.set(key, coverage);
        baseCoverageMap.set(altKey, coverage); // Add alternative lookup by filename only
        
      }
    }
    
    if (debugMode) core.info(`Total files in base coverage map: ${baseCoverageMap.size}`);
    return baseCoverageMap;
  } catch (error) {
    core.warning(`Error processing base coverage: ${error}`);
    return baseCoverageMap;
  }
}

