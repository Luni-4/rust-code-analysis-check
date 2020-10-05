import * as core from '@actions/core';
import * as io from '@actions/io';
import * as exec from '@actions/exec';

export class RcaCli {
    // Path to rust-code-analysis-cli
    private readonly path: string;

    // Create a new RcaCli object
    private constructor(path: string) {
        this.path = path;
    }

    // Get rust-code-analysis
    public static async get(): Promise<RcaCli> {
        try {
            const path = await io.which('rust-code-analysis-cli', true);

            return new RcaCli(path);
        } catch (error) {
            core.error(
                'rust-code-analysis-cli is not installed, see how to do that in \
                 (link to the example)',
            );

            throw error;
        }
    }

    // Call rust-code-analysis-cli
    public async call(args: string[], options?: {}): Promise<number> {
        return await exec.exec(this.path, args, options);
    }
}
