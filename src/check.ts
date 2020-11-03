import * as core from '@actions/core';
import * as github from '@actions/github';

// Get package data
const pkg = require('../package.json');

// Get user agent from package data
const USER_AGENT = `${pkg.name}/${pkg.version} (${pkg.bugs.url})`;

// Define a new type for the annotations
type ChecksCreateParamsOutputAnnotations = any;

// Json structure of the files returned by rust-code-analysis-cli
interface RcaFile {
  name: string,
  start_line: number,
  end_line: number,
  kind: string,
  metrics: Metrics,
  spaces: any, // This field is a JSON array, containing other JSON arrays
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
    // Array containing spaces annotations
    private annotations: Array<ChecksCreateParamsOutputAnnotations>;
    // Array containing the metrics for each file
    private file_metrics: Array<string>;
    // Array containing deserialized Json files for pull requests
    private file_jsons: Array<RcaFile>;

    // Create a new CheckRunner
    constructor() {
        this.annotations = [];
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
        this.file_jsons.push(Object.assign({}, contents));

        // Save metrics extracted from the json object in an array
        this.file_metrics.push(this.getFileMetrics(contents));

        // Create space annotations (if there is at least one space)
        if (contents.spaces.length > 0) {
            this.makeAnnotations(contents);
        }
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
            // Check if there are annotations
            if (this.annotations.length == 0) {
                // Display only global metrics
                await this.globalMetricsCheck(client, checkRunId, options);
            } else {
                // Display global and space metrics
                await this.allMetricsCheck(client, checkRunId, options);
            }
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

    // Check to display only global metrics
    private async globalMetricsCheck(client: any, checkRunId: number, options: CheckOptions): Promise<void> {
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

    // Check to display both global and space metrics
    private async allMetricsCheck(client: any, checkRunId: number, options: CheckOptions): Promise<void> {

        // Checks API allows only up to 50 annotations per request,
        // should group them into buckets
        let annotations = this.getBucket();
        while (annotations.length > 0) {
            // Request data is mostly the same for create/update calls
            let req: any = {
                owner: options.owner,
                repo: options.repo,
                name: options.name,
                check_run_id: checkRunId,
                output: {
                    title: options.name,
                    summary: '',
                    text: this.getText(options.rca_version),
                    annotations: annotations,
                }
            };

            if (this.annotations.length > 0) {
                // There will be more annotations later
                core.debug('This is not the last iteration, marking check as "in_progress"');
                req.status = 'in_progress';
            } else {
                // Okay, that was a last one bucket
                req.status = 'completed';
                req.conclusion = 'success';
                req.completed_at = new Date().toISOString();
            }

            // TODO: Check for errors
            await client.checks.update(req);

            // Get next annotation bucket
            annotations = this.getBucket();
        }

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

    // Create a bucket of 50 annotations
    private getBucket(): Array<ChecksCreateParamsOutputAnnotations> {
        let annotations: Array<ChecksCreateParamsOutputAnnotations> = [];
        while (annotations.length < 50) {
            const annotation = this.annotations.pop();
            if (annotation) {
                annotations.push(annotation);
            } else {
                break;
            }
        }

        core.debug(`Prepared next annotations bucket, ${annotations.length} size`);

        return annotations;
    }

    // Print a json file to stdout
    private dumpToStdout() {
        for (const json_metric of this.file_jsons) {
            // Pretty-print json with a spacing indentation level of 2
            core.info(JSON.stringify(json_metric, null, 2));
        }
    }

    // Convert spaces information into GitHub annotation objects
    //
    // https://developer.github.com/v3/checks/runs/#annotations-object
    private makeAnnotations(contents: RcaFile) {
        // NOTE: We can use recursion because we know beforehand that
        // ends and there are not so many levels.

        // Iterate over spaces
        for (const space of contents.spaces) {
            // Convert the space in an object
            const space_obj = JSON.parse(space);

            // Create an annotation for the space
            this.addAnnotation(space_obj);

            // Check if a space contains subspaces
            if (space_obj.spaces.length > 0) {
              // Create annotations for subspaces
              this.makeAnnotations(space_obj);
            }
        }

    }

    // Save an annotation in memory
    private addAnnotation(contents: RcaFile) {
        let annotation: any = {
            path: contents.name,
            start_line: contents.start_line,
            end_line: contents.end_line,
            annotation_level: 'notice',
            title: contents.name,
            message: this.getAnnotationMetrics(contents.metrics),
        };

        // FIXME: Perhaps we should do something for spaces on a single line.
        // Retrieving the file from GitHub and getting the length of the column?

        this.annotations.push(annotation);
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

${this.getMetrics(contents.metrics)}
</details>`;
    }

    // Return space metrics annotations formatted as markdown
    private getAnnotationMetrics(_metrics: Metrics): string {
        return `Hello`;
/*<details>
<summary><b>Space Metrics</b></summary>

${this.getMetrics(metrics)}
</details>`;*/
    }

    // Returns metrics formatted as markdown
    private getMetrics(metrics: Metrics): string {
      return `Nargs: ${metrics.nargs}

  Nexits: ${metrics.nexits}

  Cognitive: ${metrics.cognitive}
  <details>
  <summary>Cyclomatic</summary>

  - Sum: ${metrics.cyclomatic.sum}
  - Average: ${metrics.cyclomatic.average}
  </details>
  <details>
  <summary>Loc</summary>

  - Sloc: ${metrics.loc.sloc}
  - Ploc: ${metrics.loc.ploc}
  - Lloc: ${metrics.loc.lloc}
  - Cloc: ${metrics.loc.cloc}
  - Blank: ${metrics.loc.blank}
  </details>
  <details>
  <summary>Nom</summary>

  - Functions: ${metrics.nom.functions}
  - Closures: ${metrics.nom.closures}
  - Total: ${metrics.nom.total}
  </details>
  <details>
  <summary>Halstead</summary>

  - n1: ${metrics.halstead.n1}
  - N1: ${metrics.halstead.N1}
  - n2: ${metrics.halstead.n2}
  - N2: ${metrics.halstead.N2}
  - Length: ${metrics.halstead.length}
  - Estimated program length: ${metrics.halstead.estimated_program_length}
  - Purity ratio: ${metrics.halstead.purity_ratio}
  - Vocabulary: ${metrics.halstead.vocabulary}
  - Volume: ${metrics.halstead.volume}
  - Difficulty: ${metrics.halstead.difficulty}
  - Level: ${metrics.halstead.level}
  - Effort: ${metrics.halstead.effort}
  - Time: ${metrics.halstead.time}
  - Bugs: ${metrics.halstead.bugs}
  </details>
  <details>
  <summary>Maintainability Index</summary>

  - Original: ${metrics.mi.mi_original}
  - Visual studio: ${metrics.mi.mi_visual_studio}
  - Sei: ${metrics.mi.mi_sei}
  </details>`;
      }
}
