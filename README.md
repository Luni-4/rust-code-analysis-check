# Rust `rust-code-analysis-check` Action

![MIT licensed](https://img.shields.io/badge/license-MIT-blue.svg)

This GitHub Action executes
[`rust-code-analysis-cli`](https://github.com/mozilla/rust-code-analysis) on the
code in a directory and posts the resultant metrics as a prospective summary
for the pushed commit.

## Example workflow

```yaml
on: push

jobs:

  rust-code-analysis-check:

    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v2

      - name: Install rust-code-analysis-cli
        env:
          RCA_CLI_PATH: https://github.com/mozilla/rust-code-analysis.git
        run: |
          cargo install --git $RCA_CLI_PATH --branch master rust-code-analysis-cli

      - name: Run rust-code-analysis-check
        uses: Luni-4/rust-code-analysis-check@v1
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          directory: path/to/directory
```

## Inputs

|     Name    | Required |                                                Description                                                |  Type  |         Default        |
|:-----------:|:--------:|:---------------------------------------------------------------------------------------------------------:|:------:|:----------------------:|
|   `token`   |     ✓    |                       GitHub secret token, usually a  `${{ secrets.GITHUB_TOKEN }}`                       | string |                        |
| `directory` |     ✓    |                                         The directory to be parsed                                        | string |                        |
|    `name`   |          | Name of the created GitHub check. If running this action multiple times, each run must have a unique name | string | rust-code-analysis-cli |

**NOTE**: if your workflow contains multiple instances of the
`rust-code-analysis-check` action you will need to give each invocation a
unique name, using the `name` property described above.
Check runs must have a unique name, and this prevents a later check run
overriding a previous one within the same workflow.

## Limitations

Due to [token permissions](https://help.github.com/en/articles/virtual-environments-for-github-actions#token-permissions),
this Action **WILL NOT** be able to post `rust-code-analysis-check`
prospective summary  for Pull Requests from the forked repositories.

As a fallback, this Action will output all `rust-code-analysis-cli` messages
into the stdout and fail the result correspondingly.
