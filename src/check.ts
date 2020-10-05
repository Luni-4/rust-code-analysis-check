import * as core from '@actions/core';
import * as github from '@actions/github';

// Get package data
const pkg = require('../package.json');

// Get user agent from package data
const USER_AGENT = `${pkg.name}/${pkg.version} (${pkg.bugs.url})`;

// Json structure of the files returned by rust-code-analysis-cli
interface RcaFile {
  name: string,
  start_line: number,
  end_line: number,
  kind: string,
  metrics: Metrics,
  spaces: any, // FIXME: To be more granular, we need to define this
}

// Metrics structure
interface Metrics {
    nargs: number,
    nexits: number,
    cognitive: number,
    cyclomatic: {
      sum: number,
      average: number
    },
    halstead: {
      n1: number,
      N1: number,
      n2: number,
      N2: number,
      length: number,
      estimated_program_length: number,
      purity_ratio: number,
      vocabulary: number,
      volume: number,
      difficulty: number,
      level: number,
      effort: number,
      time: number,
      bugs: number
    },
    loc: {
      sloc: number,
      ploc: number,
      lloc: number,
      cloc: number,
      blank: number
    },
    nom: {
      functions: number,
      closures: number,
      total: number
    },
    mi: {
      mi_original: number,
      mi_sei: number,
      mi_visual_studio: number
    },
}

// Options used to create the prospective summary
interface CheckOptions {
    token: string,
    name: string,
    owner: string,
    repo: string,
    head_sha: string,
    started_at: string, // ISO8601
    rca_version: string
}

export class CheckRunner {
    // Array containing the metrics for each file
    private file_metrics: Array<string>;
    // Array containing deserialized Json files
    private file_jsons: Array<RcaFile>;

    // Create a new CheckRunner
    constructor() {
        this.file_metrics = [];
        this.file_jsons = [];
    }

    // Parse Json file produced by rust-code-analysis-cli
    public parseJson(file: string): void {
        let contents: RcaFile;
        try {
            // Deserialize json from a string
            contents = JSON.parse(file);
        } catch (error) {
            core.debug('Not a JSON, ignoring it')
            return;
        }

        // Save json files
        this.file_jsons.push(contents);

        // Save metrics extracted from the json in an array
        this.file_metrics.push(this.getFileMetrics(contents));
    }

    // Execute the check and display the results produced by rust-code-analysis
    public async executeCheck(options: CheckOptions): Promise<void> {

        // Get GitHub client
        const client = github.getOctokit(options.token, {
            userAgent: USER_AGENT,
        });

        // Check ID
        let checkRunId: number;
        try {
            // Create a check
            checkRunId = await this.createCheck(client, options);
        } catch (error) {

            // `GITHUB_HEAD_REF` is set only for forked repos,
            // so we could check if it is a fork and not a base repo.
            if (process.env.GITHUB_HEAD_REF) {
                core.error(`Unable to create the prospective summary! Reason: ${error}`);
                core.warning("It seems that this Action is executed from the forked repository.");
                core.warning(`GitHub Actions are not allowed to create Check annotations, \
when executed for a forked repos. \
See https://github.com/Luni-4/rust-code-analysis-check#limitations for details.`);
                core.info('Posting the prospective summary here instead.');

                this.dumpToStdout();

                return;
            } else {
                throw error;
            }
        }

        try {
            // Successful check, so display metrics
            await this.successCheck(client, checkRunId, options);
        } catch (error) {
            // Cancel check
            await this.cancelCheck(client, checkRunId, options);
            throw error;
        }
    }

    // Create a new check
    private async createCheck(client: any, options: CheckOptions): Promise<number> {
        // TODO: Check for errors
        const response = await client.checks.create({
            owner: options.owner,
            repo: options.repo,
            name: options.name,
            head_sha: options.head_sha,
            status: 'in_progress',
        });

        return response.data.id;
    }

    // Conclude the whole check when the outcome is successful
    private async successCheck(client: any, checkRunId: number, options: CheckOptions): Promise<void> {
        let req: any = {
            owner: options.owner,
            repo: options.repo,
            name: options.name,
            check_run_id: checkRunId,
            status: 'completed',
            conclusion: 'success',
            completed_at: new Date().toISOString(),
            output: {
                title: options.name,
                summary: '',
                text: this.getText(options.rca_version),
            }
        };

        // TODO: Check for errors
        await client.checks.update(req);

        return;
    }

    // Cancel the whole check if some unhandled exception happened
    private async cancelCheck(client: any, checkRunId: number, options: CheckOptions): Promise<void> {
        let req: any = {
            owner: options.owner,
            repo: options.repo,
            name: options.name,
            check_run_id: checkRunId,
            status: 'completed',
            conclusion: 'cancelled',
            completed_at: new Date().toISOString(),
            output: {
                title: options.name,
                summary: 'Unhandled error',
                text: 'Check was cancelled due to unhandled error. Check the Action logs for details.',
            }
        };

        // TODO: Check for errors
        await client.checks.update(req);

        return;
    }

    // Print a json file to stdout
    private dumpToStdout() {
        for (const json_metric of this.file_jsons) {
            // Pretty-print json with a spacing indentation level of 2
            core.info(JSON.stringify(json_metric, null, 2));
        }
    }

    // Return text shown in the annotation formatted as markdown
    private getText(rcaVersion: string): string {
        return `## Info
|          Name          |    Version    |
|:----------------------:|:-------------:|
| rust-code-analysis-cli | ${rcaVersion} |

## Results

${this.file_metrics.join('\n')}`; 
    }

    // Return file metrics formatted as markdown
    private getFileMetrics(contents: RcaFile): string {
        return `<details>
<summary><b>${contents.name}</b></summary>

  Nargs: ${contents.metrics.nargs}

  Nexits: ${contents.metrics.nexits}

  Cognitive: ${contents.metrics.cognitive}
  <details>
  <summary>Cyclomatic</summary>

  - Sum: ${contents.metrics.cyclomatic.sum}
  - Average: ${contents.metrics.cyclomatic.average}
  </details>
  <details>
  <summary>Loc</summary>

  - Sloc: ${contents.metrics.loc.sloc}
  - Ploc: ${contents.metrics.loc.ploc}
  - Lloc: ${contents.metrics.loc.lloc}
  - Cloc: ${contents.metrics.loc.cloc}
  - Blank: ${contents.metrics.loc.blank}
  </details>
  <details>
  <summary>Nom</summary>

  - Functions: ${contents.metrics.nom.functions}
  - Closures: ${contents.metrics.nom.closures}
  - Total: ${contents.metrics.nom.total}
  </details>
  <details>
  <summary>Halstead</summary>

  - n1: ${contents.metrics.halstead.n1}
  - N1: ${contents.metrics.halstead.N1}
  - n2: ${contents.metrics.halstead.n2}
  - N2: ${contents.metrics.halstead.N2}
  - Length: ${contents.metrics.halstead.length}
  - Estimated program length: ${contents.metrics.halstead.estimated_program_length}
  - Purity ratio: ${contents.metrics.halstead.purity_ratio}
  - Vocabulary: ${contents.metrics.halstead.vocabulary}
  - Volume: ${contents.metrics.halstead.volume}
  - Difficulty: ${contents.metrics.halstead.difficulty}
  - Level: ${contents.metrics.halstead.level}
  - Effort: ${contents.metrics.halstead.effort}
  - Time: ${contents.metrics.halstead.time}
  - Bugs: ${contents.metrics.halstead.bugs}
  </details>
  <details>
  <summary>Maintainability Index</summary>

  - Original: ${contents.metrics.mi.mi_original}
  - Visual studio: ${contents.metrics.mi.mi_visual_studio}
  - Sei: ${contents.metrics.mi.mi_sei}
  </details>
</details>`;
    }
}
