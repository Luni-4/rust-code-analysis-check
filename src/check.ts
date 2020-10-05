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
    spaces: [RcaFile],
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
    // Array containing deserialized Json files for pull requests
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

        // Save json files for pull requests
        this.file_jsons.push(contents);

        // Save global files metrics in an array
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
            // Display only global metrics
            await this.metricsCheck(client, checkRunId, options);
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

    // Check to display global and space metrics
    private async metricsCheck(client: any, checkRunId: number, options: CheckOptions): Promise<void> {
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

## Files Metrics

${this.file_metrics.join('\n\n---\n\n')}`;
    }

    // Return file metrics formatted as markdown
    private getFileMetrics(contents: RcaFile): string {
        let s: string = `<details>
<summary><b>${contents.name}</b></summary>

<ul>
<li>
  <details>
  <summary><b>Global</b></summary>

  ${this.getMetrics(contents.metrics)}
  </details>
</li>\n`;

        if (contents.spaces.length > 0) {
            s += `<li><details>
<summary><b>Spaces</b></summary>

${this.getSpaceMetrics(contents.spaces)}
</details></li>\n`;
        }

        s += '</details></ul>';
        return s;
    }

    // Return spaces of a file formatted as markdown
    private getSpaceMetrics(spaces: [RcaFile]): string {
        let spaces_str: string = '<ul>';
        let name: string = '';
        // Iterate over spaces array
        for (const space of spaces) {
            // Rename anonymous space
            if (space.name === '<anonymous>') {
                name = 'unnamed space';
            } else {
                name = space.name;
            }
            let s: string = `<li><details>
<summary><b>${name}</b></summary>

<ul>
<li>
<details>
<summary><b>Metrics</b></summary>

  ${this.getMetrics(space.metrics)}
</details></li>\n`;

            if (space.spaces.length > 0) {
                s += `<li><details>
<summary><b>Spaces</b></summary>

`;
                // Print space subspaces recursively
                s += this.getSpaceMetrics(space.spaces);
                // Close space subspaces
                s += "</details></li></ul>\n";
            }
            // Close current space
            s += '</details></li>\n';

            spaces_str += s;
        }
        return spaces_str + '</ul>';
    }

    // Returns metrics formatted as markdown
    private getMetrics(metrics: Metrics): string {
        return `<details>
  <summary>Nargs</summary>

  <ul><li>Sum: ${metrics.nargs}</li></ul>
  </details>
  <details>
  <summary>Nexits</summary>

  <ul><li>Sum: ${metrics.nexits}</li></ul>
  </details>
  <details>
  <summary>Cognitive</summary>

  <ul><li>Sum: ${metrics.cognitive}</li></ul>
  </details>
  <details>
  <summary>Cyclomatic</summary>

  <ul>
  <li>Sum: ${metrics.cyclomatic.sum}</li>
  <li>Average: ${metrics.cyclomatic.average}</li>
  </ul>
  </details>
  <details>
  <summary>Loc</summary>

  <ul>
  <li>Sloc: ${metrics.loc.sloc}</li>
  <li>Ploc: ${metrics.loc.ploc}</li>
  <li>Lloc: ${metrics.loc.lloc}</li>
  <li>Cloc: ${metrics.loc.cloc}</li>
  <li>Blank: ${metrics.loc.blank}</li>
  </ul>
  </details>
  <details>
  <summary>Nom</summary>

  <ul>
  <li>Functions: ${metrics.nom.functions}</li>
  <li>Closures: ${metrics.nom.closures}</li>
  <li>Total: ${metrics.nom.total}</li>
  </ul>
  </details>
  <details>
  <summary>Halstead</summary>

  <ul>
  <li>n1: ${metrics.halstead.n1}</li>
  <li>N1: ${metrics.halstead.N1}</li>
  <li>n2: ${metrics.halstead.n2}</li>
  <li>N2: ${metrics.halstead.N2}</li>
  <li>Length: ${metrics.halstead.length}</li>
  <li>Estimated program length: ${metrics.halstead.estimated_program_length}</li>
  <li>Purity ratio: ${metrics.halstead.purity_ratio}</li>
  <li>Vocabulary: ${metrics.halstead.vocabulary}</li>
  <li>Volume: ${metrics.halstead.volume}</li>
  <li>Difficulty: ${metrics.halstead.difficulty}</li>
  <li>Level: ${metrics.halstead.level}</li>
  <li>Effort: ${metrics.halstead.effort}</li>
  <li>Time: ${metrics.halstead.time}</li>
  <li>Bugs: ${metrics.halstead.bugs}</li>
  </ul>
  </details>
  <details>
  <summary>Maintainability Index</summary>

  <ul>
  <li>Original: ${metrics.mi.mi_original}</li>
  <li>Visual studio: ${metrics.mi.mi_visual_studio}</li>
  <li>Sei: ${metrics.mi.mi_sei}</li>
  </ul>
  </details>`;
    }
}
