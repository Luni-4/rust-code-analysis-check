import * as core from '@actions/core';
import * as github from '@actions/github';

import * as input from './input';
import { CheckRunner } from './check';
import { RcaCli } from './rcacli';

export async function run(actionInput: input.Input): Promise<void> {
    // Save when the action started
    const startedAt = new Date().toISOString();

    // Define rust-code-analysis-cli object
    let program = await RcaCli.get();

    // Get rust-code-analysis-cli version
    let rcaVersion = '';
    await program.call(['-V'], {
        silent: true,
        listeners: {
            stdout: (buffer: Buffer) => rcaVersion = buffer.toString().trim().split(" ", 2)[1],
        }
    });

    // Set up rust-code-analysis-cli options
    let args: string[] = [];

    // Specify to compute metrics
    args.push('--metrics');
    // Specify json as output format
    args.push('--output-format=json');
    // Specify the input path
    args.push('-p');
    // Insert the input path
    args.push(`${actionInput.directory}`);

    // Define a new runner
    let runner = new CheckRunner();
    // Exit code for rust-code-analysis-cli
    let RcaExitCode: number = 0;
    try {
        core.startGroup('Executing rust-code-analysis-cli (JSON output)');
        // Run the command. Each stdout line represents a directory file
        // formatted as json
        RcaExitCode = await program.call(args, {
            ignoreReturnCode: true,
            failOnStdErr: false,
            listeners: {
                stdline: (file: string) => {
                    runner.parseJson(file);
                }
            }
        });
    } finally {
        core.endGroup();
    }

    // Get the commit SHA that triggered the workflow run
    let sha = github.context.sha;
    if (github.context.payload.pull_request?.head?.sha) {
        // Get the pull request commit SHA that triggered the workflow run
        sha = github.context.payload.pull_request.head.sha;
    }

    // Display the results obtained by rust-code-analysis-cli
    await runner.executeCheck({
        token: actionInput.token,
        name: actionInput.name,
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        head_sha: sha,
        started_at: startedAt,
        rca_version: rcaVersion,
    });

    // Return an error
    if (RcaExitCode !== 0) {
        throw new Error(`rust-code-analysis-check had exited with the ${RcaExitCode} exit code`);
    }
}

async function main(): Promise<void> {
    try {
        // Get input data
        const actionInput = input.get();

        // Run action
        await run(actionInput);
    } catch (error) {
        core.setFailed(error.message);
    }
}

// Run the action code
main();
