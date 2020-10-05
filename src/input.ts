/**
 * Parse action input into a some proper thing.
 */

import * as core from '@actions/core';

// Parsed action input
export interface Input {
    token: string,
    directory: string,
    name: string,
}

export function get(): Input {
    return {
        token: core.getInput('token', {required: true}),
        directory:  core.getInput('directory', {required: true}),
        name: core.getInput('name')
    }
}
